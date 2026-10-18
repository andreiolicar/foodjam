import type { DeliveryAddress, DiscoveryCoverage, DiscoveryCoverageReason, DiscoveryItem, DiscoveryStore, Participant } from './contracts.js';
import type { DiscoveryCatalogPort } from './ports.js';
import { termosDeBusca } from './catalogo.js';
import { normalizar } from './regras/elegibilidade.js';

export interface DiscoveryLimits {
  maxSearchTerms: number; maxStores: number; maxItemsPerStore: number;
  maxItems: number; maxClassificationItems: number; maxRequests: number; deadlineMs: number;
}
const defaults: DiscoveryLimits = { maxSearchTerms: 4, maxStores: 4, maxItemsPerStore: 12, maxItems: 24, maxClassificationItems: 8, maxRequests: 16, deadlineMs: 45_000 };
export function discoveryLimits(input: Partial<DiscoveryLimits> = {}): DiscoveryLimits {
  const limits = { ...defaults, ...input };
  const ceilings: DiscoveryLimits = { maxSearchTerms: 8, maxStores: 8, maxItemsPerStore: 30, maxItems: 120, maxClassificationItems: 24, maxRequests: 32, deadlineMs: 120_000 };
  for (const key of Object.keys(limits) as (keyof DiscoveryLimits)[]) if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceilings[key]) throw new Error('Limites de descoberta inválidos.');
  return limits;
}

/** Distribui uma janela entre desejos antes de completar com a amostra geral. */
export function limitarCandidatos(items: readonly DiscoveryItem[], groups: readonly (readonly string[])[], max: number): DiscoveryItem[] {
  const allowed = new Map(items.map(i => [i.id, i])); const chosen = new Map<string, DiscoveryItem>();
  for (let n = 0; n < Math.max(0, ...groups.map(g => g.length)) && chosen.size < max; n++) for (const group of groups) {
    const item = allowed.get(group[n] ?? ''); if (item && chosen.size < max) chosen.set(item.id, item);
  }
  for (const item of items) if (chosen.size < max) chosen.set(item.id, item);
  return [...chosen.values()];
}

/** Recuperação limitada e distribuída entre os desejos; sem valores comerciais. */
export async function buscarDescoberta(port: DiscoveryCatalogPort, participants: readonly Participant[], address: DeliveryAddress, options?: Partial<DiscoveryLimits>) {
  const limits = discoveryLimits(options); const start = Date.now();
  const coverage: DiscoveryCoverage = { terms: 0, stores: 0, items: 0, requests: 0, limited: false, reasons: [] };
  function limited(reason: DiscoveryCoverageReason) {
    coverage.limited = true;
    if (!coverage.reasons!.includes(reason)) coverage.reasons!.push(reason);
  }
  const searchOptions = { onTruncated: () => limited('pagination_truncated') };
  async function read<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const requestsExhausted = coverage.requests >= limits.maxRequests;
    const timeExhausted = Date.now() - start >= limits.deadlineMs;
    if (requestsExhausted) limited('request_limit');
    if (timeExhausted) limited('time_limit');
    if (requestsExhausted || timeExhausted) return undefined;
    coverage.requests++; return operation(); // Erros de interpretação/transporte não viram lista vazia.
  }
  const perPerson = participants.map(p => termosDeBusca([p]));
  const terms = new Map<string, string>();
  for (let i = 0; i < Math.max(0, ...perPerson.map(t => t.length)); i++) for (const list of perPerson) if (list[i]) terms.set(normalizar(list[i]!), list[i]!);
  if (!terms.size) terms.set('', '');
  const queries = [...terms.values()].slice(0, limits.maxSearchTerms);
  if (terms.size > queries.length) limited('term_limit');
  const matchesByTerm = new Map<string, string[]>();
  const groups: string[][] = []; const known = new Map<string, DiscoveryStore>(); const seeds = new Map<string, DiscoveryItem[]>();
  for (const query of queries) {
    const found = await read(() => port.searchStores(query, address, searchOptions));
    if (found === undefined) break;
    coverage.terms++;
    for (const store of found) known.set(store.id, store);
    const matches = query && port.searchItems ? await read(() => port.searchItems!(query, address, searchOptions)) : [];
    matchesByTerm.set(normalizar(query), (matches ?? []).map(i => i.id));
    for (const item of matches ?? []) { const list = seeds.get(item.storeId) ?? []; list.push(item); seeds.set(item.storeId, list); }
    groups.push([...new Set([...(matches ?? []).map(i => i.storeId), ...found.filter(s => s.isOpen).map(s => s.id)])]);
  }
  const closed = new Set([...known.values()].filter(s => s.isOpen === false).map(s => s.id));
  // Em cada desejo, abertas comprovadas precedem donos ITEM não verificados.
  // A rodada entre desejos evita que várias lojas de um desejo eliminem outro.
  const ranked = groups.map(group => [
    ...group.filter(id => known.get(id)?.isOpen === true),
    ...group.filter(id => !known.has(id)),
  ]);
  coverage.candidateStores = new Set(groups.flat().concat([...closed])).size;
  coverage.checkedStores = 0;
  const stores: DiscoveryStore[] = []; const items: DiscoveryItem[] = [];
  const visited = new Set<string>(); let turn = 0;
  function nextCandidate(): string | undefined {
    const pending = ranked.map((ids, index) => ({ index,
      id: ids.find(id => !visited.has(id)),
      accepted: ids.filter(id => stores.some(store => store.id === id)).length,
    })).filter(group => group.id !== undefined);
    if (!pending.length) return undefined;
    const leastServed = Math.min(...pending.map(group => group.accepted));
    // Rejeição não conta como cobertura; empate alterna os desejos, evitando
    // gastar todo o orçamento no primeiro antes de consultar os demais.
    pending.sort((a, b) => (a.index - turn + ranked.length) % ranked.length - (b.index - turn + ranked.length) % ranked.length);
    const group = pending.find(group => group.accepted === leastServed)!;
    visited.add(group.id!); turn = (group.index + 1) % ranked.length;
    return group.id;
  }
  for (let id = nextCandidate(); id !== undefined; id = nextCandidate()) {
    // Uma loja rejeitada não consome a vaga de uma loja aberta posterior.
    // As releituras continuam submetidas aos mesmos limites de chamadas/tempo.
    if (stores.length >= limits.maxStores) { limited('store_limit'); break; }
    const current = await read(() => port.getStore(id, address));
    if (current === undefined) break;
    coverage.checkedStores++;
    if (current.id !== id) throw new Error('Estabelecimento divergente.');
    if (current.isOpen !== true) { if (current.isOpen === false) closed.add(id); continue; }
    const menu = await read(() => port.getMenu(id, address));
    if (menu === undefined) break;
    if (menu.storeOpen === false) { closed.add(id); continue; }
    const listed = known.get(id);
    // Avaliação é só apresentação. A releitura prevalece como par nota/contagem;
    // nunca acopla a nota atual à quantidade antiga de outra observação.
    const review = current.reviewRating === undefined && listed?.name === current.name
      ? { ...(listed.reviewRating === undefined ? {} : { reviewRating: listed.reviewRating }),
          ...(listed.ratingCount === undefined ? {} : { ratingCount: listed.ratingCount }) } : {};
    stores.push({ ...current, ...review });
    if (menu.coverage !== 'complete') limited('catalog_partial');
    if (menu.truncated === true) limited('pagination_truncated');
    const merged = new Map<string, DiscoveryItem>();
    for (const item of [...(seeds.get(id) ?? []), ...menu.items]) {
      if (item.storeId !== id) throw new Error('Produto fora do estabelecimento.');
      const image = item.itemImageUrl ?? merged.get(item.id)?.itemImageUrl;
      merged.set(item.id, { ...item, ...(image === undefined ? {} : { itemImageUrl: image }) });
    }
    const available = [...merged.values()].filter(i => i.available !== false);
    const selected = limitarCandidatos(available, [...matchesByTerm.values()], limits.maxItemsPerStore);
    if (available.length > selected.length) limited('item_limit');
    items.push(...selected);
  }
  // Distribui o limite global por loja para não eliminar a última preferência.
  const chosen: DiscoveryItem[] = [];
  for (let i = 0; i < limits.maxItemsPerStore; i++) for (const store of stores) {
    const item = items.filter(row => row.storeId === store.id)[i];
    if (item && chosen.length < limits.maxItems) chosen.push(item);
  }
  if (items.length > chosen.length) limited('item_limit');
  coverage.stores = stores.length; coverage.items = chosen.length;
  coverage.closedStores = closed.size;
  return { stores, items: chosen, coverage, sawClosed: closed.size > 0, matchesByTerm };
}
