import type { MenuItem, MenuItemId, Participant, Store } from '../contracts.js';
import type { CatalogSnapshot } from './validar-escolhas.js';

export const normalizar = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

// Palavras (sem acento) que indicam ingrediente proibido em cada restrição.
const CARNES = ['carne', 'bovin', 'frango', 'bacon', 'presunto', 'salmao', 'peixe', 'atum', 'camarao', 'calabresa', 'linguica', 'peru', 'sashimi', 'sushi'];
const LATICINIOS = ['queijo', 'leite', 'requeijao', 'manteiga', 'creme de leite', 'iogurte', 'mussarela', 'chocolate', 'brigadeiro'];
const OVOS_MEL = ['ovo', 'mel', 'maionese'];
const GLUTEN = ['pao', 'trigo', 'massa', 'bolo', 'lanche', 'wrap', 'empanad', 'torta', 'pizza', 'misto'];

interface RegraRestricao {
  /** Fragmentos (sem acento) que identificam a restrição no texto da pessoa. */
  match: string[];
  proibidos: string[];
  /** Termos que confirmam o item como seguro mesmo citando algo da lista (ex.: "vegano"). */
  seguros: string[];
}

const REGRAS: RegraRestricao[] = [
  { match: ['vegan'], proibidos: [...CARNES, ...LATICINIOS, ...OVOS_MEL], seguros: ['vegan'] },
  { match: ['vegetarian'], proibidos: CARNES, seguros: ['vegetarian', 'vegan'] },
  { match: ['lactose', 'laticinio', 'leite'], proibidos: LATICINIOS, seguros: ['sem lactose', 'vegan'] },
  { match: ['gluten', 'celiac'], proibidos: GLUTEN, seguros: ['sem gluten'] },
];

// Sinônimos para rejeições de gosto ("sem japonês" também evita sushi).
const SINONIMOS: Record<string, string[]> = {
  japon: ['japon', 'japa', 'sushi', 'sashimi', 'temaki'],
  japa: ['japon', 'japa', 'sushi', 'sashimi', 'temaki'],
  hamburg: ['hamburg', 'burger'],
  burger: ['hamburg', 'burger'],
  doce: ['doce', 'bolo', 'brigadeiro', 'torta'],
};

const PALAVRAS_VAZIAS = new Set(['sem', 'alergia', 'alergico', 'alergica', 'a', 'de', 'ao', 'intolerancia', 'restricao', 'nada']);

const textoDoItem = (item: MenuItem, store: Store | undefined) =>
  normalizar(`${store?.name ?? ''} ${item.name} ${item.description ?? ''}`);

/** Palavras significativas de uma restrição sem regra conhecida ("alergia a amendoim" → ["amendoim"]). */
const palavrasChave = (texto: string) =>
  normalizar(texto)
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !PALAVRAS_VAZIAS.has(w));

/**
 * Restrição dura. Para restrições conhecidas, usa listas de ingredientes;
 * para as demais (alergias), barra itens que citem a palavra-chave.
 * Item sem descrição não é provado seguro: veja itemIncerto.
 */
export function violaRestricao(item: MenuItem, restricao: string): boolean {
  // Só o texto do item: o nome da loja ("Padaria Pão Quente") não diz o que o item contém.
  const texto = textoDoItem(item, undefined);
  const r = normalizar(restricao);
  const regra = REGRAS.find((rg) => rg.match.some((m) => r.includes(m)));
  if (regra) {
    if (regra.seguros.some((s) => texto.includes(s))) return false;
    return regra.proibidos.some((p) => texto.includes(p));
  }
  return palavrasChave(restricao).some((p) => texto.includes(p));
}

/** Item que passou nas regras, mas sem descrição que confirme a restrição: sinalizar. */
export function itemIncerto(item: MenuItem, restricoes: readonly string[]): boolean {
  return restricoes.length > 0 && !item.description;
}

/** Rejeição de gosto: barra itens cuja loja ou texto citem o termo (ou sinônimo). */
export function evitado(item: MenuItem, store: Store | undefined, avoid: string): boolean {
  const texto = textoDoItem(item, store);
  return palavrasChave(avoid).some((palavra) => {
    const chave = Object.keys(SINONIMOS).find((k) => palavra.startsWith(k));
    return (chave ? (SINONIMOS[chave] ?? []) : [palavra]).some((s) => texto.includes(s));
  });
}

/**
 * Itens que a pessoa pode receber: disponíveis, de loja aberta, sem violar
 * restrições nem avoids e com preço unitário dentro do orçamento (quando houver).
 * O modelo só pode escolher daqui.
 */
export function itensElegiveis(participant: Participant, catalog: CatalogSnapshot): MenuItem[] {
  const { dietaryRestrictions = [], avoids = [], budgetCents } = participant.preferences;
  const stores = new Map(catalog.stores.map((s) => [s.id, s]));

  return catalog.menuItems.filter((item) => {
    const store = stores.get(item.storeId);
    if (!store?.isOpen || !item.available) return false;
    if (budgetCents !== undefined && item.priceCents > budgetCents) return false;
    if (dietaryRestrictions.some((r) => violaRestricao(item, r))) return false;
    return !avoids.some((a) => evitado(item, store, a));
  });
}

export function idsElegiveis(participant: Participant, catalog: CatalogSnapshot): Set<MenuItemId> {
  return new Set(itensElegiveis(participant, catalog).map((i) => i.id));
}
