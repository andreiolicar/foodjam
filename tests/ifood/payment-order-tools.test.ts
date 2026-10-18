import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type * as StreamableHttpSdk from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createIfoodMcpClient, readIfoodMcpConfig } from '../../src/ifood/index.js';
import type { IfoodMcpDiagnostic, IfoodMcpTool } from '../../src/ifood/index.js';

const sdk = vi.hoisted(() => ({
  connect: vi.fn(), listTools: vi.fn(), request: vi.fn(), callTool: vi.fn(), close: vi.fn(), terminate: vi.fn(),
  onclose: undefined as (() => void) | undefined,
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    set onclose(callback: () => void) { sdk.onclose = callback; }
    connect = sdk.connect;
    listTools = sdk.listTools;
    request = sdk.request;
    callTool = sdk.callTool;
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

// Campos/required/format seguem os metadados observados fornecidos por Andrei.
// Os UUIDs, respostas e outputSchemas de testes são exclusivamente simulados.
const merchantId = '00000000-0000-4000-8000-000000000001';
const cartId = '00000000-0000-4000-8000-000000000002';
const paymentMethodId = '00000000-0000-4000-8000-000000000003';
const cardTokenId = '00000000-0000-4000-8000-000000000004';
const uuid = { type: 'string', format: 'uuid' };
const text = { type: 'string' };
function tool(name: string, properties: Record<string, unknown>, required: string[]): IfoodMcpTool {
  return { name, inputSchema: { type: 'object', properties, required } };
}
const tools = [
  tool('listPaymentMethods', { merchantId: uuid }, ['merchantId']),
  tool('setCartPayment', { cartId: uuid, paymentMethodId: uuid, cardTokenId: uuid }, ['cartId', 'paymentMethodId']),
  tool('getOrder', { orderId: text }, ['orderId']),
  tool('trackOrder', { orderId: text, nextPageToken: text }, ['orderId']),
];
const calls: [string, Record<string, unknown>][] = [
  ['listPaymentMethods', { merchantId }],
  ['setCartPayment', { cartId, paymentMethodId }],
  ['setCartPayment', { cartId, paymentMethodId, cardTokenId }],
  ['getOrder', { orderId: 'fixture-order-not-a-uuid' }],
  ['trackOrder', { orderId: 'fixture-order-not-a-uuid' }],
  ['trackOrder', { orderId: 'fixture-order-not-a-uuid', nextPageToken: 'private-page' }],
];
const result = {
  content: [{ type: 'text', text: 'private-content', _meta: { source: 'private-content-meta' } }],
  structuredContent: {
    paymentMethods: [{ id: paymentMethodId, cardTokenId, token: 'private-card-token' }],
    address: 'private-address', document: 'private-document', verificationCode: 'private-code',
    total: 5779, deliveryFee: '5.99', reviewedAmount: 57.79,
    status: 'fixture-status', history: [{ at: 'fixture-time', detail: 'private-history' }],
    nextPageToken: 'private-next-page', consultAgainAfterSeconds: 23,
  },
  isError: false, _meta: { audit: 'private-audit', retryAfter: 23 }, extra: 'private-extra',
};
const config = () => readIfoodMcpConfig({
  IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback',
});

beforeEach(() => {
  vi.resetAllMocks();
  sdk.connect.mockImplementation(async (transport) => {
    transport.authProvider.saveTokens({ access_token: 'test-token', token_type: 'Bearer' });
  });
  sdk.listTools.mockResolvedValue({ tools: structuredClone(tools) });
  sdk.request.mockResolvedValue(structuredClone(result));
});
afterEach(() => vi.restoreAllMocks());

describe('IF-04: pagamento controlado e acompanhamento', () => {
  it.each(calls)('executa %s e preserva envelope, valores financeiros e metadados', async (name, args) => {
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { allowPaymentConfiguration: true, onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool(name, args)).resolves.toEqual(result);
      expect(sdk.request.mock.calls.map((call) => call[0])).toEqual([{ method: 'tools/call', params: { name, arguments: args } }]);
      expect(sdk.callTool).not.toHaveBeenCalled();
      expect(events).toContainEqual(expect.objectContaining({ stage: 'tools_payment_order', event: 'succeeded' }));
      const logs = JSON.stringify(events);
      for (const sensitive of ['private-', merchantId, cartId, paymentMethodId, cardTokenId, 'test-token', 'test-secret']) expect(logs).not.toContain(sensitive);
      expect('submitOrder' in client || 'callTool' in client || 'request' in client).toBe(false);
    } finally { await client.close(); }
  });

  it.each([undefined, false, 'true', 1])('bloqueia configuração com habilitação %s, mesmo com mutações de carrinho', async (flag) => {
    const client = createIfoodMcpClient(config(), { allowCartMutations: true, allowPaymentConfiguration: flag as boolean });
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool('setCartPayment', { cartId, paymentMethodId, userConsent: true, allowPaymentConfiguration: true }))
        .rejects.toMatchObject({ diagnostic: { reason: 'payment_configuration_disabled' } });
      expect(sdk.listTools).not.toHaveBeenCalled();
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('fixa a permissão na criação; pagamento não habilita mutações de carrinho', async () => {
    const options = { allowPaymentConfiguration: false };
    const client = createIfoodMcpClient(config(), options);
    options.allowPaymentConfiguration = true;
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool('setCartPayment', { cartId, paymentMethodId })).rejects.toMatchObject({ diagnostic: { reason: 'payment_configuration_disabled' } });
    } finally { await client.close(); }
    const enabled = createIfoodMcpClient(config(), { allowPaymentConfiguration: true });
    await enabled.connect();
    try {
      await expect(enabled.callCartTool('createCart', {})).rejects.toMatchObject({ diagnostic: { reason: 'cart_mutations_disabled' } });
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await enabled.close(); }
  });

  it.each(['listPaymentMethods', 'getOrder', 'trackOrder'])('permite %s por padrão sem escolher pagamento ou consultar novamente', async (name) => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      const args = name === 'listPaymentMethods' ? { merchantId } : { orderId: 'fixture-order' };
      await expect(client.callPaymentOrderTool(name, args)).resolves.toEqual(result);
      expect(sdk.request).toHaveBeenCalledOnce();
      expect(sdk.request.mock.calls[0]?.[0]).toEqual({ method: 'tools/call', params: { name, arguments: args } });
    } finally { await client.close(); }
  });

  it.each(['submitOrder', 'ifood_submitOrder', 'unknownTool', 'getUser', 'createCart', 'setVoucher', 'ifood_getOrder', 'GETORDER', ' getOrder', '__proto__'])(
    'bloqueia %s antes da descoberta, mesmo com todas as permissões e userConsent', async (name) => {
      sdk.listTools.mockResolvedValue({ tools: [tool(name, {}, [])] });
      const client = createIfoodMcpClient(config(), { allowCartMutations: true, allowPaymentConfiguration: true });
      await client.connect();
      try {
        await expect(client.callPaymentOrderTool(name, { userConsent: true })).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_tool_not_allowed' } });
        expect(sdk.listTools).not.toHaveBeenCalled();
        expect(sdk.request).not.toHaveBeenCalled();
      } finally { await client.close(); }
    },
  );

  it.each(['submitOrder', 'listPaymentMethods', 'setCartPayment', 'getOrder', 'trackOrder'])(
    'preserva as allowlists anteriores: %s', async (name) => {
      const client = createIfoodMcpClient(config(), { allowCartMutations: true, allowPaymentConfiguration: true });
      await client.connect();
      try {
        await expect(client.callReadTool(name, { userConsent: true })).rejects.toMatchObject({ diagnostic: { reason: 'read_tool_not_allowed' } });
        await expect(client.callCartTool(name, { userConsent: true })).rejects.toMatchObject({ diagnostic: { reason: 'cart_tool_not_allowed' } });
        expect(sdk.request).not.toHaveBeenCalled();
        expect(sdk.callTool).not.toHaveBeenCalled();
      } finally { await client.close(); }
    },
  );

  it.each([
    ['listPaymentMethods', {}], ['listPaymentMethods', { merchantId: 'invalid' }],
    ['setCartPayment', { cartId, paymentMethodId: 'PIX' }],
    ['setCartPayment', { cartId, paymentMethodId: 'CREDIT_CARD' }],
    ['setCartPayment', { cartId: 'invalid', paymentMethodId }],
    ['setCartPayment', { cartId, paymentMethodId, cardTokenId: 'invalid' }],
    ['setCartPayment', { cartId }], ['getOrder', {}], ['getOrder', { orderId: 42 }],
    ['trackOrder', { orderId: 'fixture-order', nextPageToken: 42 }],
  ] as [string, Record<string, unknown>][])('valida IDs de %s pelo schema recebido sem substituí-los', async (name, args) => {
    const client = createIfoodMcpClient(config(), { allowPaymentConfiguration: true });
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool(name, args)).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_arguments_invalid' } });
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it.each([undefined, NaN, Infinity, 1n, new Date(), () => {}])('rejeita argumentos não JSON sem coerção', async (value) => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool('getOrder', { orderId: value })).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_arguments_invalid' } });
      expect(sdk.listTools).not.toHaveBeenCalled();
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('usa schema dinâmico em vez da captura histórica e compartilha catálogo com IF-02/IF-03', async () => {
    sdk.listTools.mockResolvedValue({ tools: [
      tool('getUser', {}, []), tool('getCart', {}, []),
      tool('setCartPayment', { runtimeChoice: { type: 'string', enum: ['PIX'] } }, ['runtimeChoice']),
    ] });
    sdk.callTool.mockResolvedValue({ content: [] });
    const client = createIfoodMcpClient(config(), { allowPaymentConfiguration: true });
    await client.connect();
    try {
      await client.callReadTool('getUser', {});
      await client.callCartTool('getCart', {});
      await expect(client.callPaymentOrderTool('setCartPayment', { runtimeChoice: 'PIX' })).resolves.toEqual(result);
      expect(sdk.listTools).toHaveBeenCalledOnce();
      expect(sdk.request.mock.calls[1]?.[0]).toEqual({ method: 'tools/call', params: { name: 'setCartPayment', arguments: { runtimeChoice: 'PIX' } } });
    } finally { await client.close(); }
  });

  it.each([
    [[], 'payment_order_tool_not_found'],
    [[tools[2]!, tools[2]!], 'payment_order_catalog_ambiguous'],
    [[{ ...tools[2]!, inputSchema: { type: 'object', $ref: 'https://unresolved.example.test' } }], 'payment_order_schema_invalid'],
    [[{ ...tools[2]!, execution: { taskSupport: 'required' } }], 'payment_order_execution_unsupported'],
  ] as const)('falha fechada para catálogo/schema incompatível', async (catalog, reason) => {
    sdk.listTools.mockResolvedValue({ tools: catalog });
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' })).rejects.toMatchObject({ diagnostic: { reason } });
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it.each(calls.filter(([name]) => name !== 'setCartPayment').map(([name, args]): [string, Record<string, unknown>, boolean] => [name, args, false]).concat([
    ['setCartPayment', { cartId, paymentMethodId }, true],
  ]))('annotations não autorizam nem reclassificam %s', async (name, args, hint) => {
    sdk.listTools.mockResolvedValue({ tools: [{ ...tools.find((entry) => entry.name === name)!, annotations: { readOnlyHint: hint, title: 'private-title' } }] });
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { allowPaymentConfiguration: true, onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool(name, args)).resolves.toEqual(result);
      expect(events).toContainEqual({ stage: 'tools_payment_order', event: 'annotation_mismatch' });
      expect(JSON.stringify(events)).not.toContain('private-');
    } finally { await client.close(); }
  });

  it('preserva isError mesmo quando a resposta difere do outputSchema de sucesso', async () => {
    sdk.listTools.mockResolvedValue({ tools: [{ ...tools[2]!, outputSchema: { type: 'object', required: ['successOnly'] } }] });
    const failure = { ...result, isError: true };
    sdk.request.mockResolvedValue(failure);
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' })).resolves.toEqual(failure);
      expect(events).toContainEqual({ stage: 'tools_payment_order', event: 'failed', reason: 'payment_order_tool_failed' });
      expect(events).not.toContainEqual(expect.objectContaining({ stage: 'tools_payment_order', event: 'succeeded' }));
      expect(JSON.stringify(events)).not.toContain('private-');
    } finally { await client.close(); }
  });

  it.each([null, { content: 'private-invalid' }, { content: [{ type: 'unknown', text: 'private-invalid' }] }, { content: [], isError: 'true' }])(
    'rejeita envelope MCP inválido', async (invalid) => {
      sdk.request.mockResolvedValue(invalid);
      const client = createIfoodMcpClient(config());
      await client.connect();
      try {
        await expect(client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' })).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_result_invalid' } });
      } finally { await client.close(); }
    },
  );

  it('valida outputSchema de página anterior quando fornecido pelo servidor', async () => {
    sdk.listTools.mockResolvedValueOnce({ tools: [{ ...tools[2]!, outputSchema: {
      type: 'object', properties: { total: { type: 'string' } }, required: ['total'],
    } }], nextCursor: 'private-catalog-page' }).mockResolvedValueOnce({ tools: [tools[3]!] });
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' })).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_result_invalid' } });
    } finally { await client.close(); }
  });

  it.each([
    [new McpError(-32602, 'private-message', { data: 'private-data' }), { mcpCode: -32602 }],
    [new StreamableHTTPError(403, 'private-response'), { httpStatus: 403 }],
    [new TypeError('private-network', { cause: Object.assign(new Error('private-cause'), { code: 'ECONNRESET' }) }), { networkCode: 'ECONNRESET' }],
  ] as const)('sanitiza erros MCP, autorização e rede', async (error, details) => {
    sdk.request.mockRejectedValue(error);
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      let caught: unknown;
      try { await client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' }); } catch (failure) { caught = failure; }
      expect(caught).toMatchObject({ diagnostic: { stage: 'tools_payment_order', ...details } });
      expect((caught as Error).cause).toBeUndefined();
      expect(String(caught) + JSON.stringify(events)).not.toContain('private-');
    } finally { await client.close(); }
  });

  it('exige conexão, autenticação e cliente aberto', async () => {
    const client = createIfoodMcpClient(config());
    await expect(client.callPaymentOrderTool('getOrder', {})).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_client_disconnected' } });
    sdk.connect.mockResolvedValue(undefined);
    await client.connect();
    await expect(client.callPaymentOrderTool('getOrder', {})).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_not_authenticated' } });
    await client.close();
    await expect(client.callPaymentOrderTool('getOrder', {})).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_client_disconnected' } });
    expect(sdk.request).not.toHaveBeenCalled();
  });

  it('isola argumentos e catálogo contra alteração externa durante discovery', async () => {
    let finish!: (value: unknown) => void;
    sdk.listTools.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      const args = { orderId: 'fixture-order' };
      const pending = client.callPaymentOrderTool('getOrder', args);
      args.orderId = 'changed-order';
      finish({ tools });
      await pending;
      expect(sdk.request.mock.calls[0]?.[0]).toEqual({ method: 'tools/call', params: { name: 'getOrder', arguments: { orderId: 'fixture-order' } } });
      const catalog = await client.listTools();
      catalog[2]!.inputSchema.required = [];
      await expect(client.callPaymentOrderTool('getOrder', {})).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_arguments_invalid' } });
    } finally { await client.close(); }
  });

  it('close durante descoberta impede execução e libera recursos', async () => {
    let finish!: (value: unknown) => void;
    sdk.listTools.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const client = createIfoodMcpClient(config());
    await client.connect();
    const pending = client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' });
    const rejected = expect(pending).rejects.toThrow();
    await client.close();
    finish({ tools });
    await rejected;
    await client.close();
    expect(sdk.request).not.toHaveBeenCalled();
    expect(sdk.close).toHaveBeenCalledOnce();
    expect(sdk.terminate).toHaveBeenCalledOnce();
  });

  it('invalida catálogo após falha de atualização e desconexão', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await client.listTools();
      sdk.listTools.mockRejectedValue(new Error('private-discovery'));
      await expect(client.listTools()).rejects.toThrow();
      await expect(client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' })).rejects.toThrow();
      sdk.onclose?.();
      await expect(client.callPaymentOrderTool('getOrder', { orderId: 'fixture-order' })).rejects.toMatchObject({ diagnostic: { reason: 'payment_order_client_disconnected' } });
      expect(sdk.request).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });
});
