import type { MenuItem } from '../contracts.js';
import { categoriaDoItem } from './categoria.js';
import { palavras } from './elegibilidade.js';

// Equivalências de nome, não famílias vagas de alimentos. Sem aproximação por
// distância de edição: um termo desconhecido precisa aparecer no próprio nome.
const ALIASES: Readonly<Record<string, string>> = {
  capuccino: 'cappuccino', cappucino: 'cappuccino',
  hamburger: 'hamburguer', burger: 'hamburguer', burguer: 'hamburguer',
  refri: 'refrigerante', espresso: 'expresso',
  aipim: 'mandioca', macaxeira: 'mandioca', mucarela: 'mussarela',
  paes: 'pao', soluveis: 'soluvel',
};
const CONECTORES = new Set(['a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'e', 'ao', 'no', 'na']);
const PEDIDO = new Set(['quero', 'queria', 'gostaria', 'desejo', 'pedir', 'comer', 'tomar', 'beber', 'para', 'pra', 'por', 'favor', 'um', 'uma']);
const GENERICOS = new Set(['algo', 'algum', 'alguma', 'qualquer', 'coisa', 'comida', 'refeicao', 'opcao', 'leve', 'tanto', 'faz']);
const NOMES_GENERICOS = new Set(['produto', 'item', 'bebida', 'comida', 'categoria', 'cardapio', 'menu', 'oferta', 'promocao']);
// Contexto amplo explícito; pertencer apenas a food/drink não prova pertinência.
const CAFE_DA_MANHA = new Set(['pao', 'misto', 'croissant', 'cappuccino', 'cafe', 'expresso', 'latte', 'suco', 'vitamina', 'iogurte', 'granola', 'fruta', 'ovo', 'tapioca', 'cuscuz', 'panqueca', 'bolo', 'queijo']);
const COMIDAS = new Set(['pao', 'misto', 'croissant', 'iogurte', 'granola', 'fruta', 'ovo', 'tapioca', 'cuscuz', 'panqueca', 'bolo', 'queijo',
  'hamburguer', 'sanduiche', 'pizza', 'arroz', 'feijao', 'salada', 'prato', 'lanche', 'pastel', 'coxinha', 'acai', 'falafel', 'quibe', 'kibe', 'esfiha', 'risoto', 'massa', 'lasanha', 'macarrao', 'sushi', 'sashimi', 'temaki', 'wrap', 'bowl', 'porcao']);
const BEBIDAS = new Set(['agua', 'suco', 'cafe', 'cappuccino', 'expresso', 'latte', 'cha', 'refrigerante', 'limonada', 'vitamina', 'milkshake', 'shake', 'smoothie', 'cerveja', 'vinho', 'kombucha', 'isotonico', 'energetico', 'chocolate']);
const REFEICOES = new Set(['lanche', 'prato', 'almoco', 'jantar']);
// Insumo/concentrado não demonstra a versão pronta para consumo de um pedido.
const FORMATOS = ['em po', 'capsula', 'sache', 'concentrado', 'mistura', 'moido', 'moida', 'grao', 'soluvel'];

function singular(word: string): string {
  if (Object.hasOwn(ALIASES, word)) return ALIASES[word]!;
  const value = word.replace(/([rz])es$/, '$1').replace(/([aeiou])s$/, '$1');
  return Object.hasOwn(ALIASES, value) ? ALIASES[value]! : value;
}
function texto(text: string): string {
  return palavras(text).join(' ').replace(/\bpao de sal\b/g, 'pao frances');
}
function termos(text: string): string[] {
  return text.split(' ').filter(Boolean).map(singular)
    .filter(t => !CONECTORES.has(t) && !PEDIDO.has(t));
}

/**
 * Guardrail de evidência, não classificador: a IA ainda precisa aprovar o item.
 * Pedido específico exige a identidade no início do nome real, incluindo seus
 * qualificadores, sem usar descrição, loja, categoria comercial ou preço como
 * prova. Falta de evidência implica descarte, nunca preenchimento de cobertura.
 */
export function compatibilidadeComprovada(desejo: string, item: Pick<MenuItem, 'name' | 'category'>): boolean {
  const name = termos(texto(item.name));
  if (!name.length || NOMES_GENERICOS.has(name[0]!)) return false;
  const wish = texto(desejo);
  const breakfast = /\bcafe da manha\b/.test(wish);
  const requested = termos(wish.replace(/\bcafe da manha\b/g, '')).filter(t => !GENERICOS.has(t));
  const namedCategory = categoriaDoItem({ name: item.name });
  if (item.category && item.category !== namedCategory) return false;
  const nameText = ` ${name.join(' ')} `; const wishText = ` ${termos(wish).join(' ')} `;
  if (FORMATOS.some(format => nameText.includes(` ${format} `) && !wishText.includes(` ${format} `))) return false;
  if (!breakfast && requested.length === 1 && REFEICOES.has(requested[0]!)) return COMIDAS.has(name[0]!) && namedCategory === 'food';
  if (!breakfast && requested.length === 1 && requested[0] === 'bebida') return BEBIDAS.has(name[0]!) && namedCategory === 'drink';
  if (requested.length) {
    // Ex.: pão de alho COM queijo não demonstra pão DE queijo; bolo DE
    // cappuccino não é a bebida. Coincidências soltas/ingredientes não bastam.
    return categoriaDoItem({ name: requested.join(' ') }) === namedCategory
      && requested.every((term, index) => name[index] === term);
  }
  if (breakfast) return CAFE_DA_MANHA.has(name[0]!);
  // Indiferença explícita continua delegando a pertinência ao classificador,
  // mas não autoriza bebida isolada para um pedido amplo de comida.
  return termos(wish).some(t => GENERICOS.has(t)) && COMIDAS.has(name[0]!) && namedCategory === 'food';
}
