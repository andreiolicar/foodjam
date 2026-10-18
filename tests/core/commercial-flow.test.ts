import { expect, it } from 'vitest';
import * as flow from '../../src/core/commercial-flow.js';
import type { PreliminaryProposal, CartObservation } from '../../src/core/contracts.js';
const proposal: PreliminaryProposal = { id: 'proposal', sessionId: 'session', organizerId: 'a', address: { id: 'address', formatted: 'Endereço fictício' }, status: 'preliminary', pending: ['commercial_validation'],
  participants: [{ id: 'a', displayName: 'A', preferences: { budgetCents: 100 } }, { id: 'b', displayName: 'B', preferences: {} }],
  items: [{ participantId: 'a', storeId: 'one', menuItemId: 'item-a', quantity: 1 }, { participantId: 'b', storeId: 'one', menuItemId: 'item-a', quantity: 1 }, { participantId: 'b', storeId: 'two', menuItemId: 'item-b', quantity: 1 }] };
const carts: CartObservation[] = [
  { cartId: 'cart-one', storeId: 'one', items: [{ menuItemId: 'item-a', quantity: 2, unitPriceCents: 1000 }], amounts: { subtotalCents: 2000, deliveryCents: 101, feesCents: 1, benefitsCents: 100, voucherCents: 0, totalCents: 2002 }, issues: [] },
  { cartId: 'cart-two', storeId: 'two', items: [{ menuItemId: 'item-b', quantity: 1, unitPriceCents: 500 }], amounts: { subtotalCents: 500, deliveryCents: 50, feesCents: 10, benefitsCents: 0, voucherCents: 0, totalCents: 560 }, issues: [] },
];
it('emite permissões opacas só para o organizador, vinculadas à composição e usuário', () => {
  const authority = flow.createPreparationAuthority();
  expect(() => authority.authorize(proposal, 'b', 'user')).toThrow();
  const [entry] = authority.authorize(proposal, 'a', 'user');
  expect(() => authority.verify(entry!.permit, entry!.context)).not.toThrow();
  expect(() => authority.verify({ purpose: 'prepare_cart' }, entry!.context)).toThrow();
  expect(() => authority.verify(entry!.permit, { ...entry!.context, authenticatedUserId: 'foreign' })).toThrow();
});
it('benefícios sem política explícita bloqueiam, sem apresentar total/rateio fictício', () => {
  expect(flow.reviewCommercial(proposal, carts).status).toBe('blocked');
  expect(flow.reviewCommercial(proposal, carts)).not.toHaveProperty('split');
});
it('rateia centavos exatos por loja, com desconto proporcional explícito e orçamento final', () => {
  const review = flow.reviewCommercial(proposal, carts, 'proportional_items');
  expect(review.status).toBe('review_required');
  expect(review.split?.totalCents).toBe(2562);
  expect(review.split?.shares.find(s => s.participantId === 'a')).toMatchObject({ itemsCents: 1000, deliveryCents: 51, feesCents: 1, discountCents: 50, totalCents: 1002 });
  expect(review.split?.shares.reduce((s, x) => s + x.totalCents, 0)).toBe(2562);
  expect(review.overBudget).toEqual([{ participantId: 'a', totalCents: 1002 }]);
  expect(flow.canConfirmCommercial(review, 'a', 'a', [])).toBe(false);
  expect(flow.canConfirmCommercial(review, 'a', 'a', [{ participantId: 'a', revision: review.revision }])).toBe(true);
});
it('falha em uma loja bloqueia o conjunto e mudanças invalidam aceites anteriores', () => {
  expect(flow.reviewCommercial(proposal, carts.slice(0, 1), 'proportional_items').status).toBe('blocked');
  const old = flow.reviewCommercial(proposal, carts, 'proportional_items');
  const changed = structuredClone(carts); changed[1]!.amounts!.feesCents++; changed[1]!.amounts!.totalCents++;
  const current = flow.reviewCommercial(proposal, changed, 'proportional_items');
  expect(current.revision).not.toBe(old.revision);
  expect(flow.canConfirmCommercial(current, 'a', 'a', [{ participantId: 'a', revision: old.revision }])).toBe(false);
});
it('recusa total sem decomposição, item ausente, quantidade divergente e cartId duplicado', () => {
  const broken = structuredClone(carts); broken[0]!.amounts!.totalCents++;
  expect(flow.reviewCommercial(proposal, broken, 'proportional_items').status).toBe('blocked');
  expect(flow.reviewCommercial(proposal, [carts[0]!, { ...carts[1]!, cartId: carts[0]!.cartId }], 'proportional_items').status).toBe('blocked');
});
it('schema compartilhado aceita desconto explícito somente com total correspondente', async () => {
  const { CommercialShareSchema } = await import('../../src/core/schemas.js');
  expect(CommercialShareSchema.safeParse({ participantId: 'a', itemsCents: 100, deliveryCents: 10, feesCents: 5, discountCents: 20, totalCents: 95 }).success).toBe(true);
});
it('coordenador preserva sucesso parcial mas bloqueia a revisão se a segunda loja falhar', async () => {
  const authority = flow.createPreparationAuthority();
  const review = await flow.prepareCommercialProposal(proposal, 'a', 'user', authority, {
    prepare: async context => { if (context.storeId === 'two') throw new Error('failure'); return carts[0]!; },
  }, 'proportional_items');
  expect(review.status).toBe('blocked');
  expect(review.observations).toHaveLength(1);
  expect(review.failures).toContain('two');
});

it('ajuste não atribuído preserva total remoto sem subtrair benefícios novamente e exige aceite de cada comprador', () => {
  const observed = structuredClone(carts);
  observed[0]!.amounts!.totalCents = 1801;
  observed[0]!.issues = ['total_decomposition_mismatch'];
  const review = flow.reviewCommercial(proposal, observed, 'proportional_unattributed_adjustment');
  expect(review.status).toBe('review_required');
  expect(review.split?.totalCents).toBe(2361);
  expect(review.split?.shares.find(s => s.participantId === 'a')).toMatchObject({
    itemsCents: 1000, deliveryCents: 51, feesCents: 1, discountCents: 0,
    unattributedAdjustment: { creditCents: 151, debitCents: 0 }, totalCents: 901,
  });
  expect(review.split?.shares.reduce((sum, s) => sum + s.totalCents, 0)).toBe(2361);
  expect(review.adjustmentPolicy?.requiredParticipantIds).toEqual(['a', 'b']);
  const a = { participantId: 'a', revision: review.revision };
  const b = { participantId: 'b', revision: review.revision };
  expect(flow.canConfirmCommercial(review, 'a', 'a', [a])).toBe(false);
  expect(flow.canConfirmCommercial(review, 'a', 'a', [a, b])).toBe(true);
  expect(review.observations[0]!.amounts!.benefitsCents).toBe(100);
  observed[0]!.amounts!.totalCents++;
  expect(flow.canConfirmCommercial(flow.reviewCommercial(proposal, observed, 'proportional_unattributed_adjustment'), 'a', 'a', [a, b])).toBe(false);
});

it('ajuste positivo é encargo não atribuído, mantém centavos exatos e não afrouxa outros bloqueios', () => {
  const observed = structuredClone(carts);
  observed[0]!.amounts!.totalCents = 2103;
  observed[0]!.issues = ['total_decomposition_mismatch'];
  const review = flow.reviewCommercial(proposal, observed, 'proportional_unattributed_adjustment');
  expect(review.split?.shares.find(s => s.participantId === 'a')).toMatchObject({
    unattributedAdjustment: { creditCents: 0, debitCents: 1 }, totalCents: 1053,
  });
  expect(review.split?.totalCents).toBe(2663);
  observed[0]!.issues.push('address_binding_unconfirmed');
  expect(flow.reviewCommercial(proposal, observed, 'proportional_unattributed_adjustment').status).toBe('blocked');
});

it('schema comercial valida crédito/débito não atribuído e sua soma sem permitir total fictício', async () => {
  const { CommercialShareSchema } = await import('../../src/core/schemas.js');
  const share = { participantId: 'a', itemsCents: 100, deliveryCents: 10, feesCents: 5, discountCents: 0,
    unattributedAdjustment: { creditCents: 20, debitCents: 0 }, totalCents: 95 };
  expect(CommercialShareSchema.safeParse(share).success).toBe(true);
  expect(CommercialShareSchema.safeParse({ ...share, totalCents: 115 }).success).toBe(false);
});

it.each(['subtotal_mismatch', 'delivery_mismatch', 'fees_mismatch', 'unit_unconfirmed', 'address_binding_mismatch'])(
  'política de ajuste nunca ignora %s', issue => {
    const observed = structuredClone(carts); observed[0]!.issues = [issue];
    expect(flow.reviewCommercial(proposal, observed, 'proportional_unattributed_adjustment').status).toBe('blocked');
  });

it('não compensa parcela negativa de uma loja com a parcela positiva de outra', () => {
  const observed = structuredClone(carts);
  // Loja um: crédito integral + custo ímpar. Rateio por itens não pode fazer
  // a pessoa b dever -1 na loja um e ocultar isso somando sua outra loja.
  observed[0]!.amounts = { subtotalCents: 2000, deliveryCents: 1, feesCents: 1, benefitsCents: 0, voucherCents: 0, totalCents: 0 };
  observed[0]!.issues = ['total_decomposition_mismatch'];
  expect(flow.reviewCommercial(proposal, observed, 'proportional_unattributed_adjustment').status).toBe('blocked');
});
