import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createIfoodMcpClient, readIfoodMcpConfig } from '../../src/ifood/index.js';
import type { IfoodMcpDiagnostic } from '../../src/ifood/index.js';
import type * as StreamableHttpSdk from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const sdk = vi.hoisted(() => ({ connect: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), close: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect;
    listTools = sdk.listTools;
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
    close = async () => {};
    terminateSession = async () => {};
  },
}));

// Schemas inteiramente fictícios para testar validação; não são parâmetros oficiais.
const searchTool = {
  name: 'searchOffers', description: 'Fixture de leitura.',
  inputSchema: {
    type: 'object', properties: { fixtureQuery: { type: 'string', minLength: 1 } },
    required: ['fixtureQuery'], additionalProperties: false,
  },
};
const args = { fixtureQuery: 'fixture-preference' };
const result = {
  content: [{ type: 'text', text: 'private-response' }],
  structuredContent: { fixtureItems: [{ name: 'private-item', arbitrary: 123 }] },
  _meta: { fixture: 'preserved' }, isError: false,
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
  sdk.listTools.mockResolvedValue({ tools: [structuredClone(searchTool)] });
  sdk.callTool.mockResolvedValue(structuredClone(result));
  sdk.close.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('execução segura de consultas', () => {
  it('descobre catálogo, encaminha argumentos intactos e preserva conteúdo/estrutura/metadados', async () => {
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      expect(await client.callReadTool('searchOffers', args)).toEqual(result);
      expect(sdk.callTool.mock.calls[0]?.[0]).toEqual({ name: 'searchOffers', arguments: args });
      expect(sdk.listTools).toHaveBeenCalledOnce();
      expect(JSON.stringify(events)).not.toMatch(/private-response|private-item|fixture-preference|test-token|test-secret/);
      expect('callTool' in client).toBe(false);
    } finally { await client.close(); }
  });

  it.each(['getUser', 'listAddresses', 'browseOffers', 'searchOffers', 'getRecommendations', 'getMerchant', 'getItem'])(
    'executa %s somente quando o nome exato está no catálogo', async (name) => {
      sdk.listTools.mockResolvedValue({ tools: [{ name, inputSchema: { type: 'object', additionalProperties: false } }] });
      const client = createIfoodMcpClient(config());
      await client.connect();
      try {
        await expect(client.callReadTool(name, {})).resolves.toEqual(result);
        expect(sdk.callTool.mock.calls[0]?.[0]).toEqual({ name, arguments: {} });
      } finally { await client.close(); }
    },
  );

  it.each(['createCart', 'addItemToCart', 'updateCartItem', 'removeItemFromCart', 'createAddress', 'setCartPayment', 'submitOrder', 'unknownTool', 'ifood_getUser', 'GETUSER', ' getUser', '__proto__'])(
    'bloqueia %s mesmo quando anunciado como readOnlyHint', async (name) => {
      sdk.listTools.mockResolvedValue({ tools: [{ name, inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
      const client = createIfoodMcpClient(config());
      await client.connect();
      try {
        await expect(client.callReadTool(name, {})).rejects.toMatchObject({ diagnostic: { reason: 'read_tool_not_allowed' } });
        expect(sdk.callTool).not.toHaveBeenCalled();
      } finally { await client.close(); }
    },
  );

  it('bloqueia nome aprovado ausente do catálogo', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callReadTool('getRecommendations', {})).rejects.toMatchObject({ diagnostic: { reason: 'read_tool_not_found' } });
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('bloqueia ferramenta aprovada que anuncia escrita ou tem nomes duplicados', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      sdk.listTools.mockResolvedValue({ tools: [{ ...searchTool, annotations: { readOnlyHint: false } }] });
      await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_tool_write_hint' } });
      sdk.listTools.mockResolvedValue({ tools: [searchTool, searchTool] });
      await client.listTools();
      await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_catalog_ambiguous' } });
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it.each([{}, { fixtureQuery: 42 }, { fixtureQuery: '' }, { fixtureQuery: 'x', unexpected: true }, { fixtureQuery: undefined }])(
    'rejeita argumentos incompatíveis antes de tools/call: %j', async (invalid) => {
      const client = createIfoodMcpClient(config());
      await client.connect();
      try {
        await expect(client.callReadTool('searchOffers', invalid)).rejects.toMatchObject({ diagnostic: { reason: 'read_arguments_invalid' } });
        expect(sdk.callTool).not.toHaveBeenCalled();
      } finally { await client.close(); }
    },
  );

  it('falha fechada quando o schema não pode ser compilado', async () => {
    sdk.listTools.mockResolvedValue({ tools: [{ ...searchTool, inputSchema: { type: 'object', $ref: 'https://unresolved.example.test/schema' } }] });
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_schema_invalid' } });
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('preserva isError e resposta de falha sem registrá-los', async () => {
    const errorResult = { content: [{ type: 'text', text: 'private-failure' }], isError: true, structuredContent: { private: 'private-detail' } };
    sdk.callTool.mockResolvedValue(errorResult);
    const events: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(config(), { onDiagnostic: (event) => events.push(event) });
    await client.connect();
    try {
      expect(await client.callReadTool('searchOffers', args)).toEqual(errorResult);
      expect(events).toContainEqual(expect.objectContaining({ stage: 'tools_read', event: 'failed', reason: 'read_tool_failed' }));
      expect(events).not.toContainEqual(expect.objectContaining({ stage: 'tools_read', event: 'succeeded' }));
      expect(JSON.stringify(events)).not.toContain('private-');
    } finally { await client.close(); }
  });

  it.each([null, 'private-response', { content: 'private-response' }, { content: [{ type: 'unknown', data: 'private-response' }] }])(
    'não transforma respostas incompatíveis em sucesso: %j', async (invalid) => {
      sdk.callTool.mockResolvedValue(invalid);
      const client = createIfoodMcpClient(config());
      await client.connect();
      try {
        await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_result_invalid' } });
      } finally { await client.close(); }
    },
  );

  it('valida outputSchema da ferramenta de uma página anterior do catálogo', async () => {
    sdk.listTools.mockResolvedValueOnce({ tools: [{ ...searchTool, outputSchema: {
      type: 'object', properties: { fixtureTotal: { type: 'number' } }, required: ['fixtureTotal'],
    } }], nextCursor: 'second' }).mockResolvedValueOnce({ tools: [] });
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_result_invalid' } });
    } finally { await client.close(); }
  });

  it.each([new McpError(-32602, 'private-arguments', { private: 'private-data' }), new StreamableHTTPError(403, 'private-response'), new TypeError('private-request')])(
    'sanitiza erros MCP, autorização e comunicação', async (error) => {
      sdk.callTool.mockRejectedValue(error);
      const events: IfoodMcpDiagnostic[] = [];
      const client = createIfoodMcpClient(config(), { onDiagnostic: (event) => events.push(event) });
      await client.connect();
      try {
        let failure: unknown;
        try { await client.callReadTool('searchOffers', args); } catch (caught) { failure = caught; }
        expect(failure).toMatchObject({ diagnostic: { stage: 'tools_read', event: 'failed' } });
        if (error instanceof McpError) expect(failure).toMatchObject({ diagnostic: { mcpCode: -32602 } });
        if (error instanceof StreamableHTTPError) expect(failure).toMatchObject({ diagnostic: { httpStatus: 403 } });
        expect(String(failure) + JSON.stringify(events)).not.toContain('private-');
      } finally { await client.close(); }
    },
  );

  it('exige conexão, tokens e cliente aberto', async () => {
    const client = createIfoodMcpClient(config());
    await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_client_disconnected' } });
    sdk.connect.mockResolvedValue(undefined);
    await client.connect();
    await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_not_authenticated' } });
    await client.close();
    await expect(client.callReadTool('searchOffers', args)).rejects.toMatchObject({ diagnostic: { reason: 'read_client_disconnected' } });
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it('isola catálogo de mutações externas e invalida cache após falha de atualização', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    try {
      const catalog = await client.listTools();
      catalog[0]!.inputSchema.required = [];
      await expect(client.callReadTool('searchOffers', {})).rejects.toMatchObject({ diagnostic: { reason: 'read_arguments_invalid' } });
      sdk.listTools.mockRejectedValue(new Error('private-discovery'));
      await expect(client.listTools()).rejects.toThrow();
      await expect(client.callReadTool('searchOffers', args)).rejects.toThrow();
      expect(sdk.callTool).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it('não executa leitura se close ocorrer durante discovery', async () => {
    let finishDiscovery: (value: unknown) => void;
    sdk.listTools.mockImplementationOnce(() => new Promise((resolve) => { finishDiscovery = resolve; }));
    const client = createIfoodMcpClient(config());
    await client.connect();
    const pending = client.callReadTool('searchOffers', args);
    const failure = expect(pending).rejects.toThrow();
    await client.close();
    finishDiscovery!({ tools: [searchTool] });
    await failure;
    expect(sdk.callTool).not.toHaveBeenCalled();
  });
});
