import { expect, it, vi } from 'vitest';
import * as flow from '../../src/core/discovery-flow.js';
import type { DiscoveryCatalogPort, LlmPort } from '../../src/core/ports.js';
import { criarSessao } from '../../src/core/sessao.js';
const address = { id: 'fixture-address', formatted: 'Endereço fictício' };
const session = criarSessao({ id: 'fixture-session', organizerId: 'organizer', participants: [{ id: 'organizer', displayName: 'Pessoa', preferences: { wishes: ['prato'], budgetCents: 100 } }] });
const port: DiscoveryCatalogPort = {
  listSavedAddresses: async () => [address],
  searchStores: async () => [{ id: 'fixture-store', name: 'Loja fictícia', isOpen: true }],
  getStore: async () => ({ id: 'fixture-store', name: 'Loja fictícia', isOpen: true }),
  getMenu: async () => ({ coverage: 'offers_only', items: [{ id: 'fixture-item', storeId: 'fixture-store', name: 'Prato fictício' }] }),
};
const confirmed = { ...session, address: { status: 'confirmed' as const, confirmed: address } };
const llm: LlmPort = { generate: async () => ({ pessoas: [{ participantId: 'organizer', desejos: [{ atende: ['fixture-item', 'invented'], substitutos: [] }] }] }) };
it('endereço salvo exige escolha existente pelo organizador, seguida de confirmação separada', async () => {
  const next = await flow.selecionarEnderecoSalvo(session, 'organizer', port, address.id);
  expect(next.session.address?.status).toBe('pending_confirmation');
  await expect(flow.selecionarEnderecoSalvo(session, 'foreign', port, address.id)).rejects.toThrow();
  await expect(flow.selecionarEnderecoSalvo(session, 'organizer', port, 'invented')).rejects.toThrow();
});
it('Core recomenda ID real sem preço/estoque inventados e sem cotar/criar carrinhos', async () => {
  const result = await flow.proporDescoberta(confirmed, { port, llm, address, proposalId: 'fixture-proposal' });
  expect(result.proposal?.items).toEqual([{ participantId: 'organizer', storeId: 'fixture-store', menuItemId: 'fixture-item', quantity: 1 }]);
  expect(result.proposal?.status).toBe('preliminary');
  expect(result.proposal).not.toHaveProperty('split');
  expect(result.proposal?.pending).toContain('commercial_validation');
});
it('estoque falso e loja fechada não são candidatos; desconhecido continua preliminar', async () => {
  const closed = { ...port, searchStores: vi.fn(async () => [{ id: 'fixture-store', name: 'Loja fictícia', isOpen: false }]) };
  expect((await flow.proporDescoberta(confirmed, { port: closed, llm, address, proposalId: 'fixture-proposal' })).reason).toBe('store_closed');
});
it('modo literal de produção seleciona produtos do catálogo real sem modelo fake', async () => {
  const result = await flow.proporDescoberta(confirmed, { port, address, proposalId: 'fixture-proposal', mode: 'literal' });
  expect(result.proposal?.items[0]?.menuItemId).toBe('fixture-item');
  expect(result.classificationMode).toBe('literal');
});
it('um endereço ainda pendente não libera exploração', async () => {
  await expect(flow.proporDescoberta(session, { port, address, proposalId: 'fixture-proposal', mode: 'literal' })).rejects.toThrow('Endereço não confirmado');
});
it('texto de endereço é coletado como intenção, sem validar nem cadastrar silenciosamente', () => {
  const request = flow.coletarEnderecoDigitado(session, 'organizer', 'Texto fictício informado');
  expect(request.status).toBe('requires_registration_consent');
  expect(request).not.toHaveProperty('coordinates');
  expect(request).not.toHaveProperty('address');
  expect(() => flow.coletarEnderecoDigitado(session, 'foreign', 'Texto fictício')).toThrow();
});
it('captura endereço e sessão antes dos awaits para não misturar dados alterados no chamador', async () => {
  let release!: (value: Awaited<ReturnType<DiscoveryCatalogPort['searchStores']>>) => void;
  const snapshotSession = structuredClone(confirmed); const inputAddress = structuredClone(address);
  const delayed = { ...port, searchStores: async () => new Promise<Awaited<ReturnType<DiscoveryCatalogPort['searchStores']>>>(resolve => { release = resolve; }) };
  const result = flow.proporDescoberta(snapshotSession, { port: delayed, address: inputAddress, proposalId: 'fixture-proposal', mode: 'literal' });
  inputAddress.id = 'foreign'; inputAddress.formatted = 'Outro endereço'; snapshotSession.organizerId = 'foreign';
  release([{ id: 'fixture-store', name: 'Loja', isOpen: true }]);
  const actual = await result;
  expect(actual.proposal?.address).toEqual(address); expect(actual.proposal?.organizerId).toBe('organizer');
});


it('a exploração encaminha o diagnóstico de classificação rejeitada pelo Core', async () => {
  const registrar = vi.fn();
  const invalid: LlmPort = { generate: async () => ({ pessoas: [{ participantId: 'organizer', desejos: [] }] }) };
  await expect(flow.proporDescoberta(confirmed, { port, llm: invalid, address, proposalId: 'fixture-proposal', registrar })).rejects.toThrow();
  expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ phase: 'proposta_classificacao', ok: false, failureKind: 'validation', validationIssues: [{ code: 'custom', path: ['pessoas'] }] }));
});


it('classifica cada pessoa isoladamente sem aceitar a resposta heterogênea observada no lote', async () => {
  const participants = ['1000000001', '1000000002'].map(id => ({ id, displayName: 'Pessoa', preferences: { wishes: ['prato'] } }));
  const input = { ...confirmed, organizerId: participants[0]!.id, participants };
  const requested: string[][] = [];
  const model: LlmPort = { generate: async request => {
    const schema = request.outputSchema as { properties: { pessoas: { items: { properties: { participantId: { enum: string[] } } } } } };
    const ids = schema.properties.pessoas.items.properties.participantId.enum;
    requested.push(ids);
    if (ids.length !== 1) return { pessoas: [{ participantId: ids[0], desejos: [{ atende: ['fixture-item'], substitutos: [] }] }, 'participantId', ':', ids[1], 'desejos', ':', []] };
    return { pessoas: [{ participantId: ids[0], desejos: [{ atende: ['fixture-item'], substitutos: [] }] }] };
  } };
  const result = await flow.proporDescoberta(input, { port, llm: model, address, proposalId: 'fixture-proposal' });
  expect(requested).toEqual([['1000000001'], ['1000000002']]);
  expect(result.proposal?.items).toEqual(participants.map(p => ({ participantId: p.id, storeId: 'fixture-store', menuItemId: 'fixture-item', quantity: 1 })));
});


it('falha de uma classificação individual não vira proposta parcial apresentada como sucesso', async () => {
  const participants = ['p1', 'p2'].map(id => ({ id, displayName: 'Pessoa', preferences: { wishes: ['prato'] } }));
  const calls: string[] = [];
  const model: LlmPort = { generate: async request => {
    const schema = request.outputSchema as { properties: { pessoas: { items: { properties: { participantId: { enum: string[] } } } } } };
    const id = schema.properties.pessoas.items.properties.participantId.enum[0]!; calls.push(id);
    return { pessoas: [{ participantId: id === 'p2' ? 'foreign' : id, desejos: [{ atende: ['fixture-item'], substitutos: [] }] }] };
  } };
  await expect(flow.proporDescoberta({ ...confirmed, organizerId: 'p1', participants }, { port, llm: model, address, proposalId: 'fixture-proposal' })).rejects.toThrow();
  expect(calls).toEqual(['p1', 'p2', 'p2']);
});
