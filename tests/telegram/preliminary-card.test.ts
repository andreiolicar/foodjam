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
  expect(text).toContain('preço a confirmar'); expect(text).toContain('disponibilidade não confirmada');
  expect(text).toContain('1 de 2'); expect(text).toContain('Pessoa p2'); expect(text).toContain('valores finais não confirmados');
  expect(text).not.toMatch(/private-|Endereço privado|R\$ 0/);
  const labels = botoesPreliminares(true).flat().map(b => b.texto).join(' ');
  expect(labels).toContain('Revisar proposta preliminar'); expect(labels).toContain('Outra opção'); expect(labels).not.toContain('Confirmar pedido');
});
it('preço unitário comprovado é exibido sem virar total final nem revelar orçamento', () => {
  const names = { lojas: { 'private-merchant': 'Loja teste' }, itens: { 'private-item': 'Produto teste' } };
  const item = { id: 'private-item', storeId: 'private-merchant', name: 'Produto teste' };
  const known = textosItensPropostaPreliminar({ proposal, nomes: names, items: [{ ...item, priceCents: 2590 }] })[0]!.texto;
  expect(known).toContain('R$ 25,90 por unidade'); expect(textoPropostaPreliminar({ proposal })).not.toMatch(/R\$|[Ss]ubtotal|[Tt]otal/);
  const base = textosItensPropostaPreliminar({ proposal, nomes: names, items: [{ ...item, basePriceCents: 2590 }] })[0]!.texto;
  expect(base).toContain('preço base R$ 25,90'); expect(base).toContain('promoção/valor aplicável a confirmar');
});
