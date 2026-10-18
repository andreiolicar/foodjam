import { afterEach, expect, it, vi } from 'vitest';
import { createIfoodDiscoveryCatalog } from '../../src/ifood/discovery.js';
import { buscarDescoberta } from '../../src/core/discovery-search.js';
import { proporDescoberta } from '../../src/core/discovery-flow.js';
import { criarSessao } from '../../src/core/sessao.js';
import type { Participant } from '../../src/core/contracts.js';

const address = { id: 'saved-budget', formatted: 'Local sintético' };
const people: Participant[] = [
  { id: 'a', displayName: 'A', preferences: { wishes: ['coxinha'] } },
  { id: 'b', displayName: 'B', preferences: { wishes: ['café com leite'], foodPreferences: ['café'], budgetCents: 1500 } },
  { id: 'c', displayName: 'C', preferences: { wishes: ['pão de queijo'] } },
];
const rows = [
  { itemId: 'coxinha', itemName: 'Coxinha', unitPrice: 8, merchant: { merchantId: 's1' } },
  { itemId: 'cafe', itemName: 'Café com leite', unitPrice: 12, merchant: { merchantId: 's2' } },
  { itemId: 'pao', itemName: 'Pão de queijo', unitPrice: 7, merchant: { merchantId: 's2' } },
];
const envelope = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
function fixture(slow?: (name: string, args: Record<string, unknown>) => number, empty = false, extra = false) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const calls: { name: string; args: Record<string, unknown>; at: number }[] = [];
  let inFlight = 0; let peak = 0; let aborted = 0;
  const callReadTool = async (name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
    calls.push({ name, args: structuredClone(args), at: Date.now() }); inFlight++; peak = Math.max(peak, inFlight);
    try {
      await new Promise<void>((resolve, reject) => {
        const signal = options?.signal;
        const abort = () => { clearTimeout(timer); aborted++; reject(new Error('controlled_abort')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, slow?.(name, args) ?? 1800);
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      });
      if (name === 'listAddresses') return envelope({ results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: { latitude: 0, longitude: 0 } }] });
      const store = (id: string) => ({ merchantId: id, merchantName: `Loja ${id}`, isOpen: true, reviewRating: 4.7, ratingCount: 25 });
      if (name === 'getMerchant') return envelope(store(String(args.merchantId)));
      const query = String(args.query ?? '');
      const matching = query === 'coxinha' ? rows.slice(0, 1) : query.startsWith('café') ? rows.slice(1, 2) : rows.slice(2);
      const selected = name === 'browseOffers' ? rows.filter(r => r.merchant.merchantId === (args.refinements as {merchantId: string}).merchantId) : matching;
      return envelope({ resultKind: args.resultKind, results: empty ? [] : args.resultKind === 'MERCHANT'
        ? [...new Set(matching.map(r => r.merchant.merchantId)), ...(extra ? ['s3'] : [])].map(store)
        : selected.map(r => ({ ...r, itemImageUrl: 'https://static.ifood-static.com.br/controlled.jpg' })),
      hasMore: !empty && !args.nextPageToken, nextPageToken: !empty && !args.nextPageToken ? 'second-page' : null });
    } finally { inFlight--; }
  };
  const catalog = createIfoodDiscoveryCatalog({ callReadTool }, { maxPages: 2, pageSize: 12, itemMoneyUnit: 'BRL', allowTruncatedStoreSearch: true });
  return { catalog, calls, get peak() { return peak; }, get aborted() { return aborted; } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function finish<T>(promise: Promise<T>) {
  let elapsed = 0; const task = promise.then(value => { elapsed = Date.now(); return value; });
  await vi.advanceTimersByTimeAsync(1_000_000);
  return { result: await task, elapsed };
}

it('A: quatro termos de três pessoas com MCP lento ainda validam os três produtos em até 45s', async () => {
  const f = fixture(); const { result, elapsed } = await finish(buscarDescoberta(f.catalog, people, address));
  console.info('Benchmark controlado:', JSON.stringify({ elapsedMs: elapsed, mcpCalls: f.calls.length, addressReads: f.calls.filter(c => c.name === 'listAddresses').length, peak: f.peak }));
  expect(result.items.map(i => i.id).sort(), JSON.stringify({ elapsed, mcpCalls: f.calls.length })).toEqual(['cafe', 'coxinha', 'pao']);
  expect(result.coverage).toMatchObject({ terms: 4, stores: 2, items: 3 });
  expect(elapsed).toBeLessThanOrEqual(45_000);
  expect(f.calls.filter(c => c.name === 'listAddresses')).toHaveLength(1);
  expect(f.peak).toBeLessThanOrEqual(2);
});
it('B: busca lenta é cancelada sem impedir os outros desejos nem suas validações', async () => {
  const f = fixture((name, args) => name === 'searchOffers' && args.query === 'coxinha' && args.resultKind === 'MERCHANT' ? 60_000 : 1800);
  const { result, elapsed } = await finish(buscarDescoberta(f.catalog, people, address));
  expect(result.items.some(i => i.id === 'cafe')).toBe(true); expect(result.items.some(i => i.id === 'pao')).toBe(true);
  expect(result.coverage.reasons).toContain('time_limit'); expect(elapsed).toBeLessThanOrEqual(45_000);
  expect(f.aborted).toBeGreaterThan(0); expect(f.peak).toBeLessThanOrEqual(2);
});
it('menu composto de duas leituras lentas recebe tempo suficiente dentro da janela original', async () => {
  const f = fixture(() => 4000);
  const { result, elapsed } = await finish(buscarDescoberta(f.catalog, people, address));
  expect(result.items.map(i => i.id).sort()).toEqual(['cafe', 'coxinha', 'pao']);
  expect(elapsed).toBeLessThanOrEqual(45_000);
});
it('C: validação adicional lenta preserva lojas e produtos comprovados', async () => {
  const f = fixture((name, args) => name === 'getMerchant' && args.merchantId === 's3' ? 60_000 : 1800, false, true);
  const { result, elapsed } = await finish(buscarDescoberta(f.catalog, people, address));
  expect(result.items.map(i => i.id).sort()).toEqual(['cafe', 'coxinha', 'pao']);
  expect(result.stores.map(s => s.id).sort()).toEqual(['s1', 's2']);
  expect(result.coverage.reasons).toContain('time_limit'); expect(elapsed).toBeLessThanOrEqual(45_000);
});
it('D: catálogo vazio retorna controladamente sem inventar lojas ou produtos', async () => {
  const f = fixture(undefined, true); const { result, elapsed } = await finish(buscarDescoberta(f.catalog, people, address));
  expect(result.items).toEqual([]); expect(result.stores).toEqual([]); expect(elapsed).toBeLessThanOrEqual(45_000);
});
it.each([false, true])('E/F: composição adaptador/Core mantém compatibilidade e até duas lojas; IA incompatível=%s', async incompatible => {
  const f = fixture();
  const session = { ...criarSessao({ id: 'budget', organizerId: 'a', participants: people }), address: { status: 'confirmed' as const, confirmed: address } };
  const llm = { generate: async (request: { prompt: string }) => {
    const persons = JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(request.prompt)![1]!) as {participantId: string}[];
    return { pessoas: persons.map(p => ({ participantId: p.participantId, desejos: [{ atende: incompatible ? ['coxinha'] : ['coxinha', 'cafe', 'pao'], substitutos: [] }] })) };
  } };
  const { result, elapsed } = await finish(proporDescoberta(session, { port: f.catalog, llm, address, proposalId: 'budget-proposal' }));
  expect(result.proposal?.items.map(i => [i.participantId, i.menuItemId])).toEqual(incompatible ? [['a', 'coxinha']] : [['a', 'coxinha'], ['b', 'cafe'], ['c', 'pao']]);
  expect(new Set(result.proposal?.items.map(i => i.storeId)).size).toBeLessThanOrEqual(2);
  expect(result.proposal?.pending).toContain('commercial_validation'); expect(elapsed).toBeLessThanOrEqual(45_000);
});
it('G: primeira página mantém preço, mídia, avaliação, onlyOpen e confirmação independente do menu', async () => {
  const f = fixture(); const { result } = await finish(buscarDescoberta(f.catalog, people, address));
  expect(result.items.find(i => i.id === 'cafe')).toMatchObject({ priceCents: 1200, itemImageUrl: 'https://static.ifood-static.com.br/controlled.jpg', storeId: 's2' });
  expect(result.stores.find(s => s.id === 's2')).toMatchObject({ reviewRating: 4.7, ratingCount: 25, isOpen: true });
  for (const c of f.calls.filter(c => c.name === 'searchOffers')) expect(c.args.refinements).toEqual({ onlyOpen: true });
  expect(f.calls.filter(c => c.args.nextPageToken)).toHaveLength(0);
  expect(result.coverage.reasons).toContain('pagination_truncated');
  expect(f.calls.filter(c => c.name === 'getMerchant' && c.args.merchantId === 's2')).toHaveLength(2);
  expect(f.calls.every(c => ['listAddresses', 'searchOffers', 'getMerchant', 'browseOffers'].includes(c.name))).toBe(true);
});
it('localização reutilizada nunca cruza endereços ou operações e não armazena disponibilidade', async () => {
  const f = fixture();
  await finish((async () => {
    const scoped = await f.catalog.forDiscovery!(address);
    await expect(scoped.getStore('s1', { ...address, formatted: 'Outro local sintético' })).rejects.toMatchObject({ reason: 'invalid_input' });
    await scoped.getStore('s1', address); await scoped.getMenu('s1', address);
    const next = await f.catalog.forDiscovery!(address);
    await next.getStore('s1', address);
  })());
  expect(f.calls.filter(c => c.name === 'listAddresses')).toHaveLength(2);
  expect(f.calls.filter(c => c.name === 'getMerchant')).toHaveLength(3);
});
it('endereço desconhecido interrompe antes de consultar ofertas, sem usar localização inventada', async () => {
  const f = fixture();
  const task = buscarDescoberta(f.catalog, people, { id: 'missing', formatted: 'Desconhecido' }).catch(error => error);
  const { result } = await finish(task);
  expect(result).toBeInstanceOf(Error);
  expect(f.calls.map(c => c.name)).toEqual(['listAddresses']);
});
it('falha de transporte não é convertida em ausência de candidatos', async () => {
  const f = fixture();
  f.catalog.searchStores = async () => { throw new Error('controlled_transport_failure'); };
  // Sem escopo alternativo, exercita a propagação do Core por uma porta direta.
  delete f.catalog.forDiscovery;
  const { result } = await finish(buscarDescoberta(f.catalog, people, address).catch(error => error));
  expect(result).toBeInstanceOf(Error);
});
