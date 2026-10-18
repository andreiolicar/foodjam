import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runPaymentOrderReadCheck } from '../../src/ifood/payment-order-read-cli.js';

const env = {
  IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback',
};
const response = {
  content: [{ type: 'text', text: 'private-card-address-document-code' }],
  structuredContent: { cardTokenId: 'private-card', nextPageToken: 'private-page', consultAgainAfterSeconds: 23 },
  _meta: { audit: 'private-audit' },
};
function fixtureClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    callPaymentOrderTool: vi.fn().mockResolvedValue(response),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('IF-04: CLI manual exclusivamente de leitura', () => {
  it.each(['listPaymentMethods', 'getOrder', 'trackOrder'])('consulta %s sem revelar respostas, argumentos ou metadados', async (name) => {
    const client = fixtureClient();
    const createClient = vi.fn(() => client);
    const log = vi.fn();
    const error = vi.fn();
    const args = { privateArgument: 'private-id' };
    expect(await runPaymentOrderReadCheck({ name, args, env, log, error, createClient })).toBe(0);
    expect(client.callPaymentOrderTool).toHaveBeenCalledExactlyOnceWith(name, args);
    expect(createClient.mock.calls[0]).toEqual([expect.anything(), { onDiagnostic: expect.any(Function) }]);
    expect(client.close).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join()).toContain('omitida');
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-');
  });

  it.each(['setCartPayment', 'submitOrder', 'unknownTool', 'getUser'])('bloqueia %s antes de abrir conexão', async (name) => {
    const createClient = vi.fn();
    expect(await runPaymentOrderReadCheck({ name, args: { userConsent: true }, env: {}, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('trata isError como falha sem expor o conteúdo', async () => {
    const client = fixtureClient();
    client.callPaymentOrderTool.mockResolvedValue({ ...response, isError: true });
    const log = vi.fn();
    const error = vi.fn();
    expect(await runPaymentOrderReadCheck({ name: 'getOrder', args: {}, env, log, error, createClient: () => client })).toBe(1);
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-');
  });

  it.each(['connect', 'callPaymentOrderTool', 'close'] as const)('encerra recursos e sanitiza falha de %s', async (method) => {
    const client = fixtureClient();
    client[method].mockRejectedValue(new Error('private-error'));
    const log = vi.fn();
    const error = vi.fn();
    expect(await runPaymentOrderReadCheck({ name: 'getOrder', args: {}, env, log, error, createClient: () => client })).toBe(1);
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-');
  });

  it('cancelamento anterior impede conexão e ainda encerra o cliente', async () => {
    const client = fixtureClient();
    const abort = new AbortController();
    abort.abort();
    expect(await runPaymentOrderReadCheck({ name: 'trackOrder', args: {}, env, signal: abort.signal, log: vi.fn(), error: vi.fn(), createClient: () => client })).toBe(1);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('sanitiza falha da fábrica sem emitir seus detalhes', async () => {
    const error = vi.fn();
    expect(await runPaymentOrderReadCheck({ name: 'getOrder', args: {}, env, log: vi.fn(), error, createClient: () => { throw new Error('private-factory'); } })).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-');
  });

  it.each([
    [['getOrder'], '{private-invalid'],
    [['getOrder'], 'null'],
    [['getOrder'], '{"orderId":"private-input","extra":null'],
    [['setCartPayment'], '{}'],
    [['submitOrder'], '{"userConsent":true}'],
    [['trackOrder', '--allow-payment-configuration'], '{}'],
    [['getOrder'], ' '.repeat(1_048_577)],
  ] as [string[], string][])('comando rejeita entrada ou ferramenta proibida antes de rede', (argv, input) => {
    const cwd = mkdtempSync(join(tmpdir(), 'foodjam-payment-order-read-'));
    try {
      let caught: unknown;
      try {
        execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../src/ifood/payment-order-read-cli.ts', import.meta.url)), ...argv], {
          cwd, env: {}, input, encoding: 'utf8', timeout: 10_000, stdio: 'pipe',
        });
      } catch (failure) { caught = failure; }
      expect(caught).toMatchObject({ status: 1 });
      const output = caught as { stdout: string; stderr: string };
      expect(output.stdout + output.stderr).not.toContain('private-');
      expect(output.stderr).toContain('leitura');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
