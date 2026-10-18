import { describe, expect, it, vi } from 'vitest';
import { catalogDocument, catalogMenuItem, catalogPage, mapMenuItem } from '../../src/ifood/catalog-data.js';
import { runCatalogReadCheck } from '../../src/ifood/catalog-check-cli.js';
import { observedEnvelope, observedItem, observedOffers } from './fixtures/catalog-observed.js';

describe('regressões das formas reais, com valores integralmente sintéticos', () => {
  it('reconhece itemDescription sem perder os valores monetários originais', () => {
    const item = catalogMenuItem(catalogDocument(observedEnvelope(observedItem)), observedItem.merchantId);
    expect(item).toMatchObject({ description: observedItem.itemDescription,
      unitPrice: observedItem.unitPrice, promotionalUnitPrice: observedItem.promotionalUnitPrice });
    expect(item.available).toBeUndefined();
  });
  it('recusa descrições conflitantes em vez de escolher silenciosamente um campo', () => {
    expect(() => catalogMenuItem({ ...observedItem, description: 'Outra descrição' }, observedItem.merchantId))
      .toThrow('invalid_data');
  });
  it('não transforma getItem bem-sucedido em prova de disponibilidade', () => {
    expect(() => mapMenuItem(observedItem, observedItem.merchantId, 'BRL')).toThrow('availability_unconfirmed');
  });
  it('aceita associação aninhada e fim observado, mas não inventa disponibilidade no browse', () => {
    const page = catalogPage(catalogDocument(observedEnvelope(observedOffers)), 'ITEM');
    expect(page.hasMore).toBe(false);
    expect(page.nextPageToken).toBeNull();
    expect(catalogMenuItem(page.results[0], observedItem.merchantId).merchantId).toBe(observedItem.merchantId);
    expect(() => mapMenuItem(page.results[0], observedItem.merchantId, 'BRL')).toThrow('availability_unconfirmed');
  });
  it('a inspeção registra disponibilidade ausente em getItem mesmo sem unidade', async () => {
    const client = { connect: vi.fn(), close: vi.fn(), listTools: vi.fn().mockResolvedValue([]),
      callReadTool: vi.fn().mockResolvedValue(observedEnvelope(observedItem)) };
    const writeReport = vi.fn();
    const status = await runCatalogReadCheck({
      input: { calls: [{ name: 'getItem', args: { itemId: observedItem.itemId, merchantId: observedItem.merchantId } }] },
      env: { IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret', IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback' },
      createClient: () => client, writeReport, log: vi.fn(), error: vi.fn(),
    });
    expect(status).toBe(0);
    expect(writeReport.mock.calls[0]?.[0].calls[0].profile).toMatchObject({
      reason: 'unit_unconfirmed', scopeVerified: true, availabilityVerified: false,
    });
  });
  it.each(['searchOffers', 'browseOffers'])('inspeciona %s ITEM e sua continuação pelo tipo solicitado', async (name) => {
    const client = { connect: vi.fn(), close: vi.fn(), listTools: vi.fn().mockResolvedValue([]),
      callReadTool: vi.fn().mockResolvedValueOnce(observedEnvelope({ ...observedOffers, hasMore: true, nextPageToken: 'fixture-next' }))
        .mockResolvedValueOnce(observedEnvelope(observedOffers)) };
    const writeReport = vi.fn();
    expect(await runCatalogReadCheck({
      input: { calls: [{ name, args: { query: 'Produto fictício', resultKind: 'ITEM',
        refinements: { merchantId: observedItem.merchantId } }, pagination: { maxPages: 2 } }] },
      env: { IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret', IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback' },
      createClient: () => client, writeReport, log: vi.fn(), error: vi.fn(),
    })).toBe(0);
    expect(client.callReadTool).toHaveBeenCalledTimes(2);
    expect(writeReport.mock.calls[0]?.[0].calls[0].profile).toMatchObject({
      reason: 'unit_unconfirmed', scopeVerified: true, availabilityVerified: false, continuation: 'pending',
    });
  });
});
