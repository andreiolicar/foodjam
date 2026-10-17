import { describe, expect, it } from 'vitest';
import type { MenuItem, Participant, Store } from '../../../src/core/contracts.js';
import { evitado, itemIncerto, itensElegiveis, violaRestricao } from '../../../src/core/regras/elegibilidade.js';
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
