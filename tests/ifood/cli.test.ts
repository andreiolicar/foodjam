import { describe, expect, it, vi } from 'vitest';
import { runDiscovery } from '../../src/ifood/cli.js';
import { diagnosticError } from '../../src/ifood/diagnostics.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const env = {
  IFOOD_MCP_CLIENT_ID: 'client', IFOOD_MCP_CLIENT_SECRET: 'private-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback',
};

describe('CLI de descoberta', () => {
  it('mostra servidor, contagem, nomes, descrições e schemas, encerrando a conexão', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue({ name: 'server', version: '1.0' }),
      listTools: vi.fn().mockResolvedValue([{
        name: 'discovered_tool', description: 'Retornada pelo servidor.', inputSchema: { type: 'object' },
      }]), close: vi.fn().mockResolvedValue(undefined),
    };
    const log = vi.fn();
    const error = vi.fn();
    expect(await runDiscovery({ env, createClient: () => client, log, error })).toBe(0);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('Conectado');
    expect(output).toContain('server');
    expect(output).toContain('1 ferramenta');
    expect(output).toContain('discovered_tool');
    expect(output).toContain('Retornada pelo servidor.');
    expect(output).toContain('"type": "object"');
    expect(output).not.toContain('private-secret');
    expect(client.close).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('falha antes da conexão quando faltam credenciais', async () => {
    const createClient = vi.fn();
    const error = vi.fn();
    expect(await runDiscovery({ env: {}, createClient, error })).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join()).toContain('IFOOD_MCP_CLIENT_ID');
  });

  it('não imprime erros externos e fecha após falha de comunicação', async () => {
    const client = {
      connect: vi.fn().mockRejectedValue(new Error('access_token=private-secret')),
      listTools: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
    };
    const error = vi.fn();
    expect(await runDiscovery({ env, createClient: () => client, log: vi.fn(), error })).toBe(1);
    expect(error.mock.calls.flat().join()).not.toContain('private-secret');
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('mantém diagnóstico seguro da troca de tokens em vez de descartar a etapa', async () => {
    const failure = diagnosticError('oauth_token_exchange', new InvalidGrantError('private-secret'), { httpStatus: 400 });
    const client = {
      connect: vi.fn().mockRejectedValue(failure), listTools: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
    };
    const error = vi.fn();
    expect(await runDiscovery({ env, createClient: () => client, log: vi.fn(), error })).toBe(1);
    const output = error.mock.calls.flat().join('\n');
    expect(output).toContain('oauth_token_exchange');
    expect(output).toContain('invalid_grant');
    expect(output).toContain('400');
    expect(output).not.toContain('private-secret');
    expect(client.listTools).not.toHaveBeenCalled();
  });
});
