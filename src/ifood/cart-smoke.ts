import type { IfoodMcpCartResult } from './cart-tools.js';

/** UUID canônico, versões 1–8 e variante padrão; rejeita UUID nulo. */
export function validateCartId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('cartId ausente ou inválido. Resposta omitida; não repita a criação automaticamente.');
  }
  return value;
}

export interface CartIdLocation {
  readonly source: 'json' | 'structuredContent' | `content[${number}].text`;
  readonly segments: readonly string[];
}

/** Seleção explícita da origem + JSON Pointer, sem procurar UUIDs no payload. */
export function parseCartIdPath(value: string): CartIdLocation {
  const fail = () => new Error('Caminho de cartId inválido. Nenhum valor foi exibido.');
  if (typeof value !== 'string' || value.length > 1024
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw fail();
  const match = /^(json|structuredContent|content\[(0|[1-9][0-9]?)\]\.text):(.*)$/.exec(value);
  if (!match || (match[3] !== '' && !match[3]!.startsWith('/'))) throw fail();
  const pointer = match[3]!;
  const segments = pointer === '' ? [] : pointer.slice(1).split('/').map((segment) => {
    if (/~(?![01])/.test(segment)) throw fail();
    const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'constructor', 'prototype'].includes(decoded)) throw fail();
    return decoded;
  });
  if (segments.length > 12) throw fail();
  const foreignFields = new Set([
    'address', 'addresses', 'addressId', 'items', 'item', 'itemId', 'cartItemId',
    'product', 'products', 'productId', 'merchant', 'merchantId', 'restaurant', 'restaurantId',
    'user', 'userId', 'customer', 'customerId', 'profile', 'account', 'accountId',
  ].map((field) => field.toLowerCase()));
  if (segments.some((segment) => foreignFields.has(segment.toLowerCase()))) throw fail();
  const leaf = segments.at(-1);
  if (leaf !== undefined && !['cartid', 'cartuuid', 'id', 'uuid'].includes(leaf.toLowerCase())) throw fail();
  return { source: match[1] as CartIdLocation['source'], segments };
}

const maxTextBytes = 1_048_576;
function parseText(text: unknown): unknown {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxTextBytes) throw new Error('Texto não inspecionável.');
  try { return JSON.parse(text) as unknown; } catch { throw new Error('Texto não JSON.'); }
}

function selectPath(value: unknown, segments: readonly string[]): { found: boolean; value: unknown } {
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { found: false, value: undefined };
    value = (value as Record<string, unknown>)[segment];
  }
  return { found: true, value };
}

export function extractCartId(result: IfoodMcpCartResult, location: CartIdLocation | undefined): string {
  if (result.isError || !location) throw new Error('Localização do cartId ainda não confirmada.');
  if (location.source === 'json') {
    const ids: string[] = [];
    const consider = (document: unknown) => {
      const selected = selectPath(document, location.segments);
      if (selected.found) ids.push(validateCartId(selected.value));
    };
    if (result.structuredContent !== undefined) consider(result.structuredContent);
    if (result.content.length > 100) throw new Error('Quantidade de fontes excede o limite.');
    let bytes = 0;
    for (const block of result.content) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue;
      bytes += Buffer.byteLength(block.text, 'utf8');
      if (bytes > maxTextBytes) throw new Error('Fontes textuais excedem o limite.');
      let document: unknown;
      try { document = parseText(block.text); } catch { continue; }
      consider(document);
    }
    if (ids.length === 0 || new Set(ids.map((id) => id.toLowerCase())).size !== 1) throw new Error('cartId ausente ou ambíguo nas fontes JSON.');
    return ids[0]!;
  }
  let value: unknown;
  if (location.source === 'structuredContent') value = result.structuredContent;
  else {
    const index = Number(/^content\[([0-9]+)\]\.text$/.exec(location.source)?.[1]);
    const block = result.content[index];
    if (block?.type !== 'text') throw new Error('Origem do cartId indisponível.');
    value = parseText(block.text);
  }
  return validateCartId(selectPath(value, location.segments).value);
}

/** Somente para rotinas locais de teste; não altera a resposta do adaptador. */
export function readJsonObjectResult(result: IfoodMcpCartResult, textOnly = false): Record<string, unknown> {
  if (result.isError) throw new Error('Ferramenta retornou isError.');
  let value: unknown = textOnly ? undefined : result.structuredContent;
  if (value === undefined) {
    if (result.content[0]?.type !== 'text') throw new Error('Formato JSON desconhecido.');
    value = parseText(result.content[0].text);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Formato JSON desconhecido.');
  return value as Record<string, unknown>;
}

/** Caminhos de getCart confirmados pelo responsável; sem reconstrução comercial. */
export function verifySingleCartItem(result: IfoodMcpCartResult, expectedCartId: string, expectedItemId: string): boolean {
  try {
    const cart = readJsonObjectResult(result, true);
    if (cart.cartId !== expectedCartId || !Array.isArray(cart.items) || cart.items.length !== 1) return false;
    const item: unknown = cart.items[0];
    return !!item && typeof item === 'object' && 'itemId' in item && item.itemId === expectedItemId
      && 'quantity' in item && item.quantity === 1;
  } catch { return false; }
}

// Somente vocabulário fixo de campos técnicos pode aparecer nos caminhos.
// Chaves arbitrárias (nomes de pessoas, e-mails, IDs usados como chave) são ocultas.
const publicProperties = new Set([
  'id', 'uuid', 'cartId', 'cartUuid', 'cart', 'carts', 'items', 'item', 'itemId', 'itemUuid',
  'cartItemId', 'quantity', 'product', 'productId', 'productUuid', 'merchant', 'merchantId',
  'restaurant', 'restaurantId', 'data', 'result', 'results', 'payload', 'body', 'response',
  'attributes', 'options', 'optionId', 'name', 'title', 'description', 'address', 'addressId',
  'streetName', 'number', 'user', 'userId', 'customer', 'customerId', 'delivery',
  'deliveryMethod', 'deliveryMethods', 'total', 'subtotal', 'price', 'unitPrice', 'currency',
  'benefits', 'discounts', 'fees', 'success', 'status', 'error', 'errors', 'message', 'code',
].map((name) => name.toLowerCase()));

interface ShapeField {
  source: CartIdLocation['source'];
  path: string;
  type: string;
}

/** Inspeção em memória, limitada e sem valores; [] indica um elemento da amostra. */
export function inspectCartResult(result: IfoodMcpCartResult): { fields: ShapeField[]; truncated: boolean; hasJson: boolean } {
  const fields: ShapeField[] = [];
  const seen = new Set<string>();
  let visited = 0;
  let truncated = false;
  let hasJson = false;
  const add = (source: ShapeField['source'], path: string, type: string) => {
    const key = JSON.stringify([source, path, type]);
    if (!seen.has(key)) { seen.add(key); fields.push({ source, path, type }); }
  };
  const walk = (source: ShapeField['source'], value: unknown, path: string, depth: number): void => {
    if (visited >= 200) { truncated = true; return; }
    visited++;
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    add(source, path, type);
    if (!value || typeof value !== 'object') return;
    if (depth >= 8) { truncated = true; return; }
    if (Array.isArray(value)) {
      if (value.length > 10) truncated = true;
      for (let index = 0; index < Math.min(value.length, 10); index++) {
        if (visited >= 200) { truncated = true; break; }
        walk(source, value[index], `${path}/[]`, depth + 1);
      }
    } else {
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (visited >= 200) { truncated = true; break; }
        const property = publicProperties.has(key.toLowerCase()) ? key : '<property>';
        walk(source, (value as Record<string, unknown>)[key], `${path}/${property}`, depth + 1);
      }
    }
  };
  if (result.structuredContent !== undefined) {
    hasJson = true;
    walk('structuredContent', result.structuredContent, '', 0);
  }
  if (result.content.length > 100) truncated = true;
  for (const [index, block] of result.content.slice(0, 100).entries()) {
    if (visited >= 200) { truncated = true; break; }
    if (block.type !== 'text') continue;
    const source = `content[${index}].text` as const;
    try {
      const value = parseText(block.text);
      hasJson = true;
      walk(source, value, '', 0);
    } catch {
      if (visited < 200) { visited++; add(source, '', 'non-json-text'); }
      else truncated = true;
    }
  }
  return { fields, truncated, hasJson };
}
