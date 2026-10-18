import { expect, it } from 'vitest';
import { botoesPreliminares, textoPropostaPreliminar, textosItensPropostaPreliminar } from '../../src/telegram/services/card.js';
const participants = ['p1', 'p2'].map(id => ({ id, displayName: `Pessoa ${id}`, preferences: {} }));
const proposal = { id: 'private-proposal', sessionId: 'private-group', organizerId: 'p1', address: { id: 'private-address', formatted: 'Endereço privado' }, participants, items: [{ participantId: 'p1', storeId: 'private-merchant', menuItemId: 'private-item', quantity: 1 }], status: 'preliminary' as const, pending: ['commercial_validation' as const] };
it('card preliminar mantém o visual e apresenta incerteza, cobertura e nomes sem dados privados', () => {
  const data = { proposal, nomes: { lojas: { 'private-merchant': 'Loja <teste>' }, itens: { 'private-item': 'Produto real controlado' } }, items: [{ id: 'private-item', storeId: 'private-merchant', name: 'Produto real controlado' }] };
  const summary = textoPropostaPreliminar(data);
  const text = [summary, ...textosItensPropostaPreliminar(data).map(i => i.texto)].join('\n');
  expect(summary).not.toContain('Produto real controlado');
  expect(text).toContain('Loja &lt;teste&gt;'); expect(text).toContain('Produto real controlado');
  expect(text).toContain('preço a confirmar'); expect(text).not.toContain('disponibilidade não confirmada');
  expect(text).toContain('1 de 2'); expect(text).toContain('Pessoa p2'); expect(text).toContain('valores finais não confirmados');
  expect(text).not.toMatch(/private-|Endereço privado|R\$ 0/);
  const labels = botoesPreliminares(true).flat().map(b => b.texto).join(' ');
  expect(labels).toContain('Revisar proposta preliminar'); expect(labels).toContain('Outra opção'); expect(labels).not.toContain('Confirmar pedido');
});
it.each([undefined, true, false])('disponibilidade %s mantém incerteza comercial apenas no resumo e indisponibilidade explícita no item', available => {
  const item = { id: 'private-item', storeId: 'private-merchant', name: 'Produto <teste>', priceCents: 2590,
    itemImageUrl: 'https://static.ifood-static.com.br/produto.jpg', ...(available === undefined ? {} : { available }) };
  const data = { proposal, items: [item], stores: [{ id: 'private-merchant', name: 'Loja teste', isOpen: true, reviewRating: 4.9, ratingCount: 12 }] };
  const before = structuredClone(data);
  const [card] = textosItensPropostaPreliminar(data);
  expect(card!.texto).toContain('Produto &lt;teste&gt;');
  expect(card!.texto).toContain('Pessoa p1: 1×');
  expect(card!.texto).toContain('R$ 25,90 por unidade');
  expect(card!.texto).toContain('⭐ 4,9 (12 avaliações)');
  expect(card!.itemImageUrl).toBe(item.itemImageUrl);
  expect(card!.texto).not.toMatch(/disponibilidade|confirmar no carrinho/);
  expect(card!.texto.includes('indisponível')).toBe(available === false);
  const summary = textoPropostaPreliminar(data);
  expect(summary.match(/Disponibilidade/g)).toHaveLength(1);
  expect(summary).toContain('Disponibilidade e valores comerciais ainda precisam de confirmação.');
  expect(summary).toContain('Frete, taxas, descontos e valores finais não confirmados.');
  expect(summary).toContain('Nenhum carrinho, pagamento ou compra foi autorizado.');
  expect(summary).not.toContain('Produto &lt;teste&gt;');
  expect(data).toEqual(before);
});
it('preço unitário comprovado é exibido sem virar total final nem revelar orçamento', () => {
  const names = { lojas: { 'private-merchant': 'Loja teste' }, itens: { 'private-item': 'Produto teste' } };
  const item = { id: 'private-item', storeId: 'private-merchant', name: 'Produto teste' };
  const known = textosItensPropostaPreliminar({ proposal, nomes: names, items: [{ ...item, priceCents: 2590 }] })[0]!.texto;
  expect(known).toContain('R$ 25,90 por unidade'); expect(textoPropostaPreliminar({ proposal })).not.toMatch(/R\$|[Ss]ubtotal|[Tt]otal/);
  const base = textosItensPropostaPreliminar({ proposal, nomes: names, items: [{ ...item, basePriceCents: 2590 }] })[0]!.texto;
  expect(base).toContain('preço base R$ 25,90'); expect(base).toContain('promoção/valor aplicável a confirmar');
});
