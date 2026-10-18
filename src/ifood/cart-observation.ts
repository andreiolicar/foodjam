import { z } from 'zod';
import type { CartObservation, PreparationContext } from '../core/contracts.js';
import type { IfoodMcpClient } from './client.js';
import type { IfoodMcpCartResult } from './cart-tools.js';
import { catalogDocument, catalogMoneyCents, IfoodCatalogError } from './catalog-data.js';
const money = z.union([z.number().finite(), z.string()]);
const schema = z.object({
  cartId: z.string().min(1), merchant: z.object({ merchantId: z.string().min(1) }),
  items: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().int().positive().safe(), unitPrice: money })),
  deliveryAddress: z.object({ addressId: z.string().optional() }).optional(),
  deliveryMethod: z.object({ fee: money }).optional(),
  fees: z.array(z.object({ amount: money })).optional(),
  summary: z.object({ subtotalAmount: money, deliveryFeeAmount: money, feeTotalAmount: money,
    benefitsTotalAmount: money, voucherTotalAmount: money, totalAmount: money }).optional(),
});
/** Não recalcula/desconta números para fazê-los coincidir com o total remoto. */
export function readCartObservation(result: IfoodMcpCartResult, context: PreparationContext, cartId: string, unit?: 'BRL' | 'cents'): CartObservation {
  const parsed = schema.safeParse(catalogDocument(result));
  if (!parsed.success) throw new IfoodCatalogError('invalid_data');
  const cart = parsed.data;
  if (cart.cartId !== cartId || cart.merchant.merchantId !== context.storeId) throw new IfoodCatalogError('merchant_scope_mismatch');
  if (new Set(context.items.map(i => i.menuItemId)).size !== context.items.length
    || context.items.some(i => !Number.isSafeInteger(i.quantity) || i.quantity < 1)
    || cart.items.length !== context.items.length || new Set(cart.items.map(i => i.itemId)).size !== cart.items.length
    || context.items.some(i => !cart.items.some(x => x.itemId === i.menuItemId && x.quantity === i.quantity))) throw new IfoodCatalogError('item_scope_mismatch');
  const issues: string[] = [];
  if (!context.address.id || !cart.deliveryAddress?.addressId) issues.push('address_binding_unconfirmed');
  else if (cart.deliveryAddress.addressId !== context.address.id) issues.push('address_binding_mismatch');
  const observation: CartObservation = { cartId, storeId: context.storeId,
    items: cart.items.map(i => ({ menuItemId: i.itemId, quantity: i.quantity,
      ...(unit ? { unitPriceCents: catalogMoneyCents(i.unitPrice, unit) } : {}) })), issues };
  if (!unit) { issues.push('unit_unconfirmed'); return observation; }
  if (!cart.summary || !cart.deliveryMethod || !cart.fees) { issues.push('commercial_fields_missing'); return observation; }
  const convert = (value: string | number) => catalogMoneyCents(value, unit);
  const s = cart.summary;
  const amounts = { subtotalCents: convert(s.subtotalAmount), deliveryCents: convert(s.deliveryFeeAmount), feesCents: convert(s.feeTotalAmount),
    benefitsCents: convert(s.benefitsTotalAmount), voucherCents: convert(s.voucherTotalAmount), totalCents: convert(s.totalAmount) };
  const sum = (values: number[]) => { const n = values.reduce((a, b) => a + b, 0); if (!Number.isSafeInteger(n) || n < 0) throw new IfoodCatalogError('invalid_data'); return n; };
  if (sum(observation.items.map(i => i.unitPriceCents! * i.quantity)) !== amounts.subtotalCents) issues.push('subtotal_mismatch');
  if (convert(cart.deliveryMethod.fee) !== amounts.deliveryCents) issues.push('delivery_mismatch');
  if (sum(cart.fees.map(f => convert(f.amount))) !== amounts.feesCents) issues.push('fees_mismatch');
  if (sum([amounts.subtotalCents, amounts.deliveryCents, amounts.feesCents]) - sum([amounts.benefitsCents, amounts.voucherCents]) !== amounts.totalCents) issues.push('total_decomposition_mismatch');
  return { ...observation, amounts };
}

/** Leitura isolada não prepara nem cadastra carrinho. Contexto vem do registro confiável. */
export async function readIfoodCart(client: Pick<IfoodMcpClient, 'callCartTool'>, context: PreparationContext, cartId: string, unit?: 'BRL' | 'cents') {
  const snapshot = structuredClone(context);
  return readCartObservation(await client.callCartTool('getCart', { cartId }), snapshot, cartId, unit);
}
