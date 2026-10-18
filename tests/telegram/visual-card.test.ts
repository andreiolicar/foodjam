import { expect, it } from 'vitest';
import { textosItensPropostaPreliminar } from '../../src/telegram/services/card.js';
const proposal = { id: 'p', sessionId: 's', organizerId: 'a', address: { formatted: 'Teste' }, participants: [{ id: 'a', displayName: 'Ana', preferences: {} }], items: [{ participantId: 'a', storeId: 's1', menuItemId: 'i1', quantity: 1 }, { participantId: 'a', storeId: 's2', menuItemId: 'i2', quantity: 1 }], status: 'preliminary' as const, pending: [] };
const names = { lojas: { s1: 'Burger <A>', s2: 'Açaí & B' }, itens: { i1: 'Burger', i2: 'Açaí' } };
it('cada loja exibe exclusivamente sua avaliação escapada', () => {
  const text = textosItensPropostaPreliminar({ proposal, nomes: names, stores: [{ id: 's1', name: 'A', isOpen: true, reviewRating: 4.7000001, ratingCount: 850 }, { id: 's2', name: 'B', isOpen: true, reviewRating: 3.9, ratingCount: 12 }] }).map(i => i.texto).join('\n');
  expect(text).toContain('Burger &lt;A&gt;</b>\n⭐ 4,7 (850 avaliações)');
  expect(text).toContain('Açaí &amp; B</b>\n⭐ 3,9 (12 avaliações)');
});
it('exibe nota sem contagem e omite contagem sem nota', () => {
  const text = textosItensPropostaPreliminar({ proposal, nomes: names, stores: [{ id: 's1', name: 'A', isOpen: true, reviewRating: 5 }, { id: 's2', name: 'B', isOpen: true, ratingCount: 12 }] }).map(i => i.texto).join('\n');
  expect(text).toContain('⭐ 5,0\n'); expect(text.match(/⭐/g)).toHaveLength(1); expect(text).not.toContain('12 avaliações');
});
it('avaliações ausentes ou inválidas não fabricam zero', () => {
  const text = textosItensPropostaPreliminar({ proposal, nomes: names, stores: [{ id: 's1', name: 'A', isOpen: true, reviewRating: 6 }, { id: 's2', name: 'B', isOpen: true }] }).map(i => i.texto).join('\n');
  expect(text).not.toContain('⭐');
});
