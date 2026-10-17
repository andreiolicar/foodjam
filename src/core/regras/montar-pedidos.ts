import type { ProposedItem, Store, StoreId, StoreOrder } from '../contracts.js';
import { assertMoneyCents, somarCents } from './dinheiro.js';

/**
 * Agrupa itens por loja (na ordem da primeira aparição) e calcula subtotal e
 * total em código. A taxa de entrega vem da loja no catálogo.
 */
export function montarPedidos(items: readonly ProposedItem[], stores: readonly Store[]): StoreOrder[] {
  const byStore = new Map<StoreId, ProposedItem[]>();
  for (const item of items) {
    const list = byStore.get(item.storeId) ?? [];
    list.push(item);
    byStore.set(item.storeId, list);
  }

  return [...byStore].map(([storeId, storeItems]) => {
    const store = stores.find((s) => s.id === storeId);
    if (!store) throw new Error(`loja ${storeId} não está no catálogo informado`);
    assertMoneyCents(store.deliveryFeeCents, `deliveryFeeCents da loja ${storeId}`);

    const subtotalCents = somarCents(storeItems.map((i) => i.unitPriceCents * i.quantity));
    const totalCents = somarCents([subtotalCents, store.deliveryFeeCents]);
    return { storeId, items: storeItems, subtotalCents, deliveryFeeCents: store.deliveryFeeCents, totalCents };
  });
}
