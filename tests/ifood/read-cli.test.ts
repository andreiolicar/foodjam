import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runReadCheck } from '../../src/ifood/read-cli.js';

const env = {
  IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback',
};

describe('CLI opcional de leitura', () => {
  it('consulta sem imprimir resposta, argumentos ou metadados pessoais', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue({ name: 'fixture-server', version: '1' }),
      callReadTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'private-profile' }], structuredContent: { email: 'private-email' } }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const log = vi.fn();
    const error = vi.fn();
    expect(await runReadCheck({ name: 'getUser', args: { fixture: 'private-argument' }, env, log, error, createClient: () => client })).toBe(0);
    expect(client.callReadTool).toHaveBeenCalledWith('getUser', { fixture: 'private-argument' });
    expect(client.close).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join()).toContain('omitida');
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-');
  });

  it('bloqueia escrita antes de abrir conexão ou ler credenciais', async () => {
    const createClient = vi.fn();
    expect(await runReadCheck({ name: 'submitOrder', args: {}, env: {}, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('retorna falha para isError sem imprimir conteúdo', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      callReadTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'private-error' }], isError: true }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const log = vi.fn();
    const error = vi.fn();
    expect(await runReadCheck({ name: 'getUser', args: {}, env, createClient: () => client, log, error })).toBe(1);
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-error');
  });

  it('sanitiza falhas externas e sempre encerra a conexão', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined), callReadTool: vi.fn().mockRejectedValue(new Error('private-response')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const error = vi.fn();
    expect(await runReadCheck({ name: 'getUser', args: {}, env, createClient: () => client, log: vi.fn(), error })).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-response');
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('o comando rejeita JSON inválido de stdin sem ecoar a entrada', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'foodjam-read-'));
    try {
      let failure: unknown;
      try {
        execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../src/ifood/read-cli.ts', import.meta.url)), 'getUser'], {
          cwd, env: {}, input: '{private-input', encoding: 'utf8', timeout: 10_000, stdio: 'pipe',
        });
      } catch (error) { failure = error; }
      expect(failure).toMatchObject({ status: 1 });
      const output = failure as { stdout: string; stderr: string };
      expect(output.stderr).toContain('JSON');
      expect(output.stdout + output.stderr).not.toContain('private-input');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
