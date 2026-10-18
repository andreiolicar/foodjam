import { describe, expect, it } from 'vitest';

import type { AuthorizedOrder, Participant, Proposal } from '../../src/core/index.js';
import { botoesCard, escapar, formatarBRL, textoPedido, textoProposta } from '../../src/telegram/services/card.js';

const PESSOAS: Participant[] = [
  { id: '1', displayName: 'Ana', preferences: { budgetCents: 3000 } },
  { id: '2', displayName: 'Bia <3', preferences: {} },
  { id: '3', displayName: 'Caio', preferences: {} },
];

const PROPOSTA: Proposal = {
  id: 'g-p1',
  sessionId: 'g',
  justification: 'Uma loja atende todo mundo.',
  orders: [
    {
      storeId: 'loja-1',
      items: [
        { participantId: '2', storeId: 'loja-1', menuItemId: 'bolo', quantity: 1, unitPriceCents: 800, isSubstitute: true },
        { participantId: '1', storeId: 'loja-1', menuItemId: 'lanche', quantity: 2, unitPriceCents: 1250 },
      ],
      subtotalCents: 3300,
      deliveryFeeCents: 600,
      serviceFeeCents: 165,
      totalCents: 4065,
    },
  ],
  split: {
    shares: [
      { participantId: '1', itemsCents: 2500, deliveryCents: 300, serviceCents: 83, totalCents: 2883 },
      { participantId: '2', itemsCents: 800, deliveryCents: 300, serviceCents: 82, totalCents: 1182 },
    ],
    totalCents: 4065,
  },
  uncoveredParticipantIds: ['3'],
};

const NOMES = { lojas: { 'loja-1': 'Lanches & Cia' }, itens: { bolo: 'Bolo de cenoura', lanche: 'X-Burger' } };

describe('formatação', () => {
  it('centavos viram reais com vírgula', () => {
    expect(formatarBRL(2590)).toBe('R$ 25,90');
    expect(formatarBRL(5)).toBe('R$ 0,05');
    expect(formatarBRL(0)).toBe('R$ 0,00');
  });

  it('escapa o HTML do Telegram', () => {
    expect(escapar('<b>A & B</b>')).toBe('&lt;b&gt;A &amp; B&lt;/b&gt;');
  });
});

describe('textoProposta', () => {
  const texto = textoProposta({ proposal: PROPOSTA, participantes: PESSOAS, nomes: NOMES, pendentes: ['1'] });

  it('mostra loja e itens pelo nome, agrupados por pessoa na ordem de entrada', () => {
    expect(texto).toContain('🏪 <b>Lanches &amp; Cia</b>');
    expect(texto.indexOf('Ana: 2× X-Burger')).toBeLessThan(texto.indexOf('Bia &lt;3: Bolo de cenoura'));
  });

  it('quantidade mostra preço unitário, sem multiplicar no bot', () => {
    expect(texto).toContain('2× X-Burger — R$ 12,50 cada');
  });

  it('marca substituto, entrega, taxa e total da loja com os valores do core', () => {
    expect(texto).toContain('Bolo de cenoura — R$ 8,00 <i>(sugestão parecida)</i>');
    expect(texto).toContain('Entrega: R$ 6,00 · Taxa de serviço: R$ 1,65');
    expect(texto).toContain('Total da loja: <b>R$ 40,65</b>');
  });

  it('rateio por pessoa e total do pedido vêm do split', () => {
    expect(texto).toContain('• Ana: <b>R$ 28,83</b> (itens R$ 25,00 + entrega R$ 3,00 + taxa R$ 0,83)');
    expect(texto).toContain('Total do pedido: <b>R$ 40,65</b>');
  });

  it('lista quem ficou sem item e quem falta responder, sem mostrar o orçamento', () => {
    expect(texto).toContain('🙋 Sem item nesta sugestão: Caio');
    expect(texto).toContain('⏳ Aguardando confirmação de valor no privado: Ana');
    expect(texto).not.toContain('30,00');
  });

  it('taxa de serviço não cotada aparece como tal', () => {
    const semTaxa: Proposal = {
      ...PROPOSTA,
      orders: PROPOSTA.orders.map((o) => {
        const copia = { ...o };
        delete copia.serviceFeeCents;
        return copia;
      }),
    };
    expect(textoProposta({ proposal: semTaxa, participantes: PESSOAS })).toContain('Taxa de serviço: não cotada');
  });

  it('sem os nomes do catálogo, usa os ids', () => {
    expect(textoProposta({ proposal: PROPOSTA, participantes: PESSOAS })).toContain('🏪 <b>loja-1</b>');
  });
});

describe('botoesCard', () => {
  const textos = (alt: boolean) => botoesCard(alt).flat().map((b) => b.texto);

  it('"Outra opção" só aparece quando há alternativa', () => {
    expect(textos(true)).toEqual(['✅ Confirmar pedido', '🔄 Outra opção', '↩️ Voltar para a coleta', '❌ Cancelar pedido']);
    expect(textos(false)).toEqual(['✅ Confirmar pedido', '↩️ Voltar para a coleta', '❌ Cancelar pedido']);
  });
});

describe('textoPedido', () => {
  const order: AuthorizedOrder = {
    sessionId: 'g',
    proposalId: 'g-p1-r1',
    authorization: { proposalId: 'g-p1-r1', authorizedBy: '1', authorizedAt: '2026-10-18T12:00:00.000Z' },
    deliveryAddress: { formatted: 'Rua das Flores, 123 <Centro>' },
    orders: PROPOSTA.orders,
    split: PROPOSTA.split,
  };

  it('mostra endereço, lojas, rateio, quem autorizou e a chave do pedido', () => {
    const texto = textoPedido({ order, participantes: PESSOAS, nomes: NOMES });
    expect(texto.startsWith('✅ <b>Pedido confirmado!</b>')).toBe(true);
    expect(texto).toContain('📍 Entrega em: Rua das Flores, 123 &lt;Centro&gt;');
    expect(texto).toContain('🏪 <b>Lanches &amp; Cia</b>');
    expect(texto).toContain('Total do pedido: <b>R$ 40,65</b>');
    expect(texto).toContain('Autorizado por Ana · pedido <code>g-p1-r1</code>');
  });

  it('clique repetido avisa que o pedido já estava confirmado', () => {
    expect(textoPedido({ order, participantes: PESSOAS, repetido: true })).toContain('Este pedido já estava confirmado');
  });
});
