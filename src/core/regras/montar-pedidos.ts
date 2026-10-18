import type { MoneyCents, ProposedItem, Store, StoreId, StoreOrder } from '../contracts.js';
import { assertMoneyCents, somarCents } from './dinheiro.js';

/**
 * Agrupa itens por loja (na ordem da primeira aparição) e calcula subtotal e
 * total em código. A taxa de entrega vem da loja no catálogo; a de serviço,
 * da cotação no iFood (por loja), quando houver. Sem cotação, o pedido fica
 * sem serviceFeeCents e o total não a inclui.
 */
export function montarPedidos(
  items: readonly ProposedItem[],
  stores: readonly Store[],
  taxasServico: ReadonlyMap<StoreId, MoneyCents> = new Map(),
): StoreOrder[] {
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
    const serviceFeeCents = taxasServico.get(storeId);
    if (serviceFeeCents !== undefined) assertMoneyCents(serviceFeeCents, `serviceFeeCents da loja ${storeId}`);

    const subtotalCents = somarCents(storeItems.map((i) => i.unitPriceCents * i.quantity));
    const totalCents = somarCents([subtotalCents, store.deliveryFeeCents, serviceFeeCents ?? 0]);
    return {
      storeId,
      items: storeItems,
      subtotalCents,
      deliveryFeeCents: store.deliveryFeeCents,
      ...(serviceFeeCents !== undefined && { serviceFeeCents }),
      totalCents,
    };
  });
}
