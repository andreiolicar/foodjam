import { describe, expect, it } from 'vitest';
import { fechar } from '../../src/core/fechamento.js';
import { avaliarOrcamentos, responderOrcamento } from '../../src/core/orcamento.js';
import { NaoAutorizadoError, TransicaoInvalidaError } from '../../src/core/sessao.js';
import { AGORA, ENDERECO, LOJAS, ORG, alterarCatalogo, cenarioPadaria } from './fixtures.js';

describe('fechar', () => {
  it('organizador fecha e recebe pedidos por loja, rateio e a autorização', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const result = fechar(confirmacao, ORG, AGORA, catalog);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));

    expect(result.alreadyClosed).toBe(false);
    expect(result.session.status).toBe('closed');
    expect(result.order).toEqual({
      sessionId: 's1',
      proposalId: 'p1',
      authorization: { proposalId: 'p1', authorizedBy: ORG, authorizedAt: AGORA },
      deliveryAddress: ENDERECO,
      orders: confirmacao.proposal?.orders,
      split: confirmacao.proposal?.split,
    });
    expect(result.order.split.shares.reduce((s, p) => s + p.totalCents, 0)).toBe(result.order.split.totalCents);
    expect(result.actions).toEqual([{ type: 'session_updated', session: result.session }]);
  });

  it('idempotente: fechar de novo devolve o mesmo pedido, sem novo fechamento nem revalidação', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const primeira = fechar(confirmacao, ORG, AGORA, catalog);
    if (!primeira.ok) throw new Error('fechamento falhou');

    // Mesmo com o catálogo mudado depois, o pedido já autorizado não muda.
    const mudou = alterarCatalogo(catalog, { item: ['pad-misto', { priceCents: 9999 }] });
    const segunda = fechar(primeira.session, ORG, '2026-10-18T12:05:00.000Z', mudou);

    expect(segunda.ok && segunda.alreadyClosed).toBe(true);
    expect(segunda.ok && segunda.order).toEqual(primeira.order);
    expect(segunda.ok && segunda.session).toBe(primeira.session);
    expect(segunda.ok && segunda.actions).toEqual([]);
  });

  it('o pedido devolvido é uma cópia: o backend não altera a sessão', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const result = fechar(confirmacao, ORG, AGORA, catalog);
    if (!result.ok) throw new Error('fechamento falhou');
    result.order.split.totalCents = 0;
    expect(result.session.proposal?.split.totalCents).not.toBe(0);
  });

  it('só o organizador fecha, mesmo com a sessão já fechada', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    expect(() => fechar(confirmacao, 'bia', AGORA, catalog)).toThrow(NaoAutorizadoError);

    const fechada = fechar(confirmacao, ORG, AGORA, catalog);
    if (!fechada.ok) throw new Error('fechamento falhou');
    expect(() => fechar(fechada.session, 'bia', AGORA, catalog)).toThrow(NaoAutorizadoError);
  });

  it('não fecha sem antes pedir confirmação', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    expect(() => fechar(revisao, ORG, AGORA, catalog)).toThrow(TransicaoInvalidaError);
  });

  it.each([
    [
      'preço mudou no catálogo',
      { item: ['pad-misto', { priceCents: 1290 }] },
      { code: 'price_changed', menuItemId: 'pad-misto', proposedCents: 1190, currentCents: 1290 },
    ],
    [
      'item ficou indisponível',
      { item: ['pad-bolo-cenoura', { available: false }] },
      { code: 'item_rejected', participantId: 'caio', menuItemId: 'pad-bolo-cenoura', reason: 'item_unavailable' },
    ],
    [
      'loja fechou',
      { store: [LOJAS.padaria, { isOpen: false }] },
      { code: 'item_rejected', participantId: ORG, menuItemId: 'pad-misto', reason: 'store_closed' },
    ],
    [
      'taxa de entrega mudou',
      { store: [LOJAS.padaria, { deliveryFeeCents: 990 }] },
      { code: 'delivery_fee_changed', storeId: LOJAS.padaria, proposedCents: 490, currentCents: 990 },
    ],
    [
      'pedido mínimo subiu',
      { store: [LOJAS.padaria, { minimumOrderCents: 5000 }] },
      { code: 'below_minimum', storeId: LOJAS.padaria },
    ],
  ] as const)('não fecha se %s', async (_nome, changes, problema) => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const result = fechar(confirmacao, ORG, AGORA, alterarCatalogo(catalog, changes as never));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toContainEqual(problema);
    expect(confirmacao.status).toBe('awaiting_confirmation');
  });

  it('não fecha com rateio adulterado, mesmo que a soma bata', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const proposal = confirmacao.proposal!;
    const [a, b, c] = proposal.split.shares;
    const adulterado = {
      ...confirmacao,
      proposal: {
        ...proposal,
        split: {
          ...proposal.split,
          shares: [
            { ...a!, itemsCents: a!.itemsCents - 100, totalCents: a!.totalCents - 100 },
            { ...b!, itemsCents: b!.itemsCents + 100, totalCents: b!.totalCents + 100 },
            c!,
          ],
        },
      },
    };
    expect(fechar(adulterado, ORG, AGORA, catalog)).toEqual({ ok: false, problems: [{ code: 'split_mismatch' }] });
  });

  it('não fecha enquanto alguém acima do orçamento não respondeu', async () => {
    // Bolo do Caio (R$ 8,90) passa de R$ 8.
    const { catalog, confirmacao } = await cenarioPadaria(800);
    expect(fechar(confirmacao, ORG, AGORA, catalog)).toEqual({
      ok: false,
      problems: [{ code: 'budget_pending', participantIds: ['caio'] }],
    });
  });

  it('o orçamento inclui a entrega: itens dentro mas total acima também precisa de resposta', async () => {
    // Bolo R$ 8,90 ≤ R$ 10; com R$ 1,63 de entrega, R$ 10,53.
    const { catalog, confirmacao } = await cenarioPadaria(1000);
    expect(fechar(confirmacao, ORG, AGORA, catalog)).toEqual({
      ok: false,
      problems: [{ code: 'budget_pending', participantIds: ['caio'] }],
    });
  });

  it('fecha depois que quem passou do orçamento aceitou o valor', async () => {
    const { catalog, confirmacao } = await cenarioPadaria(1000);
    const perguntada = avaliarOrcamentos(confirmacao).session;
    const respondida = responderOrcamento(perguntada, 'caio', 'aceito', { catalog, classificacao: [] }).session;
    expect(fechar(respondida, ORG, AGORA, catalog).ok).toBe(true);
  });

  it('fecha quando todos cabem no orçamento com entrega', async () => {
    const { catalog, confirmacao } = await cenarioPadaria(1100);
    expect(fechar(confirmacao, ORG, AGORA, catalog).ok).toBe(true);
  });

  it.each([
    ['mais antigo que 60 s', '2026-10-18T11:58:59.999Z'],
    ['com data inválida', 'ontem'],
    ['no futuro', '2026-10-18T12:00:01.000Z'],
  ])('não fecha com retrato do catálogo %s', async (_nome, fetchedAt) => {
    const { catalog, confirmacao } = await cenarioPadaria();
    expect(fechar(confirmacao, ORG, AGORA, { ...catalog, fetchedAt })).toEqual({
      ok: false,
      problems: [{ code: 'stale_catalog', fetchedAt, maxAgeMs: 60_000 }],
    });
  });

  it('aceita retrato com exatamente 60 s e o limite é configurável', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const sessentaSegundos = { ...catalog, fetchedAt: '2026-10-18T11:59:00.000Z' };
    expect(fechar(confirmacao, ORG, AGORA, sessentaSegundos).ok).toBe(true);
    expect(fechar(confirmacao, ORG, AGORA, sessentaSegundos, { maxCatalogAgeMs: 10_000 })).toEqual({
      ok: false,
      problems: [{ code: 'stale_catalog', fetchedAt: '2026-10-18T11:59:00.000Z', maxAgeMs: 10_000 }],
    });
  });

  it('não fecha proposta com item fora do catálogo (inventado)', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const semMisto = { ...catalog, menuItems: catalog.menuItems.filter((i) => i.id !== 'pad-misto') };
    const result = fechar(confirmacao, ORG, AGORA, semMisto);
    expect(!result.ok && result.problems).toContainEqual({
      code: 'item_rejected',
      participantId: ORG,
      menuItemId: 'pad-misto',
      reason: 'item_not_in_catalog',
    });
  });
});
