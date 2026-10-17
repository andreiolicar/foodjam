import { describe, expect, it } from 'vitest';
import type { MenuItem, Participant, Store } from '../../../src/core/contracts.js';
import type { CatalogSnapshot } from '../../../src/core/regras/validar-escolhas.js';
import { validarEscolhas } from '../../../src/core/regras/validar-escolhas.js';
import type { ModelPick } from '../../../src/core/schemas.js';

const participant = (id: string): Participant => ({ id, displayName: id, preferences: {} });
const session = { participants: [participant('ana'), participant('bia')] };

const stores: Store[] = [
  { id: 'burger', name: 'Burger', isOpen: true, deliveryFeeCents: 700 },
  { id: 'fechada', name: 'Fechada', isOpen: false, deliveryFeeCents: 500 },
];
const menuItems: MenuItem[] = [
  { id: 'x-salada', storeId: 'burger', name: 'X-Salada', priceCents: 2590, available: true },
  { id: 'veggie', storeId: 'burger', name: 'Veggie', priceCents: 2890, available: true },
  { id: 'esgotado', storeId: 'burger', name: 'Esgotado', priceCents: 1000, available: false },
  { id: 'pastel', storeId: 'fechada', name: 'Pastel', priceCents: 800, available: true },
];
const catalog: CatalogSnapshot = { stores, menuItems };

const pick = (extra: Partial<ModelPick> = {}): ModelPick => ({
  participantId: 'ana',
  storeId: 'burger',
  menuItemId: 'x-salada',
  quantity: 1,
  ...extra,
});

describe('validarEscolhas', () => {
  it('aceita escolha válida e copia o preço do catálogo', () => {
    const result = validarEscolhas([pick({ quantity: 2 })], session, catalog);
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([
      { participantId: 'ana', storeId: 'burger', menuItemId: 'x-salada', quantity: 2, unitPriceCents: 2590 },
    ]);
  });

  it('preserva isSubstitute quando informado', () => {
    const result = validarEscolhas([pick({ participantId: 'bia', menuItemId: 'veggie', isSubstitute: true })], session, catalog);
    expect(result.accepted[0]).toMatchObject({ unitPriceCents: 2890, isSubstitute: true });
  });

  it.each([
    ['participante fora da sessão', pick({ participantId: 'intruso' }), 'unknown_participant'],
    ['loja não consultada', pick({ storeId: 'inventada' }), 'store_not_in_catalog'],
    ['item não consultado', pick({ menuItemId: 'inventado' }), 'item_not_in_catalog'],
    ['item de outra loja', pick({ menuItemId: 'pastel' }), 'item_from_other_store'],
    ['loja fechada', pick({ storeId: 'fechada', menuItemId: 'pastel' }), 'store_closed'],
    ['item indisponível', pick({ menuItemId: 'esgotado' }), 'item_unavailable'],
  ] as const)('descarta %s', (_name, invalid, reason) => {
    const result = validarEscolhas([invalid], session, catalog);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ pick: invalid, reason }]);
  });

  it('separa válidas e inválidas na mesma lista, mantendo a ordem', () => {
    const picks = [pick(), pick({ menuItemId: 'inventado' }), pick({ participantId: 'bia', menuItemId: 'veggie' })];
    const result = validarEscolhas(picks, session, catalog);
    expect(result.accepted.map((i) => i.menuItemId)).toEqual(['x-salada', 'veggie']);
    expect(result.rejected.map((r) => r.reason)).toEqual(['item_not_in_catalog']);
  });

  it('com catálogo vazio descarta tudo', () => {
    const result = validarEscolhas([pick()], session, { stores: [], menuItems: [] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('falha se o catálogo trouxer preço inválido', () => {
    const broken = { stores, menuItems: [{ ...menuItems[0], priceCents: 25.9 } as MenuItem] };
    expect(() => validarEscolhas([pick()], session, broken)).toThrow(RangeError);
  });
});
