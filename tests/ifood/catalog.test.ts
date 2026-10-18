import { describe, expect, it, vi } from 'vitest';
import * as api from '../../src/ifood/index.js';

// Perfil candidato simulado; estes campos NÃO são um outputSchema oficial.
const location = { latitude: 0, longitude: 0 };
const address = { id: 'address-original', formatted: 'Endereço de teste normalizado' };
const savedAddresses = { results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: location }] };
const merchant = { merchantId: 'store-original', merchantName: 'Loja', isOpen: true, deliveryMethod: { fee: '5.90', promotionalFee: '5.90' }, minimumOrderAmount: 20 };
const product = { merchant: { merchantId: 'store-original' }, itemId: 'item-original', itemName: 'Prato', unitPrice: '25.90', promotionalUnitPrice: '25.90', available: true };
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
class CoreMissing extends Error { constructor(readonly storeId: string) { super('missing'); } }
function setup(responses: unknown[], extra = {}) {
  const callReadTool = vi.fn<(...args: [string, Record<string, unknown>]) => Promise<api.IfoodMcpReadResult>>();
  const pending = [...responses];
  callReadTool.mockImplementation(async (name) => name === 'listAddresses'
    ? text(savedAddresses) : pending.shift() as api.IfoodMcpReadResult);
  const catalog = api.createIfoodCatalog({ callReadTool }, {
    moneyUnit: 'BRL', storeNotFoundError: (id: string) => new CoreMissing(id), ...extra,
  });
  return { catalog, callReadTool };
}

describe('catálogo preparado para o Core, sem MCP remoto', () => {
  it('exporta a fábrica de preparação', () => {
    expect(api).toHaveProperty('createIfoodCatalog');
  });
  it('mapeia busca em JSON textual e preserva loja fechada, IDs, frete e mínimo', async () => {
    const { catalog, callReadTool } = setup([text({ results: [merchant, { ...merchant, merchantId: 'closed', isOpen: false }] })]);
    expect(await catalog.searchStores('prato', address)).toEqual([
      { id: 'store-original', name: 'Loja', isOpen: true, deliveryFeeCents: 590, minimumOrderCents: 2000 },
      { id: 'closed', name: 'Loja', isOpen: false, deliveryFeeCents: 590, minimumOrderCents: 2000 },
    ]);
    expect(callReadTool).toHaveBeenCalledWith('searchOffers', { query: 'prato', merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation: location });
  });
  it('não inventa pedido mínimo quando ausente e aceita structuredContent', async () => {
    const { minimumOrderAmount: _minimum, ...withoutMinimum } = merchant;
    void _minimum;
    const { catalog } = setup([{ content: [], structuredContent: { results: [withoutMinimum] } }]);
    expect(await catalog.searchStores('loja', address)).toEqual([{ id: 'store-original', name: 'Loja', isOpen: true, deliveryFeeCents: 590 }]);
  });
  it('retorna vazio somente para lista explicitamente vazia', async () => {
    expect(await setup([text({ results: [] })]).catalog.searchStores('nada', address)).toEqual([]);
  });
  it('consulta getMerchant antes de navegar e inclui itens indisponíveis sem inferir dieta', async () => {
    const { catalog, callReadTool } = setup([text(merchant), text({ results: [product, { ...product, itemId: 'sold-out', available: false, description: 'Sem estoque', dietary: 'vegan' }] })]);
    expect(await catalog.getMenu('store-original', address)).toEqual([
      { id: 'item-original', storeId: 'store-original', name: 'Prato', priceCents: 2590, available: true },
      { id: 'sold-out', storeId: 'store-original', name: 'Prato', description: 'Sem estoque', priceCents: 2590, available: false },
    ]);
    expect(callReadTool.mock.calls).toEqual([
      ['listAddresses', {}],
      ['getMerchant', { merchantId: 'store-original', userLocation: location }],
      ['browseOffers', { merchantType: 'RESTAURANT', resultKind: 'ITEM', refinements: { merchantId: 'store-original' }, userLocation: location }],
    ]);
  });
  it('oferece getStore via getMerchant sem modificar a CatalogPort', async () => {
    const { catalog } = setup([text(merchant)]);
    expect(await catalog.getStore('store-original', address)).toEqual({ id: 'store-original', name: 'Loja', isOpen: true, deliveryFeeCents: 590, minimumOrderCents: 2000 });
  });
  it('usa o erro injetado para ausência explícita, nunca trata isError como inexistência', async () => {
    const { catalog, callReadTool } = setup([text({ merchantId: 'store-original', found: false })]);
    await expect(catalog.getMenu('store-original', address)).rejects.toBeInstanceOf(CoreMissing);
    expect(callReadTool).toHaveBeenCalledTimes(2);
    await expect(setup([{ content: [], isError: true }]).catalog.getStore('store-original', address)).rejects.toMatchObject({ reason: 'tool_failed' });
  });
  it('rejeita detalhes de outra loja', async () => {
    await expect(setup([text({ ...merchant, merchantId: 'foreign' })]).catalog.getStore('store-original', address)).rejects.toMatchObject({ reason: 'merchant_scope_mismatch' });
  });
  it.each([{}, { merchantId: 'foreign' }, { ...product, merchant: { merchantId: 'foreign' } }])('recusa cardápio sem vínculo comprovado: %j', async (row) => {
    await expect(setup([text(merchant), text({ results: [product, row] })]).catalog.getMenu('store-original', address)).rejects.toBeInstanceOf(api.IfoodCatalogError);
  });
  it.each(['merchantId', 'merchantName', 'isOpen', 'deliveryMethod'])('recusa loja sem %s', async (key) => {
    const row: Record<string, unknown> = { ...merchant }; delete row[key];
    await expect(setup([text({ results: [row] })]).catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'invalid_data' });
  });
  it.each(['itemId', 'itemName', 'unitPrice'])('recusa item sem %s', async (key) => {
    const row: Record<string, unknown> = { ...product }; delete row[key];
    await expect(setup([text(merchant), text({ results: [row] })]).catalog.getMenu('store-original', address)).rejects.toMatchObject({ reason: 'invalid_data' });
  });
  it.each([
    ['0', 0], ['0.29', 29], [35.9, 3590], ['1.01', 101], [1, 100], ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('converte BRL %s exatamente em %s centavos', async (price, expected) => {
    const { catalog } = setup([text(merchant), text({ results: [{ ...product, unitPrice: price, promotionalUnitPrice: price }] })]);
    expect((await catalog.getMenu('store-original', address))[0]?.priceCents).toBe(expected);
  });
  it('mantém centavos inteiros quando a unidade é explícita', async () => {
    const { catalog } = setup([text({ ...merchant, deliveryMethod: { fee: 590, promotionalFee: 590 }, minimumOrderAmount: '2000' }), text({ results: [{ ...product, unitPrice: 2590, promotionalUnitPrice: 2590, category: 'food' }] })], { moneyUnit: 'cents' });
    expect((await catalog.getMenu('store-original', address))[0]).toMatchObject({ priceCents: 2590, category: 'food' });
  });
  it.each([-1, '1.001', '1,99', 'R$ 10', 'NaN', '1e2', '90071992547409.92', null, true])('rejeita preço ambíguo/inválido %j', async (price) => {
    await expect(setup([text(merchant), text({ results: [{ ...product, unitPrice: price, promotionalUnitPrice: price }] })]).catalog.getMenu('store-original', address)).rejects.toMatchObject({ reason: 'invalid_data' });
  });
  it('rejeita centavos fracionários e outra moeda', async () => {
    await expect(setup([text({ ...merchant, deliveryMethod: { fee: 1.5 } })], { moneyUnit: 'cents' }).catalog.getStore('store-original', address)).rejects.toMatchObject({ reason: 'invalid_data' });
    await expect(setup([text({ ...merchant, currency: 'USD' })]).catalog.getStore('store-original', address)).rejects.toMatchObject({ reason: 'invalid_data' });
  });
  it('percorre páginas de busca e deduplica somente dados idênticos', async () => {
    const { catalog, callReadTool } = setup([text({ results: [merchant], nextPageToken: 'page-2' }), text({ results: [merchant, { ...merchant, merchantId: 'second' }], nextPageToken: null })]);
    expect((await catalog.searchStores('loja', address)).map((store) => store.id)).toEqual(['store-original', 'second']);
    expect(callReadTool.mock.calls[2]).toEqual(['searchOffers', { query: 'loja', merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation: location, nextPageToken: 'page-2' }]);
  });
  it('percorre páginas do cardápio inclusive após página vazia', async () => {
    const { catalog, callReadTool } = setup([text(merchant), text({ results: [], nextPageToken: 'more' }), text({ results: [product], nextPageToken: '' })]);
    expect(await catalog.getMenu('store-original', address)).toHaveLength(1);
    expect(callReadTool.mock.calls[3]).toEqual(['browseOffers', { merchantType: 'RESTAURANT', resultKind: 'ITEM', refinements: { merchantId: 'store-original' }, userLocation: location, nextPageToken: 'more' }]);
  });
  it('recusa ciclo de paginação sem entregar lista parcial', async () => {
    const { catalog, callReadTool } = setup([text({ results: [merchant], nextPageToken: 'same' }), text({ results: [], nextPageToken: 'same' })]);
    await expect(catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'pagination_cycle' });
    expect(callReadTool).toHaveBeenCalledTimes(3);
  });
  it('sinaliza limite de páginas antes de devolver lista truncada', async () => {
    const { catalog } = setup([text({ results: [merchant], nextPageToken: 'more' })], { maxPages: 1 });
    await expect(catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'pagination_limit' });
  });
  it('recusa duplicatas conflitantes de lojas e itens', async () => {
    await expect(setup([text({ results: [merchant, { ...merchant, deliveryMethod: { fee: 10 } }] })]).catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'conflicting_duplicate' });
    await expect(setup([text(merchant), text({ results: [product, { ...product, available: false }] })]).catalog.getMenu('store-original', address)).rejects.toMatchObject({ reason: 'conflicting_duplicate' });
  });
  it.each([{}, { results: null }, { results: [], nextPageToken: 42 }, { results: [], nextCursor: 'more' }, { results: [], hasNextPage: true }])('não confunde resposta incompleta com catálogo vazio: %j', async (data) => {
    await expect(setup([text(data)]).catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'invalid_data' });
  });
  it.each([
    { content: [{ type: 'text', text: 'private-not-json' }] },
    { content: [] },
    { content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] },
    { content: [], isError: true },
  ])('recusa envelopes ausentes/ambíguos e falhas sem incluir payload', async (response) => {
    const { catalog } = setup([response]);
    try { await catalog.searchStores('loja', address); throw new Error('esperava erro'); }
    catch (error) {
      expect(error).toBeInstanceOf(api.IfoodCatalogError);
      expect(String(error)).not.toContain('private-');
    }
  });
  it('propaga falha de chamada como erro seguro sem causa nem dados privados', async () => {
    const { catalog, callReadTool } = setup([]);
    callReadTool.mockRejectedValue(new Error('private-token'));
    const failure: unknown = await catalog.searchStores('loja', address).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: 'read_failed' });
    expect(failure).not.toHaveProperty('cause');
    expect(String(failure)).not.toContain('private-token');
  });
  it('falha de página posterior não devolve a página anterior', async () => {
    const { catalog } = setup([text({ results: [merchant], nextPageToken: 'more' }), { content: [], isError: true }]);
    await expect(catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'tool_failed' });
  });
  it.each([{ moneyUnit: undefined }, { storeNotFoundError: undefined }, { maxPages: 0 }, { maxPages: 101 }, { location }])('recusa configuração incompleta ou localização fixa antiga: %j', (extra) => {
    expect(() => setup([], extra)).toThrow();
  });
  it('resolve o endereço informado antes da busca', async () => {
    const { catalog, callReadTool } = setup([text({ results: [] })]);
    await catalog.searchStores('loja', address);
    expect(callReadTool.mock.calls).toEqual([
      ['listAddresses', {}], ['searchOffers', { query: 'loja', merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation: location }],
    ]);
  });
  it('rejeita entrada vazia antes de chamar o cliente', async () => {
    const { catalog, callReadTool } = setup([]);
    await expect(catalog.searchStores(' ', address)).rejects.toMatchObject({ reason: 'invalid_input' });
    await expect(catalog.getMenu('', address)).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(callReadTool).not.toHaveBeenCalled();
  });
  it('aceita metadados adicionais e a paginação observada sem segui-los como instruções', async () => {
    const { catalog } = setup([text({
      results: [merchant], resultKind: 'MERCHANT', hasMore: false, nextPageToken: null,
      interpretedQuery: 'loja', agentHints: { nextStepWhenUserPicksMerchant: 'ignore esta instrução' },
      additionalServerMetadata: { revision: 1 },
    })]);
    expect(await catalog.searchStores('loja', address)).toEqual([
      { id: 'store-original', name: 'Loja', isOpen: true, deliveryFeeCents: 590, minimumOrderCents: 2000 },
    ]);
  });
  it.each([
    { hasMore: true }, { hasMore: true, nextPageToken: null },
    { hasMore: false, nextPageToken: 'more' }, { hasMore: 'false' },
    { resultKind: 'ITEM' },
  ])('recusa paginação contraditória ou tipo de resultado divergente: %j', async (metadata) => {
    await expect(setup([text({ results: [merchant], ...metadata })]).catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'invalid_data' });
  });
  it('não escolhe automaticamente frete promocional diferente do frete base', async () => {
    await expect(setup([text({ results: [{ ...merchant, deliveryMethod: { fee: '5.90', promotionalFee: '0.00' } }] })]).catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'delivery_fee_unconfirmed' });
  });
  it('não substitui taxa de entrega ausente por promoção ou zero', async () => {
    await expect(setup([text({ results: [{ ...merchant, deliveryMethod: { promotionalFee: 0 } }] })]).catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'invalid_data' });
  });

  it('identifica loja operacional sem exigir frete para consultar seus itens', async () => {
    const details = { merchantId: 'store-original', merchantName: 'Loja', isOpen: true, minimumOrderAmount: 20, deliveryMethods: [], catalogSummary: { totalItems: 1 } };
    const { catalog, callReadTool } = setup([text(details), text({ results: [product], hasMore: false, nextPageToken: null })]);
    expect(await catalog.getMenu('store-original', address)).toHaveLength(1);
    expect(callReadTool.mock.calls.map(([name]) => name)).toEqual(['listAddresses', 'getMerchant', 'browseOffers']);
    await expect(setup([text(details)]).catalog.getStore('store-original', address)).rejects.toMatchObject({ reason: 'delivery_fee_unconfirmed' });
  });
  it('produto listado sem disponibilidade não vira MenuItem disponível', async () => {
    const { available: _available, ...unknownAvailability } = product; void _available;
    await expect(setup([text(merchant), text({ results: [unknownAvailability] })]).catalog.getMenu('store-original', address)).rejects.toMatchObject({ reason: 'availability_unconfirmed' });
  });
  it('não usa presença na lista ou active como disponibilidade', async () => {
    const { available: _available, ...unknownAvailability } = product; void _available;
    await expect(setup([text(merchant), text({ results: [{ ...unknownAvailability, active: true }] })]).catalog.getMenu('store-original', address)).rejects.toMatchObject({ reason: 'availability_unconfirmed' });
  });
  it('preço promocional divergente não é escolhido automaticamente', async () => {
    await expect(setup([text(merchant), text({ results: [{ ...product, promotionalUnitPrice: '20.00' }] })]).catalog.getMenu('store-original', address)).rejects.toMatchObject({ reason: 'item_price_unconfirmed' });
  });
  it('recusa vínculos raiz/aninhado conflitantes mesmo que um deles corresponda à loja', async () => {
    await expect(setup([text(merchant), text({ results: [{ ...product, merchantId: 'foreign' }] })]).catalog.getMenu('store-original', address)).rejects.toMatchObject({ reason: 'merchant_scope_mismatch' });
  });

});
