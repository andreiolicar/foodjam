import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { IfoodMcpReadResult } from './read-tools.js';

export type IfoodCatalogErrorReason = 'invalid_input' | 'invalid_config' | 'invalid_data'
  | 'invalid_envelope' | 'read_failed' | 'tool_failed' | 'merchant_scope_mismatch'
  | 'pagination_cycle' | 'pagination_limit' | 'conflicting_duplicate'
  | 'invalid_address' | 'address_resolution_required' | 'delivery_fee_unconfirmed' | 'item_scope_mismatch' | 'availability_unconfirmed' | 'item_price_unconfirmed';

/** Erros fixos: nunca retêm payload, argumentos, IDs ou causa remota. */
export class IfoodCatalogError extends Error {
  constructor(readonly reason: IfoodCatalogErrorReason) {
    super(`Catálogo iFood: ${reason}.`);
    this.name = 'IfoodCatalogError';
  }
}

const fail = (): never => { throw new IfoodCatalogError('invalid_data'); };
const identifier = z.string().min(1).refine((value) => value.trim().length > 0);
const money = z.union([z.string(), z.number().finite()]);
const currency = z.literal('BRL').optional();

// Perfil CANDIDATO, exercitado com fixtures. Não declara schemas oficiais MCP
// nem novos contratos compartilhados; a saída pública é inferida do mapeamento.
const merchantIdentitySchema = z.object({ merchantId: identifier, merchantName: identifier, isOpen: z.boolean() });
const merchantSchema = merchantIdentitySchema.extend({
  deliveryMethod: z.object({ fee: money, promotionalFee: money.optional() }),
  minimumOrderAmount: money.optional(), currency,
});
const itemSchema = z.object({
  itemId: identifier, itemName: identifier,
  description: z.string().optional(), itemDescription: z.string().optional(),
  unitPrice: money, promotionalUnitPrice: money.optional(), available: z.boolean().optional(),
  category: z.enum(['food', 'drink']).optional(), currency,
});
const pageSchema = z.object({
  results: z.array(z.unknown()), nextPageToken: z.string().max(8192).nullable().optional(),
  hasMore: z.boolean().optional(), resultKind: z.enum(['MERCHANT', 'ITEM']).optional(),
}).passthrough();
const missingSchema = z.object({ merchantId: identifier, found: z.literal(false) });

export function catalogInput(value: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new IfoodCatalogError('invalid_input');
}

/** Conversão decimal por inteiros, sem arredondamento nem inferência de unidade. */
export function catalogMoneyCents(value: string | number, unit: 'BRL' | 'cents'): number {
  const decimal = String(value);
  if (decimal.length > 32 || !/^\d+(?:\.\d{1,2})?$/.test(decimal)) return fail();
  const [whole = '', fraction = ''] = decimal.split('.');
  if (unit === 'cents' && fraction !== '') return fail();
  const amount = unit === 'BRL'
    ? BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) : BigInt(whole);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  return Number(amount);
}

export function catalogMerchantIdentity(value: unknown) {
  const parsed = merchantIdentitySchema.safeParse(value);
  if (!parsed.success) return fail();
  return parsed.data;
}

const itemIdentitySchema = z.object({
  itemId: identifier, merchantId: identifier.optional(),
  merchant: z.object({ merchantId: identifier }).optional(),
});

/** Associações raiz/aninhada precisam concordar quando ambas existem. */
export function catalogItemIdentity(value: unknown, storeId: string) {
  const parsed = itemIdentitySchema.safeParse(value);
  if (!parsed.success) return fail();
  const { itemId, merchantId, merchant } = parsed.data;
  const nested = merchant?.merchantId;
  if (merchantId !== undefined && nested !== undefined && merchantId !== nested) throw new IfoodCatalogError('merchant_scope_mismatch');
  const owner = nested ?? merchantId;
  if (owner === undefined) return fail();
  if (owner !== storeId) throw new IfoodCatalogError('merchant_scope_mismatch');
  return { itemId, merchantId: owner };
}

export function catalogMenuItem(value: unknown, storeId: string) {
  const identity = catalogItemIdentity(value, storeId);
  const parsed = itemSchema.safeParse(value);
  if (!parsed.success) return fail();
  const { itemDescription, description, ...row } = parsed.data;
  if (description !== undefined && itemDescription !== undefined && description !== itemDescription) return fail();
  const detail = itemDescription ?? description;
  return { ...row, ...(detail === undefined ? {} : { description: detail }), merchantId: identity.merchantId };
}

/** Perfil preliminar: ausência de preço não equivale a preço zero. */
export function catalogDiscoveryItem(value: unknown, storeId: string) {
  const identity = catalogItemIdentity(value, storeId);
  const parsed = itemSchema.partial({ unitPrice: true }).safeParse(value);
  if (!parsed.success) return fail();
  const { itemDescription, description, ...row } = parsed.data;
  if (description !== undefined && itemDescription !== undefined && description !== itemDescription) return fail();
  const detail = itemDescription ?? description;
  return { ...row, ...(detail === undefined ? {} : { description: detail }), merchantId: identity.merchantId };
}

export function catalogMerchant(value: unknown) {
  const parsed = merchantSchema.safeParse(value);
  if (!parsed.success) return fail();
  return parsed.data;
}

export function mapMerchant(value: unknown, unit: 'BRL' | 'cents') {
  const row = catalogMerchant(value);
  const fee = catalogMoneyCents(row.deliveryMethod.fee, unit);
  if (row.deliveryMethod.promotionalFee !== undefined && catalogMoneyCents(row.deliveryMethod.promotionalFee, unit) !== fee) {
    // A amostra não comprova a precedência/condições do frete promocional.
    throw new IfoodCatalogError('delivery_fee_unconfirmed');
  }
  return {
    id: row.merchantId, name: row.merchantName, isOpen: row.isOpen,
    deliveryFeeCents: fee,
    ...(row.minimumOrderAmount === undefined ? {} : { minimumOrderCents: catalogMoneyCents(row.minimumOrderAmount, unit) }),
  };
}

export function mapMenuItem(value: unknown, storeId: string, unit: 'BRL' | 'cents') {
  const row = catalogMenuItem(value, storeId);
  if (row.available === undefined) throw new IfoodCatalogError('availability_unconfirmed');
  const price = catalogMoneyCents(row.unitPrice, unit);
  if (row.promotionalUnitPrice !== undefined && catalogMoneyCents(row.promotionalUnitPrice, unit) !== price) {
    throw new IfoodCatalogError('item_price_unconfirmed');
  }
  return {
    id: row.itemId, storeId: row.merchantId, name: row.itemName,
    priceCents: price, available: row.available,
    ...(row.description === undefined ? {} : { description: row.description }),
    ...(row.category === undefined ? {} : { category: row.category }),
  };
}

export function catalogPage(value: unknown, expectedKind?: 'MERCHANT' | 'ITEM') {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success) return fail();
  const page = parsed.data;
  // Metadados são permitidos; mecanismos alternativos de paginação não podem
  // ser interpretados como fim de lista sem contrato verificado.
  if (['nextCursor', 'hasNextPage', 'cursor', 'pageInfo', 'pagination'].some((key) => Object.hasOwn(page, key))) return fail();
  if (expectedKind !== undefined && page.resultKind !== undefined && page.resultKind !== expectedKind) return fail();
  const hasToken = typeof page.nextPageToken === 'string' && page.nextPageToken.length > 0;
  if (page.hasMore === true && !hasToken || page.hasMore === false && hasToken) return fail();
  return page;
}

export function merchantMissing(value: unknown, storeId: string): boolean {
  const parsed = missingSchema.safeParse(value);
  if (!parsed.success) return false;
  if (parsed.data.merchantId !== storeId) throw new IfoodCatalogError('merchant_scope_mismatch');
  return true;
}

/** Um documento JSON; não concatena blocos nem procura campos recursivamente. */
export function catalogDocument(result: IfoodMcpReadResult): unknown {
  const invalid = (): never => { throw new IfoodCatalogError('invalid_envelope'); };
  if (!result || !Array.isArray(result.content) || result.content.length > 100) return invalid();
  if (result.isError === true) throw new IfoodCatalogError('tool_failed');
  if (result.isError !== undefined && result.isError !== false) return invalid();
  const texts = result.content.filter((block) => block?.type === 'text');
  let document: unknown = result.structuredContent;
  // structuredContent é a fonte estruturada do MCP. Uma cópia textual JSON
  // só é aceita se concordar. Texto de apresentação não é dado de domínio.
  if (document !== undefined) {
    let bytes = 0;
    for (const block of texts) {
      if (typeof block.text !== 'string') return invalid();
      bytes += Buffer.byteLength(block.text, 'utf8');
      if (bytes > 1_048_576) return invalid();
      let candidate: unknown;
      try { candidate = JSON.parse(block.text) as unknown; } catch { continue; }
      if (!isDeepStrictEqual(document, candidate)) return invalid();
    }
  } else {
    if (texts.length !== 1) return invalid();
    const raw = texts[0]!.text;
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 1_048_576) return invalid();
    try { document = JSON.parse(raw) as unknown; } catch { return invalid(); }
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return invalid();
  return document;
}

export function addCatalogRecord<T extends { id: string }>(records: Map<string, T>, row: T): void {
  const previous = records.get(row.id);
  if (previous && !isDeepStrictEqual(previous, row)) throw new IfoodCatalogError('conflicting_duplicate');
  records.set(row.id, row);
}
