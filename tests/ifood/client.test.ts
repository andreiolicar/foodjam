import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { readIfoodMcpConfig } from '../../src/ifood/config.js';
import { createIfoodMcpClient } from '../../src/ifood/client.js';
import type * as StreamableHttpSdk from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const doubles = vi.hoisted(() => ({
  connect: vi.fn(), listTools: vi.fn(), close: vi.fn(),
  terminate: vi.fn(), transportClose: vi.fn(), finishAuth: vi.fn(),
  clients: vi.fn(), transports: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    constructor(...args: unknown[]) { doubles.clients(...args); }
    connect = doubles.connect;
    listTools = doubles.listTools;
    close = doubles.close;
    getServerVersion = () => ({ name: 'test-server', version: '1.0' });
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (importOriginal) => ({
  ...await importOriginal<typeof StreamableHttpSdk>(),
  StreamableHTTPClientTransport: class {
    constructor(...args: unknown[]) { doubles.transports(...args); }
    terminateSession = doubles.terminate;
    close = doubles.transportClose;
    finishAuth = doubles.finishAuth;
  },
}));

const config = () => readIfoodMcpConfig({
  IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback',
});
const tool = {
  name: 'server_tool', description: 'Descrição retornada pelo servidor.',
  inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } } },
  annotations: { readOnlyHint: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  doubles.connect.mockResolvedValue(undefined);
  doubles.close.mockResolvedValue(undefined);
  doubles.terminate.mockResolvedValue(undefined);
  doubles.transportClose.mockResolvedValue(undefined);
  doubles.listTools.mockResolvedValue({ tools: [tool] });
});
afterEach(() => vi.restoreAllMocks());

describe('cliente MCP de descoberta', () => {
  it('construção e importação não abrem conexão ou navegador', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
    const openBrowser = vi.fn();
    await import('../../src/ifood/index.js');
    const client = createIfoodMcpClient(config(), { openBrowser });
    expect(doubles.clients).not.toHaveBeenCalled();
    expect(doubles.transports).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
    expect('callTool' in client).toBe(false);
    await client.close();
  });

  it('inicializa explicitamente e retorna informações do servidor', async () => {
    const client = createIfoodMcpClient(config());
    await expect(client.connect()).resolves.toEqual({ name: 'test-server', version: '1.0' });
    expect(doubles.connect).toHaveBeenCalledOnce();
    expect(doubles.transports.mock.calls[0]?.[0].href).toBe(config().endpoint);
    await client.connect();
    expect(doubles.connect).toHaveBeenCalledOnce();
    await client.close();
  });

  it('exige conexão antes de listar', async () => {
    const client = createIfoodMcpClient(config());
    await expect(client.listTools()).rejects.toThrow('conectado');
    expect(doubles.listTools).not.toHaveBeenCalled();
    await client.close();
  });

  it('lista todas as páginas e preserva schemas e metadados reais', async () => {
    doubles.listTools.mockResolvedValueOnce({ tools: [tool], nextCursor: 'page2' })
      .mockResolvedValueOnce({ tools: [{ ...tool, name: 'another_tool', outputSchema: { type: 'object' } }] });
    const client = createIfoodMcpClient(config());
    await client.connect();
    await expect(client.listTools()).resolves.toEqual([
      tool, { ...tool, name: 'another_tool', outputSchema: { type: 'object' } },
    ]);
    expect(doubles.listTools.mock.calls[1]?.[0]).toEqual({ cursor: 'page2' });
    await client.close();
  });

  it('interrompe paginação com cursor repetido', async () => {
    doubles.listTools.mockResolvedValue({ tools: [tool], nextCursor: 'repeated' });
    const client = createIfoodMcpClient(config());
    await client.connect();
    await expect(client.listTools()).rejects.toThrow('listar');
    await client.close();
  });

  it.each(['connect', 'listTools'] as const)('sanitiza erros de %s', async (operation) => {
    const client = createIfoodMcpClient(config());
    if (operation === 'listTools') await client.connect();
    doubles[operation].mockRejectedValueOnce(new Error('test-secret access_token=private code=private'));
    await expect(client[operation]()).rejects.toThrow(operation === 'connect' ? 'conectar' : 'listar');
    await client.close();
  });

  it('não tenta OAuth quando não existe redirecionamento válido', async () => {
    doubles.connect.mockRejectedValueOnce(new UnauthorizedError());
    const client = createIfoodMcpClient(config());
    await expect(client.connect()).rejects.toThrow('autenticação');
    expect(doubles.finishAuth).not.toHaveBeenCalled();
    await client.close();
  });

  it('encerra sessão, conexão e credenciais e permite close repetido', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    await client.close();
    await client.close();
    expect(doubles.terminate).toHaveBeenCalledOnce();
    expect(doubles.close).toHaveBeenCalledOnce();
    await expect(client.connect()).rejects.toThrow('encerrado');
  });

  it('fecha conexão mesmo quando encerramento remoto falha', async () => {
    const client = createIfoodMcpClient(config());
    await client.connect();
    doubles.terminate.mockRejectedValueOnce(new Error('access_token=private'));
    await expect(client.close()).rejects.toThrow('encerrar');
    expect(doubles.close).toHaveBeenCalledOnce();
  });
});
