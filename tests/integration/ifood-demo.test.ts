import { expect, it, vi } from 'vitest';
import { observedDemoFetch, rateEvidence, runDemoSnapshot } from '../../scripts/demo-ifood.js';
const envelope = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const address = { id: 'fixture-address', formatted: 'Endereço fictício' };
const location = { latitude: 0, longitude: 0 };
const merchant = { merchantId: 'store', merchantName: 'Loja fictícia', isOpen: true };
const saved = envelope({ results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: location }] });
const user = { name: 'getUser', args: {}, result: envelope({ success: true, data: { email: 'fixture@example.invalid' } }) };
const search = { calls: [user, { name: 'searchOffers', args: { merchantType: 'RESTAURANT', resultKind: 'MERCHANT', query: 'hambúrguer', userLocation: location }, result: envelope({ results: [merchant], hasMore: false }) }] };
const snapshot = { calls: [user, { name: 'listAddresses', args: {}, result: saved }, { name: 'listAddresses', args: {}, result: saved },
  { name: 'getMerchant', args: { merchantId: 'store', userLocation: location }, result: envelope(merchant) },
  { name: 'browseOffers', args: { merchantType: 'RESTAURANT', resultKind: 'ITEM', userLocation: location, refinements: { merchantId: 'store' } },
    result: envelope({ resultKind: 'ITEM', hasMore: false, results: Array.from({ length: 8 }, (_, i) => ({ itemId: `item-${i}`, itemName: `Hambúrguer ${i}`, merchant: { merchantId: 'store' } })) }) },
] };
const input = { sessionId: 'demo', organizerId: 'a', confirmedAddress: address, mode: 'model' as const, moneyUnit: 'BRL' as const,
  participants: ['a', 'b'].map(id => ({ id, displayName: id, preferences: { wishes: ['hambúrguer'] } })) };
it('diagnóstico distingue TPM e RPD sem reter mensagem, organização ou headers arbitrários', () => {
  const evidence = rateEvidence(429, new Headers({ 'retry-after': '23', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-remaining-requests': '500', 'x-secret': 'private' }), 'organization PRIVATE_ID tokens per minute (TPM)');
  expect(evidence).toMatchObject({ dimension: 'tokens_per_minute', retryAfterMs: 23000, remainingRequestsPerDay: 500, remainingTokensPerMinute: 0 });
  expect(JSON.stringify(evidence)).not.toMatch(/PRIVATE_ID|private|organization/);
  expect(rateEvidence(429, new Headers(), 'daily tokens per day').dimension).toBe('tokens_per_day');
});
it('429 encerra a tentativa sem repetição automática, mesmo se o adaptador tentar novamente', async () => {
  const http = vi.fn<typeof fetch>(async () => new Response('requests per minute RPM', { status: 429, headers: { 'retry-after': '60' } }));
  const events: Parameters<typeof observedDemoFetch>[1] = [];
  const observed = observedDemoFetch(http, events);
  await expect(observed('https://provider.invalid')).rejects.toMatchObject({ fatal: true });
  await expect(observed('https://provider.invalid')).rejects.toMatchObject({ fatal: true });
  expect(http).toHaveBeenCalledTimes(1); expect(events).toHaveLength(1);
});
it('429 com corpo interrompido ainda preserva Retry-After e impede segunda chamada', async () => {
  const http = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('corpo interrompido')); } }), { status: 429, headers: { 'retry-after': '60' } }));
  const events: Parameters<typeof observedDemoFetch>[1] = [];
  const observed = observedDemoFetch(http, events);
  await expect(observed('https://provider.invalid')).rejects.toBeInstanceOf(Error);
  await expect(observed('https://provider.invalid')).rejects.toBeInstanceOf(Error);
  expect(http).toHaveBeenCalledTimes(1);
  expect(events[0]).toMatchObject({ status: 429, retryAfterMs: 60000 });
});
it('snapshot MCP → Core com LlmPort controlada → duas pessoas, uma loja e artefato sem carrinho histórico', async () => {
  const generate = vi.fn(async request => {
    expect(request.prompt).not.toContain('item-7');
    const ids = (request.outputSchema.properties as { pessoas: { items: { properties: { participantId: { enum: string[] } } } } }).pessoas.items.properties.participantId.enum;
    return { pessoas: ids.map(participantId => ({ participantId, desejos: [{ atende: [participantId === 'a' ? 'item-0' : 'item-1'], substitutos: [] }] })) };
  });
  const result = await runDemoSnapshot(input, search, snapshot, { generate });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.preparation.proposal.items).toHaveLength(2);
  expect(result.read.preliminary.items).toHaveLength(6);
  expect(result.read.preliminary.items.every(i => i.priceCents === undefined && i.available === undefined)).toBe(true);
  expect(result.preparation.discountPolicy).toBe('block_unattributed');
  expect(result.currentAvailabilityConfirmed).toBe(false);
  expect(result.remoteWritesExecuted).toBe(false);
});
it('recusa endereço ou conta divergente antes de chamar IA', async () => {
  const generate = vi.fn(); const foreign = structuredClone(search);
  foreign.calls[0]!.result = envelope({ success: true, data: { email: 'other@example.invalid' } });
  await expect(runDemoSnapshot(input, foreign, snapshot, { generate })).rejects.toThrow();
  await expect(runDemoSnapshot({ ...input, confirmedAddress: { ...address, id: 'foreign' } }, search, snapshot, { generate })).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
});
it('saída inválida não dispara outra classificação e não prepara artefato incompleto', async () => {
  const generate = vi.fn(async () => ({}));
  await expect(runDemoSnapshot(input, search, snapshot, { generate })).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});
