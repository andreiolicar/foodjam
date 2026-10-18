import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { MenuItem, ParticipantShare, Proposal, ProposedItem, Split, Store, StoreOrder } from '../../src/core/contracts.js';
import { calcularRateio } from '../../src/core/regras/rateio.js';
import {
  MAX_JUSTIFICATION_LENGTH,
  MenuItemSchema,
  ParticipantShareSchema,
  ProposalSchema,
  ProposedItemSchema,
  SplitSchema,
  StoreOrderSchema,
  StoreSchema,
} from '../../src/core/schemas.js';

const item = (participantId: string, unitPriceCents: number, extra: Partial<ProposedItem> = {}): ProposedItem => ({
  participantId,
  storeId: 'burger',
  menuItemId: `item-${participantId}`,
  quantity: 1,
  unitPriceCents,
  ...extra,
});

function proposal(): Proposal {
  const items = [item('ana', 2590), item('bia', 3000, { isSubstitute: true })];
  const order: StoreOrder = { storeId: 'burger', items, subtotalCents: 5590, deliveryFeeCents: 700, totalCents: 6290 };
  return {
    id: 'p1',
    sessionId: 's1',
    orders: [order],
    split: calcularRateio([order]),
    uncoveredParticipantIds: ['caio'],
    justification: 'Uma loja só cobre as duas pessoas e fica dentro do limite.',
  };
}

describe('tipos dos schemas de domínio são iguais aos do contrato', () => {
  it('compila', () => {
    expectTypeOf<z.infer<typeof StoreSchema>>().toEqualTypeOf<Store>();
    expectTypeOf<z.infer<typeof MenuItemSchema>>().toEqualTypeOf<MenuItem>();
    expectTypeOf<z.infer<typeof ProposedItemSchema>>().toEqualTypeOf<ProposedItem>();
    expectTypeOf<z.infer<typeof StoreOrderSchema>>().toEqualTypeOf<StoreOrder>();
    expectTypeOf<z.infer<typeof ParticipantShareSchema>>().toEqualTypeOf<ParticipantShare>();
    expectTypeOf<z.infer<typeof SplitSchema>>().toEqualTypeOf<Split>();
    expectTypeOf<z.infer<typeof ProposalSchema>>().toEqualTypeOf<Proposal>();
  });
});

describe('schemas de catálogo', () => {
  it('aceita loja e item válidos, com e sem opcionais', () => {
    expect(StoreSchema.safeParse({ id: 'l1', name: 'Burger', isOpen: true, deliveryFeeCents: 700 }).success).toBe(true);
    expect(
      StoreSchema.safeParse({ id: 'l1', name: 'Burger', isOpen: true, deliveryFeeCents: 0, minimumOrderCents: 3000 }).success,
    ).toBe(true);
    expect(
      MenuItemSchema.safeParse({ id: 'i1', storeId: 'l1', name: 'X-Salada', priceCents: 2590, available: true }).success,
    ).toBe(true);
  });

  it.each([-1, 7.5, '700', Number.MAX_SAFE_INTEGER + 1, Number.NaN])('rejeita dinheiro inválido: %s', (value) => {
    expect(StoreSchema.safeParse({ id: 'l1', name: 'Burger', isOpen: true, deliveryFeeCents: value }).success).toBe(false);
  });

  it('rejeita opcional explicitamente undefined', () => {
    expect(
      StoreSchema.safeParse({ id: 'l1', name: 'B', isOpen: true, deliveryFeeCents: 0, minimumOrderCents: undefined }).success,
    ).toBe(false);
  });
});

describe('ProposedItemSchema', () => {
  it.each([1, 10])('aceita quantity %s', (quantity) => {
    expect(ProposedItemSchema.safeParse(item('ana', 1000, { quantity })).success).toBe(true);
  });

  it.each([0, 11, 1.5, -1])('rejeita quantity %s', (quantity) => {
    expect(ProposedItemSchema.safeParse(item('ana', 1000, { quantity })).success).toBe(false);
  });
});

describe('StoreOrderSchema', () => {
  const order = (): StoreOrder => ({
    storeId: 'burger',
    items: [item('ana', 1000, { quantity: 2 }), item('bia', 500)],
    subtotalCents: 2500,
    deliveryFeeCents: 600,
    totalCents: 3100,
  });

  it('aceita pedido consistente', () => {
    expect(StoreOrderSchema.safeParse(order()).success).toBe(true);
  });

  it('rejeita subtotal, total ou loja inconsistentes', () => {
    expect(StoreOrderSchema.safeParse({ ...order(), subtotalCents: 2400, totalCents: 3000 }).success).toBe(false);
    expect(StoreOrderSchema.safeParse({ ...order(), totalCents: 3101 }).success).toBe(false);
    expect(StoreOrderSchema.safeParse({ ...order(), items: [item('ana', 2500, { storeId: 'outra' })] }).success).toBe(false);
    expect(StoreOrderSchema.safeParse({ ...order(), items: [] }).success).toBe(false);
  });
});

describe('SplitSchema', () => {
  it('rejeita partes que não somam o total ou participante repetido', () => {
    const share = { participantId: 'ana', itemsCents: 1000, deliveryCents: 100, totalCents: 1100 };
    expect(SplitSchema.safeParse({ shares: [share], totalCents: 1100 }).success).toBe(true);
    expect(SplitSchema.safeParse({ shares: [share], totalCents: 1101 }).success).toBe(false);
    expect(SplitSchema.safeParse({ shares: [share, share], totalCents: 2200 }).success).toBe(false);
    expect(SplitSchema.safeParse({ shares: [{ ...share, totalCents: 1000 }], totalCents: 1000 }).success).toBe(false);
  });

  it('parte individual precisa ter total = itens + entrega', () => {
    const share = { participantId: 'ana', itemsCents: 1000, deliveryCents: 100, totalCents: 1100 };
    expect(ParticipantShareSchema.safeParse(share).success).toBe(true);
    expect(ParticipantShareSchema.safeParse({ ...share, totalCents: 1099 }).success).toBe(false);
  });
});

describe('ProposalSchema', () => {
  it('aceita proposta montada pelo core', () => {
    expect(ProposalSchema.safeParse(proposal()).success).toBe(true);
  });

  it('limita o tamanho da justificativa', () => {
    expect(ProposalSchema.safeParse({ ...proposal(), justification: 'a'.repeat(MAX_JUSTIFICATION_LENGTH) }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...proposal(), justification: 'a'.repeat(MAX_JUSTIFICATION_LENGTH + 1) }).success).toBe(
      false,
    );
    expect(ProposalSchema.safeParse({ ...proposal(), justification: '   ' }).success).toBe(false);
  });

  it('rejeita mais de 2 lojas, loja repetida e rateio que não bate com os pedidos', () => {
    const base = proposal();
    const [order] = base.orders;
    if (!order) throw new Error('fixture sem pedido');
    const other = (storeId: string): StoreOrder => ({
      ...order,
      storeId,
      items: order.items.map((i) => ({ ...i, storeId })),
    });

    expect(ProposalSchema.safeParse({ ...base, orders: [order, other('b'), other('c')] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...base, orders: [order, other('burger')] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...base, split: { ...base.split, totalCents: base.split.totalCents + 1 } }).success).toBe(
      false,
    );
  });
});

