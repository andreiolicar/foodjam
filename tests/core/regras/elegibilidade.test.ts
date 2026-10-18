import { describe, expect, it } from 'vitest';
import type { MenuItem, Participant, Store } from '../../../src/core/contracts.js';
import { contemTermo, evitado, itemIncerto, itensElegiveis, palavras, violaRestricao } from '../../../src/core/regras/elegibilidade.js';
import { catalogoCompleto } from '../fixtures.js';

const item = (name: string, description?: string): MenuItem => ({
  id: name,
  storeId: 'l',
  name,
  priceCents: 1000,
  available: true,
  ...(description !== undefined && { description }),
});
const loja = (name: string): Store => ({ id: 'l', name, isOpen: true, deliveryFeeCents: 0 });

describe('violaRestricao', () => {
  it.each([
    ['vegetariano', item('X-Salada', 'hambúrguer bovino e queijo'), true],
    ['vegetariano', item('Burger Veggie', 'Hambúrguer de grão-de-bico, vegetariano'), false],
    ['vegetariana', item('Misto Quente', 'presunto e queijo'), true],
    ['vegano', item('Salada Caprese', 'tomate, mussarela'), true],
    ['vegano', item('Bowl', 'vegano, legumes'), false],
    ['sem lactose', item('Café com Leite'), true],
    ['intolerância a lactose', item('Suco de laranja'), false],
    ['sem glúten', item('Bolo de Cenoura', 'Fatia'), true],
    ['celíaco', item('Salada', 'folhas'), false],
    ['alergia a amendoim', item('Paçoca', 'doce de amendoim'), true],
    ['alergia a amendoim', item('Brigadeiro'), false],
  ])('%s × %j → %s', (restricao, menuItem, esperado) => {
    expect(violaRestricao(menuItem, restricao)).toBe(esperado);
  });

  it.each([
    ['caramelo', item('Picolé de fruta', 'calda de caramelo'), false],
    ['melancia', item('Suco de melancia'), false],
    ['mel', item('Torrada', 'com mel e canela'), true],
    ['MEL com acento e caixa', item('Chá gelado', 'adoçado com MÉL'), true],
    ['ovos (plural)', item('Omelete', 'dois ovos'), true],
    ['novo (contém "ovo")', item('Sabor novo', 'suco de uva'), false],
  ])('vegano × %s: palavra inteira', (_nome, menuItem, esperado) => {
    expect(violaRestricao(menuItem, 'vegano')).toBe(esperado);
  });

  it.each([
    ['peruano não é peru', item('Ceviche de legumes', 'estilo peruano'), false],
    ['bovina (radical bovin*)', item('Almôndega', 'carne bovina'), true],
  ])('vegetariano × %s', (_nome, menuItem, esperado) => {
    expect(violaRestricao(menuItem, 'vegetariano')).toBe(esperado);
  });

  it('expressão de várias palavras casa em sequência', () => {
    expect(violaRestricao(item('Strogonoff de cogumelos', 'com creme de leite'), 'sem lactose')).toBe(true);
    expect(violaRestricao(item('Salada', 'creme de abacate, folhas'), 'sem lactose')).toBe(false);
  });

  it.each([
    ['vegetariano', item('X-Burger'), true],
    ['vegetariano', item('Cheeseburger duplo'), true],
    ['vegetariano', item('Costela no bafo'), true],
    ['vegetariano', item('Nuggets (10 un.)'), true],
    ['vegetariano', item('Burger Veggie'), false],
    ['vegano', item('X-Salada', 'alface e tomate'), true],
    ['sem lactose', item('Cheeseburger'), true],
    ['sem lactose', item('Açaí com leite de coco'), false],
    ['sem glúten', item('Pão de queijo (6 un.)'), false],
    ['sem glúten', item('Pão de queijo na chapa', 'com pão francês'), true],
    ['sem glúten', item('Biscoito de polvilho'), false],
    ['sem glúten', item('Lasanha à bolonhesa'), true],
    ['celíaco', item('Coxinha de frango'), true],
    ['alergia a frutos do mar', item('Risoto de camarão'), true],
    ['alergia a frutos do mar', item('Risoto de cogumelos'), false],
    ['alergia a nozes', item('Brownie', 'com castanha de caju'), true],
    ['alergia a amendoim', item('Pé de moleque'), true],
    ['sem leite e sem glúten', item('Pão de queijo'), true],
  ])('listas ampliadas: %s × %j → %s', (restricao, menuItem, esperado) => {
    expect(violaRestricao(menuItem, restricao)).toBe(esperado);
  });

  it('o nome da loja não conta para restrição ("Padaria Pão Quente" não torna o café um item com glúten)', () => {
    expect(violaRestricao(item('Café', 'coado'), 'sem glúten')).toBe(false);
  });
});

describe('evitado', () => {
  it.each([
    ['japonês', item('Combo', 'Sushi e sashimi'), loja('Sushi Kento'), true],
    ['japa', item('Temaki de Salmão'), loja('Kento'), true],
    ['hambúrguer', item('Burger Veggie', 'vegetariano'), loja('Hamburgueria do Zé'), true],
    ['hambúrguer', item('Bolo de Cenoura'), loja('Padaria'), false],
    ['pizza', item('Pizza Margherita'), loja('Forno'), true],
  ])('evita %s em %j', (avoid, menuItem, store, esperado) => {
    expect(evitado(menuItem, store, avoid)).toBe(esperado);
  });
});

describe('itemIncerto', () => {
  it('só quando há restrição e o item não tem descrição', () => {
    expect(itemIncerto(item('Brigadeiro'), ['sem lactose'])).toBe(true);
    expect(itemIncerto(item('Brigadeiro', 'chocolate'), ['sem lactose'])).toBe(false);
    expect(itemIncerto(item('Brigadeiro'), [])).toBe(false);
  });
});

describe('itensElegiveis', () => {
  const pessoa = (preferences: Participant['preferences']): Participant => ({ id: 'p', displayName: 'P', preferences });

  it('exclui loja fechada e item indisponível', async () => {
    const ids = itensElegiveis(pessoa({}), await catalogoCompleto()).map((i) => i.id);
    expect(ids).not.toContain('burger-duplo');
    expect(ids.some((id) => id.startsWith('japa-'))).toBe(false);
  });

  it('aplica restrição, avoids e orçamento unitário juntos', async () => {
    const ids = itensElegiveis(
      pessoa({ dietaryRestrictions: ['vegetariano'], avoids: ['doce'], budgetCents: 2800 }),
      await catalogoCompleto(),
    ).map((i) => i.id);

    expect(ids).toContain('burger-veggie');
    expect(ids).toContain('pad-cafe');
    expect(ids).not.toContain('burger-x-salada');
    expect(ids).not.toContain('pad-misto');
    expect(ids.some((id) => id.startsWith('doce-'))).toBe(false);
    expect(ids).not.toContain('verde-bowl');
  });
});

describe('contemTermo', () => {
  const p = palavras('Pão de Queijo com MEL; carne bovina e creme de leite');
  it.each([
    ['mel', true],
    ['me', false],
    ['bovin*', true],
    ['bovin', false],
    ['pao', true],
    ['creme de leite', true],
    ['creme de queijo', false],
    ['queijo', true],
  ])('%s → %s', (termo, esperado) => {
    expect(contemTermo(p, termo)).toBe(esperado);
  });
});
