import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createIfoodMcpClient, readIfoodMcpConfig } from '../../src/ifood/index.js';
import type { IfoodMcpDiagnostic, IfoodMcpTool } from '../../src/ifood/index.js';
import type * as StreamableHttpSdk from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const sdk = vi.hoisted(() => ({
  connect: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), request: vi.fn(), close: vi.fn(), terminate: vi.fn(),
  onclose: undefined as (() => void) | undefined,
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    set onclose(callback: () => void) { sdk.onclose = callback; }
    connect = sdk.connect;
    listTools = sdk.listTools;
    callTool = sdk.callTool;
    request = sdk.request;
    close = sdk.close;
    getServerVersion = () => ({ name: 'fixture-server', version: '1' });
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (importOriginal) => ({
  ...await importOriginal<typeof StreamableHttpSdk>(),
  StreamableHTTPClientTransport: class {
    readonly authProvider;
    constructor(_url: URL, options: { authProvider: { saveTokens(tokens: unknown): void } }) { this.authProvider = options.authProvider; }
    terminateSession = sdk.terminate;
  },
}));

// Schemas fictícios. Exercitam as diferenças de identificadores e estado completo;
// não pretendem documentar campos/nesting oficiais do MCP do iFood.
const id = { type: 'string', minLength: 1 };
const itemProperties = {
  itemId: id, quantity: { type: 'integer', minimum: 1 },
  options: { type: 'array', items: { type: 'object', properties: { optionId: id }, required: ['optionId'], additionalProperties: false } },
  notes: { type: 'string' },
};
function fixtureTool(name: string, properties: Record<string, unknown>, required: string[]): IfoodMcpTool {
  return { name, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}
const cartTools = [
  fixtureTool('createCart', {
    merchantId: id, addressId: id,
    items: { type: 'array', items: { type: 'object', properties: itemProperties, required: ['itemId', 'quantity', 'options'], additionalProperties: false } },
  }, ['merchantId', 'addressId']),
  fixtureTool('getCart', { cartId: id }, ['cartId']),
  fixtureTool('addItemToCart', { cartId: id, ...itemProperties }, ['cartId', 'itemId', 'quantity', 'options']),
  fixtureTool('updateCartItem', { cartId: id, cartItemId: id, ...itemProperties }, ['cartId', 'cartItemId', 'quantity', 'options']),
  fixtureTool('removeItemFromCart', { cartId: id, cartItemId: id }, ['cartId', 'cartItemId']),
  fixtureTool('getCartDeliveryMethods', { cartId: id }, ['cartId']),
  fixtureTool('setCartDelivery', { cartId: id, deliveryMethodId: id, scheduledAt: { type: 'string' } }, ['cartId', 'deliveryMethodId']),
];
const result = {
  content: [{ type: 'text', text: 'private-cart' }],
  structuredContent: {
    cartId: 'remote-cart', merchantId: 'remote-merchant',
    items: [{ itemId: 'remote-product', cartItemId: 'remote-line', quantity: 2, unitPrice: 2590 }],
    subtotal: 5180, deliveryFee: 599, total: 5779,
    benefits: [{ amount: 1000 }], discounts: { applied: 0 }, arbitrary: { value: 'private-audit' },
  },
  isError: false, _meta: { requestId: 'private-request-id' },
};
const config = () => readIfoodMcpConfig({
  IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback',
});
const validCalls: [string, Record<string, unknown>][] = [
  ['createCart', { merchantId: 'remote-merchant', addressId: 'remote-address' }],
  ['createCart', { merchantId: 'remote-merchant', addressId: 'remote-address', items: [{ itemId: 'remote-product', quantity: 2, options: [{ optionId: 'remote-option' }] }] }],
  ['getCart', { cartId: 'remote-cart' }],
  ['addItemToCart', { cartId: 'remote-cart', itemId: 'remote-product', quantity: 2, options: [] }],
  ['updateCartItem', { cartId: 'remote-cart', cartItemId: 'remote-line', quantity: 3, options: [{ optionId: 'remote-option' }], notes: 'private-notes' }],
  ['removeItemFromCart', { cartId: 'remote-cart', cartItemId: 'remote-line' }],
  ['getCartDeliveryMethods', { cartId: 'remote-cart' }],
  ['setCartDelivery', { cartId: 'remote-cart', deliveryMethodId: 'remote-delivery', scheduledAt: 'fixture-schedule' }],
];

beforeEach(() => {
  vi.resetAllMocks();
  sdk.connect.mockImplementation(async (transport) => {
    transport.authProvider.saveTokens({ access_token: 'test-token', token_type: 'Bearer' });
  });
  sdk.listTools.mockResolvedValue({ tools: structuredClone(cartTools) });
  sdk.callTool.mockResolvedValue(structuredClone(result));
  sdk.request.mockResolvedValue(structuredClone(result));
});
afterEach(() => vi.restoreAllMocks());

describe('IF-03: execução segura de carrinhos', () => {
  it.each(validCalls)('encaminha %s com payload completo, preservando resultado e auditoria', async (name, args) => {
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { allowCartMutations: true, onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      await expect(client.callCartTool(name, args)).resolves.toEqual(result);
      expect(sdk.request.mock.calls.map((call) => call[0])).toEqual([{ method: 'tools/call', params: { name, arguments: args } }]);
      expect(events).toContainEqual(expect.objectContaining({ stage: 'tools_cart', event: 'succeeded' }));
      expect(JSON.stringify(events)).not.toMatch(/private-|remote-|test-token|test-secret/);
      expect('callTool' in client).toBe(false);
      expect('request' in client).toBe(false);
    } finally { await client.close(); }
  });

  it.each([
    ['getCart', undefined], ['getCart', true], ['getCart', false],
    ['getCartDeliveryMethods', undefined], ['getCartDeliveryMethods', true], ['getCartDeliveryMethods', false],
  ] as const)('permite leitura %s com readOnlyHint=%s sem habilitar mutações', async (name, readOnlyHint) => {
    const tool = cartTools.find((tool) => tool.name === name)!;
    sdk.listTools.mockResolvedValue({ tools: [{
      ...tool, annotations: { title: 'private-server-title', ...(readOnlyHint === undefined ? {} : { readOnlyHint }) },
    }] });
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      await expect(client.callCartTool(name, { cartId: 'remote-cart' })).resolves.toEqual(result);
      expect(sdk.request.mock.calls.map((call) => call[0])).toEqual([
        { method: 'tools/call', params: { name, arguments: { cartId: 'remote-cart' } } },
      ]);
      expect(events.filter((event) => event.event === 'annotation_mismatch')).toEqual(
        readOnlyHint === false ? [{ stage: 'tools_cart', event: 'annotation_mismatch' }] : [],
      );
      expect(events).not.toContainEqual(expect.objectContaining({ stage: 'tools_cart', event: 'failed' }));
      expect(JSON.stringify(events)).not.toMatch(/private-|remote-|test-token|test-secret/);
    }
    finally { await client.close(); }
  });

  it.each(['createCart', 'addItemToCart', 'updateCartItem', 'removeItemFromCart', 'setCartDelivery'].flatMap(
    (name) => [undefined, true, false].map((hint) => ({ name, hint })),
  ))(
    'bloqueia $name com readOnlyHint=$hint sem autorização da aplicação', async ({ name, hint }) => {
      sdk.listTools.mockResolvedValue({ tools: [{ name, inputSchema: { type: 'object' }, ...(hint === undefined ? {} : { annotations: { readOnlyHint: hint } }) }] });
      const client = createIfoodMcpClient(config());
      await client.connect();
      try {
        // O hint já é conhecido; não pode modificar a decisão da aplicação.
        await client.listTools();
        await expect(client.callCartTool(name, { allowCartMutations: true, authorized: true })).rejects.toMatchObject({ diagnostic: { reason: 'cart_mutations_disabled' } });
        expect(sdk.listTools).toHaveBeenCalledOnce();
        expect(sdk.request).not.toHaveBeenCalled();
        expect(sdk.callTool).not.toHaveBeenCalled();
      } finally { await client.close(); }
    },
  );

  it('mutação autorizada com hint de leitura gera informação diagnóstica sem ampliar permissões', async () => {
    sdk.listTools.mockResolvedValue({ tools: [{ ...cartTools[0]!, annotations: { readOnlyHint: true, title: 'private-title' } }] });
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { allowCartMutations: true, onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      await expect(client.callCartTool('createCart', { merchantId: 'remote-merchant', addressId: 'remote-address' })).resolves.toEqual(result);
      expect(sdk.request).toHaveBeenCalledOnce();
      expect(events.filter((event) => event.event === 'annotation_mismatch')).toEqual([{ stage: 'tools_cart', event: 'annotation_mismatch' }]);
      expect(JSON.stringify(events)).not.toMatch(/private-|remote-|test-token|test-secret/);
    } finally { await client.close(); }
  });

  it('fixa a decisão de habilitação na criação e exige o booleano true', async () => {
    const options = { allowCartMutations: false };
    const client = createIfoodMcpClient(config(), options);
    options.allowCartMutations = true;
    await client.connect();
    try {
      await expect(client.callCartTool('createCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_mutations_disabled' } });
    } finally { await client.close(); }
    const malformed = createIfoodMcpClient(config(), { allowCartMutations: 'true' as unknown as boolean });
    await malformed.connect();
    try {
      await expect(malformed.callCartTool('createCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_mutations_disabled' } });
      expect(sdk.request).not.toHaveBeenCalled();
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await malformed.close(); }
  });

  it.each(['submitOrder', 'setCartPayment', 'listPaymentMethods', 'setVoucher', 'removeVoucher', 'createAddress', 'getUser', 'unknownTool', 'ifood_createCart', 'GETCART', ' getCart', '__proto__'])(
    'bloqueia %s antes de discovery e SDK mesmo com mutações habilitadas', async (name) => {
      sdk.listTools.mockResolvedValue({ tools: [{ name, inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
      const client = createIfoodMcpClient(config(), { allowCartMutations: true });
      await client.connect();
      try {
        await expect(client.callCartTool(name, {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_tool_not_allowed' } });
        expect(sdk.listTools).not.toHaveBeenCalled();
        expect(sdk.request).not.toHaveBeenCalled();
        expect(sdk.callTool).not.toHaveBeenCalled();
      } finally { await client.close(); }
    },
  );

  it.each(['submitOrder', 'setCartPayment', 'listPaymentMethods', 'setVoucher', 'removeVoucher', 'createAddress', 'getCart', 'createCart'])(
    'a habilitação de carrinhos não amplia a allowlist de callReadTool: %s', async (name) => {
      const client = createIfoodMcpClient(config(), { allowCartMutations: true });
      await client.connect();
      try {
        await expect(client.callReadTool(name, {})).rejects.toMatchObject({ diagnostic: { reason: 'read_tool_not_allowed' } });
        expect(sdk.request).not.toHaveBeenCalled();
        expect(sdk.callTool).not.toHaveBeenCalled();
      } finally { await client.close(); }
    },
  );

  it.each([
    [[], 'cart_tool_not_found'],
    [[cartTools[1]!, cartTools[1]!], 'cart_catalog_ambiguous'],
  ] as const)('falha fechada para catálogo ausente ou ambíguo', async (tools, reason) => {
    sdk.listTools.mockResolvedValue({ tools });
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callCartTool('getCart', { cartId: 'remote-cart' })).rejects.toMatchObject({ diagnostic: { reason } });
      expect(sdk.request).not.toHaveBeenCalled();
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it.each([
    ['createCart', { merchantId: 'remote-merchant' }],
    ['createCart', { merchantId: 'remote-merchant', addressId: 'remote-address', items: [{ itemId: 'remote-product', quantity: 0, options: [] }] }],
    ['getCart', { cartId: 42 }],
    ['addItemToCart', { cartId: 'remote-cart', cartItemId: 'remote-line', quantity: 2, options: [] }],
    ['updateCartItem', { cartId: 'remote-cart', cartItemId: 'remote-line', quantity: 3 }],
    ['updateCartItem', { cartId: 'remote-cart', cartItemId: 'remote-line', options: [] }],
    ['removeItemFromCart', { cartId: 'remote-cart', itemId: 'remote-product' }],
    ['setCartDelivery', { cartId: 'remote-cart' }],
    ['getCart', { cartId: 'remote-cart', unexpected: true }],
  ] as [string, Record<string, unknown>][])('valida %s pelo schema dinâmico e não completa payload parcial', async (name, args) => {
    const client = createIfoodMcpClient(config(), { allowCartMutations: true });
    await client.connect();
    try {
      await expect(client.callCartTool(name, args)).rejects.toMatchObject({ diagnostic: { reason: 'cart_arguments_invalid' } });
      expect(sdk.request).not.toHaveBeenCalled();
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('obedece mudança de schema real e reutiliza o mesmo catálogo entre APIs', async () => {
    sdk.listTools.mockResolvedValue({ tools: [
      fixtureTool('getUser', {}, []), fixtureTool('createCart', { runtimeField: { type: 'boolean' } }, ['runtimeField']),
    ] });
    const client = createIfoodMcpClient(config(), { allowCartMutations: true });
    await client.connect();
    try {
      await client.callReadTool('getUser', {});
      await client.callCartTool('createCart', { runtimeField: true });
      expect(sdk.listTools).toHaveBeenCalledOnce();
      expect(sdk.callTool.mock.calls.map((call) => call[0])).toEqual([{ name: 'getUser', arguments: {} }]);
      expect(sdk.request.mock.calls.map((call) => call[0])).toEqual([
        { method: 'tools/call', params: { name: 'createCart', arguments: { runtimeField: true } } },
      ]);
    } finally { await client.close(); }
  });

  it.each([undefined, NaN, Infinity, 1n, () => {}, new Date()])('rejeita valores que não são JSON sem coerção', async (value) => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callCartTool('getCart', { cartId: value })).rejects.toMatchObject({ diagnostic: { reason: 'cart_arguments_invalid' } });
      expect(sdk.request).not.toHaveBeenCalled();
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('isola argumentos e schema durante discovery assíncrono', async () => {
    let finish!: (value: unknown) => void;
    sdk.listTools.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      const args = { cartId: 'remote-cart' };
      const pending = client.callCartTool('getCart', args);
      args.cartId = 'changed-cart';
      finish({ tools: cartTools });
      await pending;
      expect(sdk.request.mock.calls[0]?.[0]).toEqual({ method: 'tools/call', params: { name: 'getCart', arguments: { cartId: 'remote-cart' } } });
      const catalog = await client.listTools();
      catalog[1]!.inputSchema.required = [];
      await expect(client.callCartTool('getCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_arguments_invalid' } });
    } finally { await client.close(); }
  });

  it('rejeita schema não compilável sem execução', async () => {
    sdk.listTools.mockResolvedValue({ tools: [{ name: 'getCart', inputSchema: { type: 'object', $ref: 'https://unresolved.example.test/schema' } }] });
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callCartTool('getCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_schema_invalid' } });
      expect(sdk.request).not.toHaveBeenCalled();
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('preserva isError e dados originais mesmo incompatíveis com outputSchema de sucesso', async () => {
    const failure = { content: [{ type: 'text', text: 'private-failure' }], isError: true, structuredContent: { detail: 'private-detail' }, _meta: { requestId: 'private-audit' } };
    sdk.listTools.mockResolvedValue({ tools: [{ ...cartTools[1]!, outputSchema: { type: 'object', required: ['successOnly'] } }] });
    sdk.request.mockResolvedValue(failure);
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      expect(await client.callCartTool('getCart', { cartId: 'remote-cart' })).toBe(failure);
      expect(events).toContainEqual(expect.objectContaining({ stage: 'tools_cart', event: 'failed', reason: 'cart_tool_failed' }));
      expect(events).not.toContainEqual(expect.objectContaining({ stage: 'tools_cart', event: 'succeeded' }));
      expect(JSON.stringify(events)).not.toContain('private-');
    } finally { await client.close(); }
  });

  it.each([null, { content: 'private-result' }, { content: [{ type: 'unknown', text: 'private-result' }] }])('rejeita envelope incompatível', async (invalid) => {
    sdk.request.mockResolvedValue(invalid);
    const client = createIfoodMcpClient(config());
    await client.connect();
    try { await expect(client.callCartTool('getCart', { cartId: 'remote-cart' })).rejects.toMatchObject({ diagnostic: { reason: 'cart_result_invalid' } }); }
    finally { await client.close(); }
  });

  it('valida outputSchema de página anterior sem transformar valores financeiros', async () => {
    sdk.listTools.mockResolvedValueOnce({ tools: [{ ...cartTools[1]!, outputSchema: { type: 'object', properties: { total: { type: 'integer' } }, required: ['total'] } }], nextCursor: 'second' })
      .mockResolvedValueOnce({ tools: [] });
    sdk.request.mockResolvedValue(result);
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      expect(await client.callCartTool('getCart', { cartId: 'remote-cart' })).toBe(result);
      expect(result.structuredContent).toMatchObject({ subtotal: 5180, deliveryFee: 599, total: 5779, benefits: [{ amount: 1000 }], discounts: { applied: 0 } });
      sdk.request.mockResolvedValue({ content: [], structuredContent: { total: '5779' } });
      await expect(client.callCartTool('getCart', { cartId: 'remote-cart' })).rejects.toMatchObject({ diagnostic: { reason: 'cart_result_invalid' } });
    } finally { await client.close(); }
  });

  it.each([
    [new McpError(-32602, 'private-data', { detail: 'private-detail' }), { mcpCode: -32602 }],
    [new StreamableHTTPError(403, 'private-response'), { httpStatus: 403 }],
    [new StreamableHTTPError(404, 'private-session'), { httpStatus: 404 }],
    [new TypeError('private-network', { cause: Object.assign(new Error('private-host'), { code: 'ECONNRESET' }) }), { networkCode: 'ECONNRESET' }],
  ] as const)('sanitiza falha técnica e não repete mutação automaticamente', async (error, details) => {
    sdk.request.mockRejectedValue(error);
    const client = createIfoodMcpClient(config(), { allowCartMutations: true });
    await client.connect();
    try {
      let failure: unknown;
      try { await client.callCartTool('createCart', { merchantId: 'remote-merchant', addressId: 'remote-address' }); } catch (caught) { failure = caught; }
      expect(failure).toMatchObject({ diagnostic: { stage: 'tools_cart', event: 'failed', ...details } });
      expect((failure as Error).cause).toBeUndefined();
      expect(String(failure)).not.toContain('private-');
      expect(sdk.request).toHaveBeenCalledOnce();
    } finally { await client.close(); }
  });

  it('exige conexão ativa, tokens e cliente aberto', async () => {
    const client = createIfoodMcpClient(config());
    await expect(client.callCartTool('getCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_client_disconnected' } });
    sdk.connect.mockResolvedValue(undefined);
    await client.connect();
    await expect(client.callCartTool('getCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_not_authenticated' } });
    await client.close();
    await expect(client.callCartTool('getCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_client_disconnected' } });
    expect(sdk.request).not.toHaveBeenCalled();
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it('invalida catálogo ao perder sessão e encerra recursos de forma idempotente', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    await client.listTools();
    sdk.onclose!();
    await expect(client.callCartTool('getCart', { cartId: 'remote-cart' })).rejects.toMatchObject({ diagnostic: { reason: 'cart_client_disconnected' } });
    await client.close();
    await client.close();
    expect(sdk.close).toHaveBeenCalledOnce();
    expect(sdk.request).not.toHaveBeenCalled();
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it('não executa mutação se close ocorrer durante discovery', async () => {
    let finish!: (value: unknown) => void;
    sdk.listTools.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const client = createIfoodMcpClient(config(), { allowCartMutations: true });
    await client.connect();
    const pending = client.callCartTool('createCart', { merchantId: 'remote-merchant', addressId: 'remote-address' });
    const failure = expect(pending).rejects.toMatchObject({ diagnostic: { stage: 'tools_list', event: 'failed' } });
    await client.close();
    finish({ tools: cartTools });
    await failure;
    expect(sdk.request).not.toHaveBeenCalled();
    expect(sdk.callTool).not.toHaveBeenCalled();
    expect(sdk.terminate).toHaveBeenCalledOnce();
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it('bloqueia antes de enviar quando o diagnóstico de início encerra o cliente', async () => {
    const client = createIfoodMcpClient(config(), {
      allowCartMutations: true,
      onDiagnostic: (event) => { if (event.stage === 'tools_cart' && event.event === 'started') void client.close(); },
    });
    await client.connect();
    try {
      await expect(client.callCartTool('createCart', { merchantId: 'remote-merchant', addressId: 'remote-address' })).rejects.toMatchObject({ diagnostic: { reason: 'cart_client_disconnected' } });
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('não envia uma ferramenta que exige MCP Tasks, inclusive em página anterior', async () => {
    sdk.listTools.mockResolvedValueOnce({ tools: [{ ...cartTools[0]!, execution: { taskSupport: 'required' } }], nextCursor: 'second' })
      .mockResolvedValueOnce({ tools: [] });
    const client = createIfoodMcpClient(config(), { allowCartMutations: true });
    await client.connect();
    try {
      await expect(client.callCartTool('createCart', { merchantId: 'remote-merchant', addressId: 'remote-address' })).rejects.toMatchObject({ diagnostic: { reason: 'cart_execution_unsupported' } });
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('falha de atualização do catálogo impede reutilizar metadados anteriores', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await client.listTools();
      sdk.listTools.mockRejectedValue(new Error('private-discovery'));
      await expect(client.listTools()).rejects.toMatchObject({ diagnostic: { stage: 'tools_list' } });
      await expect(client.callCartTool('getCart', { cartId: 'remote-cart' })).rejects.toMatchObject({ diagnostic: { stage: 'tools_list' } });
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });
});
