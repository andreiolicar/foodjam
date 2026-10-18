import type { MenuItem } from '../contracts.js';
import { contemTermo, palavras } from './elegibilidade.js';

export type Categoria = 'food' | 'drink';

// Termos (sem acento, palavra inteira; "*" = radical) que indicam bebida.
const BEBIDAS = [
  'bebida*', 'refrigerante*', 'refri', 'suco*', 'agua', 'cafe', 'cha', 'cerveja*', 'vinho*', 'drink*', 'lata', 'garrafa',
  'milkshake*', 'shake*', 'smoothie*', 'cappuccino*', 'capuccino*', 'latte', 'espresso', 'expresso', 'energetico*',
  'chocolate quente', 'limonada*', 'laranjada*', 'mate', 'kombucha', 'isotonico*',
];
// Termos que, se presentes, fazem o item ser comida mesmo citando bebida ("café da manhã", "bolo de chocolate").
const COMIDAS = [
  'cafe da manha', 'pao', 'paes', 'lanche*', 'sanduiche*', 'misto', 'bolo*', 'torta*', 'salada*', 'bowl', 'wrap',
  'hamburguer*', 'burger*', 'pizza*', 'prato*', 'combo*', 'porcao', 'porcoes', 'pastel', 'coxinha*', 'tapioca*', 'brigadeiro*',
];

/**
 * Categoria do item. Usa a do catálogo quando vier; senão, infere de forma
 * conservadora pelo nome e pela descrição: só é bebida quando os termos de
 * bebida aparecem e nenhum termo de comida aparece. Na dúvida, comida
 * (para nunca barrar uma comida de verdade).
 */
export function categoriaDoItem(item: Pick<MenuItem, 'name' | 'description' | 'category'>): Categoria {
  if (item.category) return item.category;
  const texto = palavras(`${item.name} ${item.description ?? ''}`);
  if (COMIDAS.some((t) => contemTermo(texto, t))) return 'food';
  return BEBIDAS.some((t) => contemTermo(texto, t)) ? 'drink' : 'food';
}

/** O desejo pede bebida ("um suco", "café")? Caso contrário, é de comida ("algo leve", "lanche"). */
export function categoriaDoDesejo(desejo: string): Categoria {
  const texto = palavras(desejo);
  if (COMIDAS.some((t) => contemTermo(texto, t))) return 'food';
  return BEBIDAS.some((t) => contemTermo(texto, t)) ? 'drink' : 'food';
}
