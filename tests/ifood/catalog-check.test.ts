import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runCatalogReadCheck, openPrivateCatalogReport } from '../../src/ifood/catalog-check-cli.js';
import type { IfoodMcpConfig, IfoodMcpClientOptions } from '../../src/ifood/index.js';

const env = { IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret', IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback' };
const data = { results: [{ merchantId: 'private-merchant', merchantName: 'private-name', isOpen: true, deliveryMethod: { fee: '5.90' } }], nextPageToken: 'private-page' };
const response = { content: [{ type: 'text', text: JSON.stringify(data) }], _meta: { original: true } };
const input = { moneyUnit: 'BRL', calls: [{ name: 'searchOffers', args: { query: 'private-query' } }] };
function setup() {
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([{ name: 'validateAddress', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }, { name: 'submitOrder', inputSchema: { type: 'object' } }]),
    callReadTool: vi.fn().mockResolvedValue(response), close: vi.fn().mockResolvedValue(undefined),
  };
  const log = vi.fn(); const error = vi.fn(); const writeReport = vi.fn().mockResolvedValue(undefined);
  const createClient = vi.fn((_config: IfoodMcpConfig, _options: IfoodMcpClientOptions) => {
    void _config; void _options; return client;
  });
  return { client, log, error, writeReport, createClient };
}
describe('validação manual opt-in do catálogo', () => {
  it('preserva resposta e schemas no relatório privado, sem imprimir dados nem executar ferramenta nova', async () => {
    const options = setup();
    expect(await runCatalogReadCheck({ input, env, ...options })).toBe(0);
    const report = options.writeReport.mock.calls[0]?.[0];
    expect(report).toMatchObject({ homologated: false, paginationVerified: false, calls: [{ result: response, profile: { ok: true, continuation: 'pending', mapped: [{ deliveryFeeCents: 590 }] } }] });
    expect(report.calls[0].result).toEqual(response);
    expect(report.tools[0].name).toBe('validateAddress');
    expect(options.client.callReadTool.mock.calls).toEqual([['searchOffers', { query: 'private-query' }]]);
    expect(options.createClient.mock.calls[0]?.[1]).toMatchObject({ allowCartMutations: false, allowPaymentConfiguration: false });
    expect(options.client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([options.log.mock.calls, options.error.mock.calls])).not.toContain('private-');
  });
  it.each(['submitOrder', 'createAddress', 'createCart', 'setCartPayment', 'validateAddress', 'getUser'])('bloqueia %s antes de ler configuração ou conectar', async (name) => {
    const options = setup();
    expect(await runCatalogReadCheck({ input: { calls: [{ name, args: {} }] }, env: {}, ...options })).toBe(1);
    expect(options.createClient).not.toHaveBeenCalled();
  });
  it('não escolhe unidade por aparência dos valores', async () => {
    const options = setup();
    expect(await runCatalogReadCheck({ input: { calls: input.calls }, env, ...options })).toBe(0);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile).toMatchObject({ ok: false, reason: 'unit_unconfirmed', continuation: 'pending' });
  });
  it('registra perfil incompatível e resposta original quando faltam dados essenciais', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [{ merchantId: 'private-merchant' }] }) }], _meta: { original: true } });
    expect(await runCatalogReadCheck({ input, env, ...options })).toBe(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile).toMatchObject({ ok: false, reason: 'invalid_data' });
    expect(options.client.close).toHaveBeenCalledOnce();
  });
  it('recusa associação errada de merchantId em cardápio', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [{ merchant: { merchantId: 'foreign' }, itemId: 'item', itemName: 'Prato', unitPrice: '20.00', available: true }] }) }], _meta: { original: true } });
    expect(await runCatalogReadCheck({ input: { moneyUnit: 'BRL', calls: [{ name: 'browseOffers', args: { merchantType: 'RESTAURANT', resultKind: 'ITEM', refinements: { merchantId: 'selected' } } }] }, env, ...options })).toBe(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile.reason).toBe('merchant_scope_mismatch');
  });
  it('reconhece ausência explícita no perfil de getMerchant sem criar dados de loja', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ merchantId: 'selected', found: false }) }], _meta: { original: true } });
    const plan = { moneyUnit: 'BRL', calls: [{ name: 'getMerchant', args: { merchantId: 'selected' } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(0);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile).toEqual({ ok: true, storeFound: false });
  });
  it('consulta só as chamadas fornecidas, sem paginar ou selecionar endereço implicitamente', async () => {
    const options = setup();
    expect(await runCatalogReadCheck({ input, env, ...options })).toBe(0);
    expect(options.client.callReadTool).toHaveBeenCalledTimes(1);
  });
  it('salva falha de ferramenta sem expor mensagens remotas', async () => {
    const options = setup();
    options.client.callReadTool.mockRejectedValue(new Error('private-remote'));
    expect(await runCatalogReadCheck({ input, env, ...options })).toBe(1);
    expect(options.client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(options.writeReport.mock.calls)).not.toContain('private-remote');
    expect(JSON.stringify(options.error.mock.calls)).not.toContain('private-remote');
  });
  it('resposta MCP isError não vira sucesso e continua preservada no relatório', async () => {
    const options = setup();
    const failed = { content: [{ type: 'text', text: 'private-error' }], _meta: { original: true }, isError: true };
    options.client.callReadTool.mockResolvedValue(failed);
    expect(await runCatalogReadCheck({ input, env, ...options })).toBe(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0]).toMatchObject({ result: failed, profile: { ok: false, reason: 'tool_failed' } });
    expect(JSON.stringify([options.log.mock.calls, options.error.mock.calls])).not.toContain('private-error');
  });
  it('cancelamento anterior não abre cliente', async () => {
    const options = setup(); const abort = new AbortController(); abort.abort();
    expect(await runCatalogReadCheck({ input, env, signal: abort.signal, ...options })).toBe(1);
    expect(options.createClient).not.toHaveBeenCalled();
  });
  it('falhas de gravação/encerramento impedem saída de sucesso', async () => {
    const options = setup();
    options.writeReport.mockRejectedValue(new Error('private-path'));
    expect(await runCatalogReadCheck({ input, env, ...options })).toBe(1);
    expect(JSON.stringify(options.error.mock.calls)).not.toContain('private-path');
    const closing = setup(); closing.client.close.mockRejectedValue(new Error('private-close'));
    expect(await runCatalogReadCheck({ input, env, ...closing })).toBe(1);
    expect(JSON.stringify(closing.error.mock.calls)).not.toContain('private-close');
  });
  it('relatório requer diretório privado fora do repo, modo 600 e não sobrescreve', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'foodjam-private-'));
    const path = join(directory, 'report.json');
    try {
      await expect(openPrivateCatalogReport(join(process.cwd(), 'tmp', 'report.json'))).rejects.toThrow();
      const file = await openPrivateCatalogReport(path);
      try { await file.writeFile('{"private":true}'); } finally { await file.close(); }
      expect(statSync(path).mode & 0o777).toBe(0o600);
      await expect(openPrivateCatalogReport(path)).rejects.toThrow();
      expect(readFileSync(path, 'utf8')).toBe('{"private":true}');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('recusa diretório público e symlink de diretório para dentro do repo', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'foodjam-path-'));
    try {
      symlinkSync(process.cwd(), join(directory, 'repository'), 'dir');
      await expect(openPrivateCatalogReport(join(directory, 'repository', 'private-report.json'))).rejects.toThrow();
      chmodSync(directory, 0o755);
      await expect(openPrivateCatalogReport(join(directory, 'report.json'))).rejects.toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('CLI rejeita plano inválido sem executar OAuth nem ecoar entrada', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'foodjam-check-'));
    try {
      let failure: unknown;
      try {
        execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../src/ifood/catalog-check-cli.ts', import.meta.url)), '--report', join(cwd, 'report.json')], {
          cwd, env: {}, input: '{private-input', encoding: 'utf8', timeout: 10_000, stdio: 'pipe',
        });
      } catch (caught) { failure = caught; }
      expect(failure).toMatchObject({ status: 1 });
      const output = failure as { stdout: string; stderr: string };
      expect(output.stdout + output.stderr).not.toContain('private-input');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
  it('verifica escopo do cardápio antes de reconhecer que a unidade é desconhecida', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [{ merchantId: 'foreign', itemId: 'item' }], hasMore: false, nextPageToken: null }) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'browseOffers', args: { merchantType: 'RESTAURANT', resultKind: 'ITEM', refinements: { merchantId: 'selected' } } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile.reason).toBe('merchant_scope_mismatch');
  });
  it('permite getItem de leitura e compara IDs antes da unidade, sem converter resposta', async () => {
    const options = setup();
    const item = { merchantId: 'selected', itemId: 'real-from-fixture', name: 'fixture-product', price: '35.90', active: true };
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(item) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'getItem', args: { merchantId: 'selected', itemId: 'real-from-fixture' } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(0);
    expect(options.client.callReadTool.mock.calls).toEqual([['getItem', plan.calls[0]!.args]]);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile).toMatchObject({ ok: false, reason: 'unit_unconfirmed', scopeVerified: true });
  });
  it('getItem não aceita resposta de outro produto do mesmo estabelecimento', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ merchantId: 'selected', itemId: 'other' }) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'getItem', args: { merchantId: 'selected', itemId: 'asked' } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile.reason).toBe('item_scope_mismatch');
  });
  it('metadados de continuação inconsistente não são escondidos por unidade desconhecida', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [], hasMore: true, nextPageToken: null }) }], _meta: { original: true } });
    expect(await runCatalogReadCheck({ input: { calls: input.calls }, env, ...options })).toBe(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile.reason).toBe('invalid_data');
  });

  it('reconhece vínculo aninhado real sem inventar disponibilidade ou unidade', async () => {
    const options = setup();
    const item = { itemId: 'item', itemName: 'Prato', unitPrice: 25.90, promotionalUnitPrice: 25.90, merchant: { merchantId: 'selected' } };
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [item], hasMore: false, nextPageToken: null, resultKind: 'ITEM' }) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'browseOffers', args: { merchantType: 'RESTAURANT', resultKind: 'ITEM', refinements: { merchantId: 'selected' } } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(0);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile).toMatchObject({ reason: 'unit_unconfirmed', scopeVerified: true, availabilityVerified: false });
  });

  it('lista vazia não comprova disponibilidade de produto', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [], hasMore: false, nextPageToken: null }) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'browseOffers', args: { refinements: { merchantId: 'selected' } } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(0);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile.availabilityVerified).toBe(false);
  });
  it('paginação opt-in usa só cursores devolvidos e conserva filtros/destino', async () => {
    const options = setup();
    const item = { merchant: { merchantId: 'selected' }, itemId: 'item', itemName: 'Prato', unitPrice: 20 };
    const first = { content: [{ type: 'text', text: JSON.stringify({ results: [item], hasMore: true, nextPageToken: 'real-fixture-next' }) }], _meta: { original: true } };
    const last = { content: [{ type: 'text', text: JSON.stringify({ results: [item], hasMore: false, nextPageToken: null }) }], _meta: { original: true } };
    options.client.callReadTool.mockResolvedValueOnce(first).mockResolvedValueOnce(last);
    const args = { merchantType: 'RESTAURANT', resultKind: 'ITEM', userLocation: { latitude: 0, longitude: 0 }, refinements: { merchantId: 'selected' } };
    const plan = { calls: [{ name: 'browseOffers', args, pagination: { maxPages: 3 } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(0);
    expect(options.client.callReadTool.mock.calls).toEqual([['browseOffers', args], ['browseOffers', { ...args, nextPageToken: 'real-fixture-next' }]]);
    expect(options.writeReport.mock.calls[0]?.[0].calls.map((call: { result: unknown }) => call.result)).toEqual([first, last]);
    expect(options.writeReport.mock.calls[0]?.[0].paginationVerified).toBe(false);
  });
  it('cursor repetido interrompe paginação opt-in e impede sucesso parcial', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [], hasMore: true, nextPageToken: 'same' }) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'browseOffers', args: { refinements: { merchantId: 'selected' } }, pagination: { maxPages: 5 } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(1);
    expect(options.client.callReadTool).toHaveBeenCalledTimes(2);
    expect(options.writeReport.mock.calls[0]?.[0].calls[1].paginationFailure).toBe('pagination_cycle');
  });
  it('limite com continuação real impede saída zero e não consulta outra página', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [], hasMore: true, nextPageToken: 'more' }) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'browseOffers', args: { refinements: { merchantId: 'selected' } }, pagination: { maxPages: 1 } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(1);
    expect(options.client.callReadTool).toHaveBeenCalledTimes(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].paginationFailure).toBe('pagination_limit');
  });
  it('escopo errado interrompe paginação mesmo com cursor disponível', async () => {
    const options = setup();
    options.client.callReadTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [{ merchant: { merchantId: 'foreign' }, itemId: 'item' }], hasMore: true, nextPageToken: 'more' }) }], _meta: { original: true } });
    const plan = { calls: [{ name: 'browseOffers', args: { refinements: { merchantId: 'selected' } }, pagination: { maxPages: 3 } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(1);
    expect(options.client.callReadTool).toHaveBeenCalledTimes(1);
    expect(options.writeReport.mock.calls[0]?.[0].calls[0].profile.reason).toBe('merchant_scope_mismatch');
  });
  it.each([0, 6, 1.5])('limite de páginas inválido %s é recusado antes da conexão', async (maxPages) => {
    const options = setup();
    expect(await runCatalogReadCheck({ input: { calls: [{ name: 'browseOffers', args: {}, pagination: { maxPages } }] }, env, ...options })).toBe(1);
    expect(options.createClient).not.toHaveBeenCalled();
  });
  it('paginação em getItem é recusada em vez de criar repetição', async () => {
    const options = setup();
    expect(await runCatalogReadCheck({ input: { calls: [{ name: 'getItem', args: {}, pagination: { maxPages: 2 } }] }, env, ...options })).toBe(1);
    expect(options.createClient).not.toHaveBeenCalled();
  });

  it.each([undefined, 'BRL'])('paginação recusa mesmo produto com preços conflitantes entre páginas, unidade %s', async (moneyUnit) => {
    const options = setup();
    const firstItem = { itemId: 'item', itemName: 'Prato', unitPrice: 20, available: true, merchant: { merchantId: 'selected' } };
    options.client.callReadTool.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ results: [firstItem], hasMore: true, nextPageToken: 'more' }) }], _meta: { original: true } })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ results: [{ ...firstItem, unitPrice: 30 }], hasMore: true, nextPageToken: 'another' }) }], _meta: { original: true } });
    const plan = { ...(moneyUnit === undefined ? {} : { moneyUnit }), calls: [{ name: 'browseOffers', args: { refinements: { merchantId: 'selected' } }, pagination: { maxPages: 3 } }] };
    expect(await runCatalogReadCheck({ input: plan, env, ...options })).toBe(1);
    expect(options.client.callReadTool).toHaveBeenCalledTimes(2);
    expect(options.writeReport.mock.calls[0]?.[0].calls[1].paginationFailure).toBe('conflicting_duplicate');
  });

});
