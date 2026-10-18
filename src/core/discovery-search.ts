import type { DeliveryAddress, DiscoveryCoverage, DiscoveryCoverageReason, DiscoveryItem, DiscoveryStore, Participant } from './contracts.js';
import type { DiscoveryCatalogPort, DiscoverySearchOptions } from './ports.js';
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
  const deadline = start + limits.deadlineMs;
  const operation = new AbortController(); let callMs = limits.deadlineMs;
  const coverage: DiscoveryCoverage = { terms: 0, stores: 0, items: 0, requests: 0, limited: false, reasons: [] };
  function limited(reason: DiscoveryCoverageReason) {
    coverage.limited = true;
    if (!coverage.reasons!.includes(reason)) coverage.reasons!.push(reason);
  }
  async function read<T>(request: (context: DiscoverySearchOptions) => Promise<T>, until = deadline, allowance = callMs): Promise<T | undefined> {
    const requestsExhausted = coverage.requests >= limits.maxRequests;
    const timeExhausted = Date.now() - start >= limits.deadlineMs;
    if (requestsExhausted) limited('request_limit');
    if (timeExhausted) limited('time_limit');
    if (requestsExhausted || timeExhausted || operation.signal.aborted) return undefined;
    const wait = Math.min(deadline, until, Date.now() + allowance) - Date.now();
    if (wait <= 0) { limited('time_limit'); return undefined; }
    coverage.requests++;
    const controller = new AbortController(); const abort = () => controller.abort();
    operation.signal.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined; let settled = false;
    const context: DiscoverySearchOptions = { signal: controller.signal, firstPageOnly: true,
      onTruncated: () => { if (!settled && !controller.signal.aborted) limited('pagination_truncated'); } };
    try {
      const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => { limited('time_limit'); controller.abort(); resolve(undefined); }, wait); });
      controller.signal.throwIfAborted();
      return await Promise.race([request(context), timeout]);
    } catch (error) {
      // Só nosso prazo/cancelamento vira ausência. Falha real de transporte ou
      // de interpretação continua interrompendo, sem simular catálogo vazio.
      if (!controller.signal.aborted) throw error;
      limited('time_limit'); return undefined;
    } finally {
      settled = true;
      if (timer) clearTimeout(timer);
      // SDK mantém listener após sucesso: abortá-lo geraria POST de
      // notifications/cancelled para uma leitura que já terminou.
      operation.signal.removeEventListener('abort', abort);
    }
  }
  async function execute() {
  const perPerson = participants.map(p => termosDeBusca([p]));
  const terms = new Map<string, string>();
  for (let i = 0; i < Math.max(0, ...perPerson.map(t => t.length)); i++) for (const list of perPerson) if (list[i]) terms.set(normalizar(list[i]!), list[i]!);
  if (!terms.size) terms.set('', '');
  const queries = [...terms.values()].slice(0, limits.maxSearchTerms);
  if (terms.size > queries.length) limited('term_limit');
  if (port.forDiscovery) {
    const scoped = await read(context => port.forDiscovery!(address, context), deadline, limits.deadlineMs);
    if (scoped) port = scoped;
    else return { stores: [], items: [], coverage: { ...coverage, candidateStores: 0, checkedStores: 0, closedStores: 0 }, sawClosed: false, matchesByTerm: new Map<string, string[]>() };
  }
  // Metade da janela e das leituras fica disponível para comprovar lojas/menu.
  // Cada leitura também tem uma fatia, para um desejo lento não bloquear todos.
  const remainingMs = Math.max(0, deadline - Date.now());
  const searchDeadline = Date.now() + Math.floor(remainingMs / 2);
  callMs = Math.max(1, Math.floor(remainingMs / (queries.length + 2)));
  const searchBudget = Math.max(2, Math.floor(limits.maxRequests / 2));
  let searchReads = 0;
  const search = <T>(request: (context: DiscoverySearchOptions) => Promise<T>) => {
    if (searchReads >= searchBudget) { limited('request_limit'); return Promise.resolve(undefined); }
    searchReads++; return read(request, searchDeadline);
  };
  const matchesByTerm = new Map<string, string[]>();
  const groups: string[][] = []; const known = new Map<string, DiscoveryStore>(); const seeds = new Map<string, DiscoveryItem[]>();
  const results: { found: DiscoveryStore[]; matches: DiscoveryItem[] }[] = [];
  let next = 0;
  async function worker() {
    for (let index = next++; index < queries.length; index = next++) {
      const query = queries[index]!;
      const found = await search(context => port.searchStores(query, address, context));
      const matches = query && port.searchItems ? await search(context => port.searchItems!(query, address, context)) : [];
      if (found !== undefined || matches !== undefined && query && port.searchItems) coverage.terms++;
      results[index] = { found: found ?? [], matches: matches ?? [] };
    }
  }
  // O adaptador/MCP nunca recebe rajada ilimitada: duas leituras no máximo.
  await Promise.all(Array.from({ length: Math.min(2, queries.length) }, () => worker()));
  for (const [index, query] of queries.entries()) {
    const { found, matches } = results[index]!;
    for (const store of found) known.set(store.id, store);
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
    const current = await read(context => port.getStore(id, address, context));
    if (current === undefined) { if (Date.now() >= deadline || coverage.requests >= limits.maxRequests) break; continue; }
    coverage.checkedStores++;
    if (current.id !== id) throw new Error('Estabelecimento divergente.');
    if (current.isOpen !== true) { if (current.isOpen === false) closed.add(id); continue; }
    const menu = await read(context => port.getMenu(id, address, context), deadline, callMs * 2);
    if (menu === undefined) { if (Date.now() >= deadline || coverage.requests >= limits.maxRequests) break; continue; }
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
  try { return await execute(); }
  finally { operation.abort(); }
}
