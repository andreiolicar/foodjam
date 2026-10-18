import { describe, expect, it } from 'vitest';
import { extractCartId, inspectCartResult, parseCartIdPath, validateCartId, verifySingleCartItem } from '../../src/ifood/cart-smoke.js';

const cartId = 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9';

describe('identificador para smoke test de carrinho', () => {
  it.each([
    'a2f61c8d-759c-44a1-bb2e-d6c507d968a9',
    'A2F61C8D-759C-44A1-BB2E-D6C507D968A9',
    '019c6e27-e55b-73d1-87d8-4e01f1f75043',
  ])('aceita UUID canônico retornado pelo MCP sem transformá-lo', (id) => {
    expect(validateCartId(id)).toBe(id);
  });

  it.each([
    undefined, null, 42, {}, 'private-id',
    'a2f61c8d-759c-44a1-bb2e-d6c507d968a9\nprivate-payload',
    'a2f61c8d-759c-44a1-bb2e-d6c507d968a9\n',
    'a2f61c8d-759c-44a1-0b2e-d6c507d968a9',
    'a2f61c8d-759c-04a1-bb2e-d6c507d968a9',
    '00000000-0000-0000-0000-000000000000',
  ])('recusa ID inválido sem incluir o valor na mensagem', (id) => {
    expect(() => validateCartId(id)).toThrow('cartId ausente ou inválido');
    try { validateCartId(id); } catch (error) {
      expect(String(error)).not.toContain('private-');
      expect((error as Error).cause).toBeUndefined();
    }
  });
});

describe('inspeção local sanitizada', () => {
  it('mostra somente origem, caminhos e tipos do conteúdo estruturado', () => {
    const result = {
      content: [], _meta: { requestId: 'private-audit' },
      structuredContent: { data: { cart: { id: cartId, items: [{ product: { id: 'private-product', name: 'private-name' }, quantity: 1 }], address: { streetName: 'private-street', number: 'private-number' } } } },
    };
    const inspection = inspectCartResult(result);
    expect(inspection.fields).toContainEqual({ source: 'structuredContent', path: '/data/cart/id', type: 'string' });
    expect(inspection.fields).toContainEqual({ source: 'structuredContent', path: '/data/cart/items', type: 'array' });
    expect(inspection.fields).toContainEqual({ source: 'structuredContent', path: '/data/cart/items/[]/product/id', type: 'string' });
    expect(inspection.fields).toContainEqual({ source: 'structuredContent', path: '/data/cart/items/[]/quantity', type: 'number' });
    expect(inspection.hasJson).toBe(true);
    expect(JSON.stringify(inspection)).not.toMatch(/private-|a2f61c8d/);
  });

  it('identifica JSON em blocos textuais sem ecoar textos não JSON', () => {
    const inspection = inspectCartResult({ content: [
      { type: 'text', text: 'private-message' },
      { type: 'text', text: JSON.stringify({ cart: { items: [{ itemId: 'private-product', quantity: 1 }] } }) },
    ] });
    expect(inspection.fields).toContainEqual({ source: 'content[0].text', path: '', type: 'non-json-text' });
    expect(inspection.fields).toContainEqual({ source: 'content[1].text', path: '/cart/items/[]/itemId', type: 'string' });
    expect(inspection.hasJson).toBe(true);
    expect(JSON.stringify(inspection)).not.toContain('private-');
  });

  it('oculta nomes de propriedades dinâmicas e não inspeciona metadados', () => {
    const inspection = inspectCartResult({ content: [], _meta: { id: cartId }, structuredContent: {
      'private-person@example.test': { quantity: 1 }, Andrei: 'private-value', [cartId]: 'private-value',
    } });
    expect(inspection.fields).toContainEqual({ source: 'structuredContent', path: '/<property>', type: 'object' });
    expect(JSON.stringify(inspection)).not.toMatch(/private-|Andrei|a2f61c8d|_meta/);
  });

  it('limita profundidade, campos e amostragem de arrays sem listar o payload completo', () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let i = 0; i < 30; i++) { cursor.data = {}; cursor = cursor.data as Record<string, unknown>; }
    const inspection = inspectCartResult({ content: [], structuredContent: { data: deeplyNested, items: Array.from({ length: 1000 }, () => ({ id: 'private-id' })) } });
    expect(inspection.truncated).toBe(true);
    expect(inspection.fields.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(inspection)).not.toContain('private-');
  });

  it('não tenta converter Markdown ou texto livre em resposta estruturada', () => {
    const inspection = inspectCartResult({ content: [{ type: 'text', text: '```json\n{"cartId":"private-id"}\n```' }] });
    expect(inspection.hasJson).toBe(false);
    expect(inspection.fields).toEqual([{ source: 'content[0].text', path: '', type: 'non-json-text' }]);
  });

  it('não lê propriedades nem interpreta novos textos após esgotar 200 visitas', () => {
    const structuredContent: Record<string, unknown> = {};
    for (let i = 0; i < 199; i++) structuredContent[`field${i}`] = 'private-value';
    let latePropertyReads = 0;
    Object.defineProperty(structuredContent, 'address', {
      enumerable: true, get: () => { latePropertyReads++; return 'private-address'; },
    });
    let lateTextReads = 0;
    const block = { type: 'text', get text() { lateTextReads++; return '{"cartId":"private-id"}'; } };
    const inspection = inspectCartResult({ content: [block], structuredContent });
    expect(inspection.truncated).toBe(true);
    expect(latePropertyReads).toBe(0);
    expect(lateTextReads).toBe(0);
    expect(inspection.fields.some((field) => field.source === 'content[0].text')).toBe(false);
  });
});

describe('extração por caminho explicitamente informado', () => {
  it.each([
    { content: [], structuredContent: { cartId } },
    { content: [{ type: 'text', text: JSON.stringify({ cartId, address: 'private-address' }) }] },
    { content: [{ type: 'text', text: 'private-status' }, { type: 'text', text: JSON.stringify({ cartId }) }] },
    { content: [{ type: 'text', text: JSON.stringify({ cartId }) }], structuredContent: { cartId } },
  ])('json:/cartId seleciona somente o caminho explícito entre fontes JSON', (result) => {
    expect(extractCartId(result, parseCartIdPath('json:/cartId'))).toBe(cartId);
  });

  it('recusa fontes com identificadores de carrinho contraditórios', () => {
    expect(() => extractCartId({
      content: [{ type: 'text', text: '{"cartId":"beeb1864-09ad-44ba-8393-5a49c069cbe2"}' }],
      structuredContent: { cartId },
    }, parseCartIdPath('json:/cartId'))).toThrow();
  });

  it('json:/cartId não busca outros UUIDs nem assume campos id ou wrappers', () => {
    expect(() => extractCartId({ content: [], structuredContent: { id: cartId, cart: { cartId }, merchantId: cartId } }, parseCartIdPath('json:/cartId'))).toThrow();
  });
  it.each([
    [{ content: [], structuredContent: { cart: { id: cartId, itemId: 'private-product' } } }, 'structuredContent:/cart/id'],
    [{ content: [{ type: 'text', text: JSON.stringify({ data: { cartId, merchantId: 'private-merchant' } }) }] }, 'content[0].text:/data/cartId'],
  ])('extrai somente o UUID no caminho autorizado pelo operador', (result, path) => {
    expect(extractCartId(result, parseCartIdPath(path))).toBe(cartId);
  });

  it('não procura UUID em outros campos quando o caminho é desconhecido ou ausente', () => {
    const result = { content: [], structuredContent: { merchantId: cartId, itemId: cartId, address: { id: cartId } } };
    expect(() => extractCartId(result, undefined)).toThrow();
    expect(() => extractCartId(result, parseCartIdPath('structuredContent:/cartId'))).toThrow();
  });

  it.each([
    'structuredContent:/__proto__/id', 'structuredContent:/constructor/id',
    'structuredContent:/cart/~2id', 'content[-1].text:/cartId', 'content[100].text:/cartId',
    'unknown:/cartId', 'structuredContent:cartId',
    'structuredContent:/address/id', 'structuredContent:/items/0/itemId',
    'structuredContent:/merchantId', 'structuredContent:/user/id',
    'structuredContent:/cart/id\n',
  ])('rejeita origem/caminho inválido sem publicar a entrada: %s', (path) => {
    expect(() => parseCartIdPath(path)).toThrow('Caminho de cartId inválido');
  });

  it.each([
    { content: [], structuredContent: { cartId: 'private-invalid-id' } },
    { content: [{ type: 'text', text: 'private-text' }] },
    { content: [], isError: true, structuredContent: { cartId } },
  ])('falha fechada para UUID inválido, fonte ausente ou isError', (result) => {
    expect(() => extractCartId(result, parseCartIdPath('structuredContent:/cartId'))).toThrow();
  });
});

describe('conferência do getCart observado pelo responsável', () => {
  const itemId = '18409df3-1e16-4bf8-9be5-433882c049aa';
  const output = (body: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });
  it('confirma carrinho, exatamente um produto esperado e quantidade numérica 1', () => {
    const result = output({ cartId, items: [{ itemId, cartItemId: 'private-line', quantity: 1, unitPrice: 3590 }], address: 'private-address' });
    const original = JSON.stringify(result);
    expect(verifySingleCartItem(result, cartId, itemId)).toBe(true);
    expect(JSON.stringify(result)).toBe(original);
  });

  it.each([
    { cartId, items: [] },
    { cartId, items: [{ itemId, quantity: 1 }, { itemId, quantity: 1 }] },
    { cartId, items: [{ itemId, quantity: 2 }] },
    { cartId, items: [{ itemId, quantity: '1' }] },
    { cartId, items: [{ cartItemId: itemId, quantity: 1 }] },
    { cartId, items: [{ itemId: 'private-other-product', quantity: 1 }] },
    { cartId: 'private-other-cart', items: [{ itemId, quantity: 1 }] },
    { cart: { cartId, items: [{ itemId, quantity: 1 }] } },
  ])('falha fechada para identidade, quantidade, cardinalidade ou formato divergentes', (body) => {
    expect(verifySingleCartItem(output(body), cartId, itemId)).toBe(false);
  });

  it('não presume fontes diferentes da observada nem aceita isError', () => {
    const body = { cartId, items: [{ itemId, quantity: 1 }] };
    expect(verifySingleCartItem({ content: [], structuredContent: body }, cartId, itemId)).toBe(false);
    expect(verifySingleCartItem({ ...output(body), isError: true }, cartId, itemId)).toBe(false);
    expect(verifySingleCartItem({ content: [{ type: 'text', text: 'private-non-json' }] }, cartId, itemId)).toBe(false);
  });
});
