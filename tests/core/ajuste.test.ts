import { describe, expect, it } from 'vitest';
import { ajustar, proximaRevisao } from '../../src/core/ajuste.js';
import { apresentarProposta, cancelar } from '../../src/core/sessao.js';
import { TransicaoInvalidaError } from '../../src/core/sessao.js';
import { LOJAS, ORG, cenarioPadaria, item, proposta } from './fixtures.js';

const soma = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('proximaRevisao', () => {
  it.each([
    ['p1', 'p1-r1'],
    ['p1-r1', 'p1-r2'],
    ['p1-r9', 'p1-r10'],
  ])('%s → %s', (id, next) => {
    expect(proximaRevisao(id)).toBe(next);
  });
});

describe('ajustar', () => {
  it('troca o item na mesma loja e recalcula subtotal, total e rateio', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const result = ajustar(revisao, { participantId: 'caio', storeId: LOJAS.padaria, menuItemId: 'pad-cafe' }, catalog);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));

    const [padaria] = result.proposal.orders;
    expect(padaria?.items.map((i) => [i.participantId, i.menuItemId])).toEqual([
      [ORG, 'pad-misto'],
      ['bia', 'pad-lanche-natural'],
      ['caio', 'pad-cafe'],
    ]);
    expect(padaria?.subtotalCents).toBe(1190 + 1390 + 690);
    expect(padaria?.totalCents).toBe(1190 + 1390 + 690 + 490);
    expect(result.proposal.split.shares.map((s) => s.totalCents)).toEqual([1190 + 164, 1390 + 163, 690 + 163]);
    expect(result.proposal.id).toBe('p1-r1');
    expect(result.session.proposal).toBe(result.proposal);
    expect(result.actions).toEqual([{ type: 'session_updated', session: result.session }]);
  });

  it('preço vem do catálogo e quantidade é respeitada', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const result = ajustar(revisao, { participantId: 'bia', storeId: LOJAS.padaria, menuItemId: 'pad-cafe', quantity: 2 }, catalog);
    if (!result.ok) throw new Error('ajuste falhou');
    const bia = result.proposal.orders[0]?.items.find((i) => i.participantId === 'bia');
    expect(bia).toMatchObject({ unitPriceCents: 690, quantity: 2 });
  });

  it('lanche na padaria + bolo na hamburgueria vira 2 pedidos, com a entrega de cada loja só para quem pediu nela', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const result = ajustar(revisao, { participantId: 'caio', storeId: LOJAS.hamburgueria, menuItemId: 'burger-x-salada' }, catalog);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));

    expect(result.proposal.orders.map((o) => o.storeId)).toEqual([LOJAS.padaria, LOJAS.hamburgueria]);
    const caio = result.proposal.split.shares.find((s) => s.participantId === 'caio');
    expect(caio).toEqual({ participantId: 'caio', itemsCents: 2590, deliveryCents: 799, totalCents: 3389 });
    expect(result.proposal.split.totalCents).toBe(soma(result.proposal.orders.map((o) => o.totalCents)));
  });

  it('trocar o bolo da padaria pelo da doceria esbarra no pedido mínimo e nada muda', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const result = ajustar(revisao, { participantId: 'caio', storeId: LOJAS.doceria, menuItemId: 'doce-bolo-cenoura' }, catalog);
    expect(result).toEqual({ ok: false, problems: [{ code: 'below_minimum', storeId: LOJAS.doceria }] });
  });

  it('terceira loja é recusada', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const duas = ajustar(revisao, { participantId: 'caio', storeId: LOJAS.hamburgueria, menuItemId: 'burger-x-salada' }, catalog);
    if (!duas.ok) throw new Error('ajuste falhou');
    const tres = ajustar(duas.session, { participantId: 'bia', storeId: LOJAS.vegetariano, menuItemId: 'verde-wrap' }, catalog);
    expect(tres.ok).toBe(false);
    expect(!tres.ok && tres.problems[0]?.code).toBe('invalid_proposal');
  });

  it('item que estoura o orçamento da pessoa é recusado sem expor o valor', async () => {
    const { catalog, revisao } = await cenarioPadaria(1500);
    const result = ajustar(revisao, { participantId: 'caio', storeId: LOJAS.padaria, menuItemId: 'pad-lanche-natural' }, catalog);
    expect(result).toEqual({ ok: false, problems: [{ code: 'over_budget', participantId: 'caio' }] });
    expect(JSON.stringify(result)).not.toContain('1500');
  });

  it.each([
    ['item inventado', LOJAS.padaria, 'pad-inventado', 'item_not_in_catalog'],
    ['item de outra loja', LOJAS.padaria, 'burger-x-salada', 'item_from_other_store'],
    ['item indisponível', LOJAS.hamburgueria, 'burger-duplo', 'item_unavailable'],
    ['loja fechada', LOJAS.japones, 'japa-temaki', 'store_closed'],
  ])('recusa %s', async (_nome, storeId, menuItemId, reason) => {
    const { catalog, revisao } = await cenarioPadaria();
    const result = ajustar(revisao, { participantId: 'caio', storeId, menuItemId }, catalog);
    expect(result).toEqual({ ok: false, problems: [{ code: 'item_rejected', participantId: 'caio', menuItemId, reason }] });
  });

  it('recusa participante fora da sessão', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const result = ajustar(revisao, { participantId: 'intruso', storeId: LOJAS.padaria, menuItemId: 'pad-cafe' }, catalog);
    expect(!result.ok && result.problems[0]).toMatchObject({ reason: 'unknown_participant' });
  });

  it('participante sem item passa a ser coberto', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const semCaio = {
      ...revisao,
      participants: [...revisao.participants, { id: 'davi', displayName: 'Davi', preferences: {} }],
      proposal: { ...revisao.proposal!, uncoveredParticipantIds: ['davi'] },
    };
    const result = ajustar(semCaio, { participantId: 'davi', storeId: LOJAS.padaria, menuItemId: 'pad-cafe' }, catalog);
    if (!result.ok) throw new Error('ajuste falhou');
    expect(result.proposal.uncoveredParticipantIds).toEqual([]);
    expect(result.proposal.orders[0]?.items.at(-1)).toMatchObject({ participantId: 'davi', menuItemId: 'pad-cafe' });
  });

  it('na confirmação, o ajuste volta a sessão para revisão (precisa confirmar de novo)', async () => {
    const { catalog, confirmacao } = await cenarioPadaria();
    const result = ajustar(confirmacao, { participantId: 'caio', storeId: LOJAS.padaria, menuItemId: 'pad-cafe' }, catalog);
    expect(result.ok && result.session.status).toBe('reviewing');
  });

  it('não altera a sessão original', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const antes = structuredClone(revisao);
    ajustar(revisao, { participantId: 'caio', storeId: LOJAS.padaria, menuItemId: 'pad-cafe' }, catalog);
    expect(revisao).toEqual(antes);
  });

  it('rejeita quantidade fora de 1 a 10', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    for (const quantity of [0, 11, 1.5]) {
      expect(() =>
        ajustar(revisao, { participantId: 'caio', storeId: LOJAS.padaria, menuItemId: 'pad-cafe', quantity }, catalog),
      ).toThrow(RangeError);
    }
  });

  it('só ajusta com proposta em revisão ou confirmação', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const cancelada = cancelar(revisao, ORG);
    expect(() => ajustar(cancelada, { participantId: 'caio', storeId: LOJAS.padaria, menuItemId: 'pad-cafe' }, catalog)).toThrow(
      TransicaoInvalidaError,
    );
  });
});

describe('ajustar: pessoa com vários itens', () => {
  async function comDoisItens() {
    const { catalog, revisao } = await cenarioPadaria();
    const p = proposta(catalog, [item(catalog, 'bia', 'pad-misto'), item(catalog, 'bia', 'pad-bolo-cenoura'), item(catalog, 'caio', 'pad-cafe')], 'p2');
    return { catalog, session: apresentarProposta(revisao, p) };
  }
  const itens = (r: { ok: boolean; proposal?: { orders: { items: { participantId: string; menuItemId: string }[] }[] } }) =>
    r.proposal?.orders.flatMap((o) => o.items).map((i) => `${i.participantId}:${i.menuItemId}`);

  it('troca só o item indicado, no mesmo lugar', async () => {
    const { catalog, session } = await comDoisItens();
    const r = ajustar(session, { participantId: 'bia', storeId: LOJAS.padaria, menuItemId: 'pad-cafe', replaceMenuItemId: 'pad-bolo-cenoura' }, catalog);
    expect(itens(r as never)).toEqual(['bia:pad-misto', 'bia:pad-cafe', 'caio:pad-cafe']);
  });

  it('com vários itens e sem indicar qual sai: which_item com os itens da pessoa', async () => {
    const { catalog, session } = await comDoisItens();
    const r = ajustar(session, { participantId: 'bia', storeId: LOJAS.padaria, menuItemId: 'pad-cafe' }, catalog);
    expect(r).toEqual({ ok: false, problems: [{ code: 'which_item', participantId: 'bia', menuItemIds: ['pad-misto', 'pad-bolo-cenoura'] }] });
  });

  it('item indicado que não é da pessoa: which_item', async () => {
    const { catalog, session } = await comDoisItens();
    const r = ajustar(session, { participantId: 'bia', storeId: LOJAS.padaria, menuItemId: 'pad-cafe', replaceMenuItemId: 'pad-cafe' }, catalog);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems[0]?.code).toBe('which_item');
  });

  it('com um item só, não precisa indicar', async () => {
    const { catalog, session } = await comDoisItens();
    const r = ajustar(session, { participantId: 'caio', storeId: LOJAS.padaria, menuItemId: 'pad-misto' }, catalog);
    expect(itens(r as never)).toEqual(['bia:pad-misto', 'bia:pad-bolo-cenoura', 'caio:pad-misto']);
  });
});
