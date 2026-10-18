import type { MenuItem, MenuItemId, Participant, Store } from '../contracts.js';
import type { CatalogSnapshot } from './validar-escolhas.js';

export const normalizar = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Palavras do texto, sem acento e em minúsculas. */
export const palavras = (text: string) => normalizar(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Casa um termo com palavras inteiras do texto (já em palavras()).
 * - "mel": só a palavra "mel" (ou plural simples "meis"/"meles"); não casa "caramelo" nem "melancia".
 * - "bovin*": radical explícito, casa palavras que começam com "bovin" (bovino, bovina).
 * - "creme de leite": sequência de palavras; o "*" vale para a última.
 */
export function contemTermo(textoPalavras: readonly string[], termo: string): boolean {
  const radical = termo.endsWith('*');
  const partes = (radical ? termo.slice(0, -1) : termo).split(' ').filter(Boolean);
  const casa = (palavra: string, parte: string, ultima: boolean) =>
    ultima && radical ? palavra.startsWith(parte) : palavra === parte || palavra === `${parte}s` || palavra === `${parte}es`;

  return textoPalavras.some((_, inicio) =>
    partes.every((parte, j) => {
      const palavra = textoPalavras[inicio + j];
      return palavra !== undefined && casa(palavra, parte, j === partes.length - 1);
    }),
  );
}

// Termos (sem acento) que indicam ingrediente proibido em cada restrição. "*" = radical.
const FRUTOS_DO_MAR = ['camarao', 'lagosta', 'lula', 'polvo', 'marisco*', 'mexilh*', 'ostra*', 'siri', 'caranguejo', 'vieira*', 'frutos do mar'];
const CARNES = [
  'carne', 'bovin*', 'suin*', 'porco', 'frango', 'galinha', 'bacon', 'presunto', 'salame', 'mortadela', 'pepperoni', 'peru', 'chester',
  'calabresa', 'linguica', 'salsicha', 'hot dog', 'cachorro quente', 'hamburg*', 'burger*', 'cheeseburger*', 'costela', 'costelinha', 'picanha', 'alcatra',
  'maminha', 'fraldinha', 'cupim', 'contrafile', 'file', 'pernil', 'lombo', 'cordeiro', 'carneiro', 'nugget*', 'almondega*', 'kafta',
  'kibe', 'quibe', 'coxinha', 'peixe', 'salmao', 'atum', 'tilapia', 'bacalhau', 'sashimi', 'sushi', ...FRUTOS_DO_MAR,
];
// "x" é o "X-" de X-Burger/X-Salada, que leva queijo.
const LATICINIOS = [
  'queijo', 'leite', 'requeijao', 'manteiga', 'creme de leite', 'nata', 'chantilly', 'iogurte', 'mussarela', 'mucarela', 'muzzarela',
  'cheddar', 'catupiry', 'parmesao', 'provolone', 'gorgonzola', 'ricota', 'cream cheese', 'cheese*', 'x', 'chocolate', 'brigadeiro',
  'sorvete', 'milkshake', 'pudim', 'cappuccino', 'capuccino', 'latte',
];
const OVOS_MEL = ['ovo', 'mel', 'maionese'];
const GLUTEN = [
  'pao', 'paes', 'trigo', 'massa', 'macarrao', 'lasanha', 'nhoque', 'ravioli', 'bolo', 'lanche', 'sanduiche', 'hamburg*', 'burger*', 'cheeseburger*',
  'wrap', 'empanad*', 'empada', 'torta', 'pizza', 'misto', 'pastel', 'coxinha', 'esfiha', 'esfirra', 'kibe', 'quibe', 'croissant',
  'panqueca', 'crepe', 'waffle', 'torrada', 'biscoito*', 'cookie*', 'brownie', 'donut*', 'churros', 'cerveja',
];
const OLEAGINOSAS = ['noz', 'castanha*', 'amendoa*', 'avela*', 'pistache*', 'macadamia*', 'pecan', 'nutella'];
const AMENDOIM = ['amendoim', 'pacoca', 'pe de moleque'];

interface RegraRestricao {
  /** Termos que identificam a restrição no texto da pessoa. */
  match: string[];
  proibidos: string[];
  /** Termos que confirmam o item como seguro mesmo citando algo da lista (ex.: "vegano"). */
  seguros: string[];
  /** Expressões que citam um termo proibido sem conter o ingrediente (ex.: "pão de queijo" não tem trigo). */
  excecoes?: string[];
}

const REGRAS: RegraRestricao[] = [
  { match: ['vegan*'], proibidos: [...CARNES, ...LATICINIOS, ...OVOS_MEL], seguros: ['vegan*'], excecoes: ['leite de coco', 'leite vegetal', 'leite de aveia'] },
  { match: ['vegetarian*'], proibidos: CARNES, seguros: ['vegetarian*', 'vegan*', 'veggie'] },
  {
    match: ['lactose', 'laticinio*', 'leite'], proibidos: LATICINIOS, seguros: ['sem lactose', 'zero lactose', 'vegan*'],
    excecoes: ['leite de coco', 'leite vegetal', 'leite de aveia'],
  },
  {
    match: ['gluten', 'celiac*'], proibidos: GLUTEN, seguros: ['sem gluten'],
    excecoes: ['pao de queijo', 'paes de queijo', 'biscoito de polvilho', 'biscoitos de polvilho'],
  },
  { match: ['frutos do mar', 'marisco*', 'crustace*', 'camarao'], proibidos: FRUTOS_DO_MAR, seguros: [] },
  { match: ['noz', 'castanha*', 'oleaginos*', 'amendoa*'], proibidos: OLEAGINOSAS, seguros: [] },
  { match: ['amendoim'], proibidos: AMENDOIM, seguros: [] },
];

/** Tira do texto as expressões de exceção, sem juntar as palavras vizinhas. */
function semExcecoes(texto: readonly string[], excecoes: readonly string[]): string[] {
  const resto = [...texto];
  for (const excecao of excecoes) {
    const partes = excecao.split(' ');
    for (let i = 0; i + partes.length <= resto.length; ) {
      if (partes.every((parte, j) => resto[i + j] === parte)) resto.splice(i, partes.length, '|');
      else i++;
    }
  }
  return resto;
}

// Sinônimos para rejeições de gosto ("sem japonês" também evita sushi).
const JAPONES = ['japon*', 'japa', 'sushi', 'sashimi', 'temaki'];
const HAMBURGUER = ['hamburg*', 'burger*'];
const SINONIMOS: Record<string, string[]> = {
  japon: JAPONES,
  japa: JAPONES,
  hamburg: HAMBURGUER,
  burger: HAMBURGUER,
  doce: ['doce', 'bolo', 'brigadeiro', 'torta'],
};

const PALAVRAS_VAZIAS = new Set(['sem', 'alergia', 'alergico', 'alergica', 'a', 'de', 'ao', 'intolerancia', 'restricao', 'nada']);

const palavrasDoItem = (item: Pick<MenuItem, 'name' | 'description'>, store: Pick<Store, 'name'> | undefined) =>
  palavras(`${store?.name ?? ''} ${item.name} ${item.description ?? ''}`);

/** Palavras significativas de uma restrição sem regra conhecida ("alergia a amendoim" → ["amendoim"]). */
const palavrasChave = (texto: string) => palavras(texto).filter((w) => w.length >= 3 && !PALAVRAS_VAZIAS.has(w));

/**
 * Restrição dura. Para restrições conhecidas, usa listas de ingredientes;
 * para as demais (alergias), barra itens que citem a palavra-chave.
 * Item sem descrição não é provado seguro: veja itemIncerto.
 */
export function violaRestricao(item: Pick<MenuItem, 'name' | 'description'>, restricao: string): boolean {
  // Só o texto do item: o nome da loja ("Padaria Pão Quente") não diz o que o item contém.
  const texto = palavrasDoItem(item, undefined);
  const r = palavras(restricao);
  // Todas as regras que a restrição cita ("sem leite e sem glúten" aplica as duas).
  const regras = REGRAS.filter((rg) => rg.match.some((m) => contemTermo(r, m)));
  if (regras.length > 0) {
    return regras.some((regra) => {
      if (regra.seguros.some((s) => contemTermo(texto, s))) return false;
      const resto = semExcecoes(texto, regra.excecoes ?? []);
      return regra.proibidos.some((p) => contemTermo(resto, p));
    });
  }
  return palavrasChave(restricao).some((p) => contemTermo(texto, p));
}

/** Item que passou nas regras, mas sem descrição que confirme a restrição: sinalizar. */
export function itemIncerto(item: MenuItem, restricoes: readonly string[]): boolean {
  return restricoes.length > 0 && !item.description;
}

/** Rejeição de gosto: barra itens cuja loja ou texto citem o termo (ou sinônimo). */
export function evitado(item: Pick<MenuItem, 'name' | 'description'>, store: Pick<Store, 'name'> | undefined, avoid: string): boolean {
  const texto = palavrasDoItem(item, store);
  return palavrasChave(avoid).some((palavra) => {
    const chave = Object.keys(SINONIMOS).find((k) => palavra.startsWith(k));
    return (chave ? (SINONIMOS[chave] ?? []) : [palavra]).some((s) => contemTermo(texto, s));
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
