import type { DeliveryAddress, DiscoveryCoverage, DiscoveryItem, DiscoveryStore, Participant } from './contracts.js';
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
  const coverage: DiscoveryCoverage = { terms: 0, stores: 0, items: 0, requests: 0, limited: false };
  async function read<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (coverage.requests >= limits.maxRequests || Date.now() - start >= limits.deadlineMs) { coverage.limited = true; return undefined; }
    coverage.requests++; return operation(); // Erros de interpretação/transporte não viram lista vazia.
  }
  const perPerson = participants.map(p => termosDeBusca([p]));
  const terms = new Map<string, string>();
  for (let i = 0; i < Math.max(0, ...perPerson.map(t => t.length)); i++) for (const list of perPerson) if (list[i]) terms.set(normalizar(list[i]!), list[i]!);
  if (!terms.size) terms.set('', '');
  const queries = [...terms.values()].slice(0, limits.maxSearchTerms);
  coverage.limited = terms.size > queries.length;
  const matchesByTerm = new Map<string, string[]>();
  const groups: string[][] = []; const known = new Map<string, DiscoveryStore>(); const seeds = new Map<string, DiscoveryItem[]>();
  for (const query of queries) {
    const found = await read(() => port.searchStores(query, address));
    if (found === undefined) break;
    coverage.terms++;
    for (const store of found) known.set(store.id, store);
    const matches = query && port.searchItems ? await read(() => port.searchItems!(query, address)) : [];
    matchesByTerm.set(normalizar(query), (matches ?? []).map(i => i.id));
    for (const item of matches ?? []) { const list = seeds.get(item.storeId) ?? []; list.push(item); seeds.set(item.storeId, list); }
    groups.push([...new Set([...(matches ?? []).map(i => i.storeId), ...found.filter(s => s.isOpen).map(s => s.id)])]);
  }
  const candidates = new Set<string>();
  for (let i = 0; i < Math.max(0, ...groups.map(g => g.length)); i++) for (const group of groups) {
    const id = group[i]; if (!id || known.get(id)?.isOpen === false) continue;
    if (candidates.size < limits.maxStores) candidates.add(id); else if (!candidates.has(id)) coverage.limited = true;
  }
  const stores: DiscoveryStore[] = []; const items: DiscoveryItem[] = []; let sawClosed = [...known.values()].some(s => !s.isOpen);
  for (const id of candidates) {
    const current = await read(() => port.getStore(id, address));
    if (current === undefined) break;
    if (current.id !== id) throw new Error('Estabelecimento divergente.');
    if (!current.isOpen) { sawClosed = true; continue; }
    const menu = await read(() => port.getMenu(id, address));
    if (menu === undefined) break;
    if (menu.storeOpen === false) { sawClosed = true; continue; }
    stores.push(current);
    coverage.limited ||= menu.coverage !== 'complete' || menu.truncated === true;
    const merged = new Map<string, DiscoveryItem>();
    for (const item of [...(seeds.get(id) ?? []), ...menu.items]) {
      if (item.storeId !== id) throw new Error('Produto fora do estabelecimento.');
      merged.set(item.id, item);
    }
    const available = [...merged.values()].filter(i => i.available !== false);
    const selected = limitarCandidatos(available, [...matchesByTerm.values()], limits.maxItemsPerStore);
    coverage.limited ||= available.length > selected.length;
    items.push(...selected);
  }
  // Distribui o limite global por loja para não eliminar a última preferência.
  const chosen: DiscoveryItem[] = [];
  for (let i = 0; i < limits.maxItemsPerStore; i++) for (const store of stores) {
    const item = items.filter(row => row.storeId === store.id)[i];
    if (item && chosen.length < limits.maxItems) chosen.push(item);
  }
  coverage.limited ||= items.length > chosen.length;
  coverage.stores = stores.length; coverage.items = chosen.length;
  return { stores, items: chosen, coverage, sawClosed, matchesByTerm };
}
