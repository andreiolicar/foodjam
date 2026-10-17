import type { MenuItem, Participant, Store, StoreId } from './contracts.js';
import type { CatalogPort } from './ports.js';
import { normalizar } from './regras/elegibilidade.js';
import type { CatalogSnapshot, TimedCatalogSnapshot } from './regras/validar-escolhas.js';

export const MAX_CANDIDATE_STORES = 4;
export const MAX_SEARCH_TERMS = 8;

/** Palavras que não ajudam a buscar loja ("algo leve" → "leve"; "qualquer coisa" → nada). */
const GENERICAS = new Set([
  'algo', 'alguma', 'algum', 'coisa', 'comida', 'qualquer', 'um', 'uma', 'de', 'do', 'da', 'pra', 'para',
  'barato', 'barata', 'tanto', 'faz', 'opcao', 'bem',
]);

/** Termos de busca a partir do que as pessoas querem, sem duplicados e com limite. */
export function termosDeBusca(participants: readonly Participant[]): string[] {
  const termos = new Set<string>();
  for (const p of participants) {
    for (const pref of p.preferences.foodPreferences ?? []) {
      const termo = pref
        .split(/\s+/)
        .filter((w) => w && !GENERICAS.has(normalizar(w)))
        .join(' ')
        .trim();
      if (termo) termos.add(termo);
    }
  }
  return [...termos].slice(0, MAX_SEARCH_TERMS);
}

/**
 * Recuperação em código: busca lojas pelos termos, conta quantos termos cada
 * loja aberta atende, fica com as melhores e baixa os cardápios. Sem nenhum
 * termo útil (ou nenhum resultado), usa a busca vazia como fallback.
 */
export async function buscarCandidatas(
  port: CatalogPort,
  participants: readonly Participant[],
  now: string,
): Promise<TimedCatalogSnapshot> {
  const hits = new Map<StoreId, { store: Store; count: number }>();
  const registrar = (stores: Store[], conta: number) => {
    for (const store of stores) {
      if (!store.isOpen) continue;
      const atual = hits.get(store.id);
      hits.set(store.id, { store, count: (atual?.count ?? 0) + conta });
    }
  };

  for (const termo of termosDeBusca(participants)) {
    registrar(await port.searchStores(termo), 1);
  }
  if (hits.size === 0) {
    registrar(await port.searchStores(''), 0);
  }

  const stores = [...hits.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CANDIDATE_STORES)
    .map((h) => h.store);
  const menuItems: MenuItem[] = (await Promise.all(stores.map((s) => port.getMenu(s.id)))).flat();
  return { stores, menuItems, fetchedAt: now };
}

/**
 * Reconsulta lojas e cardápios de um retrato, para o fechamento. Como a porta
 * não busca loja por id, procura pelo nome e confere o id. Loja que não volta
 * fica de fora (e o fechamento acusa item fora do catálogo).
 */
export async function atualizarCatalogo(
  port: CatalogPort,
  snapshot: CatalogSnapshot,
  storeIds: readonly StoreId[],
  now: string,
): Promise<TimedCatalogSnapshot> {
  const stores: Store[] = [];
  for (const id of new Set(storeIds)) {
    const antiga = snapshot.stores.find((s) => s.id === id);
    if (!antiga) continue;
    const atual = (await port.searchStores(antiga.name)).find((s) => s.id === id);
    if (atual) stores.push(atual);
  }
  const menuItems = (await Promise.all(stores.map((s) => port.getMenu(s.id)))).flat();
  return { stores, menuItems, fetchedAt: now };
}
