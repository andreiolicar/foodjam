import { expect, it, vi } from 'vitest';
import * as api from '../../src/ifood/index.js';
const address = { id: 'fixture-address', formatted: 'Endereço fictício' };
const merchant = { merchantId: 'fixture-store', merchantName: 'Loja fictícia', isOpen: false, deliveryMethods: [] };
const item = { itemId: 'fixture-item', itemName: 'Prato fictício', unitPrice: 12.34, promotionalUnitPrice: 12.34, merchant: { merchantId: merchant.merchantId } };
const result = (d: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
function setup(menu: unknown = { results: [item], hasMore: false, nextPageToken: null }) {
  const callReadTool = vi.fn(async (name: string, _args?: Record<string, unknown>) => { void _args; return result(name === 'listAddresses'
    ? { results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: { latitude: 0, longitude: 0 } }] }
    : name === 'getMerchant' ? merchant : name === 'searchOffers' ? { results: [merchant] } : menu); });
  return { callReadTool, catalog: api.createIfoodDiscoveryCatalog({ callReadTool }) };
}
it('descoberta real não exige unidade fictícia para listar endereços', async () => {
  expect(await setup().catalog.listSavedAddresses()).toEqual([address]);
});
it('loja sem frete e item sem unidade/estoque permanecem explicitamente incompletos', async () => {
  const { catalog } = setup();
  expect(await catalog.searchStores('prato', address)).toEqual([{ id: merchant.merchantId, name: merchant.merchantName, isOpen: false }]);
  expect(await catalog.getStore(merchant.merchantId, address)).not.toHaveProperty('deliveryFeeCents');
  const menu = await catalog.getMenu(merchant.merchantId, address);
  expect(menu.coverage).toBe('offers_only');
  expect(menu.items[0]).toEqual({ id: item.itemId, name: item.itemName, storeId: merchant.merchantId });
});
it('descoberta recusa itens de outra loja, nunca retorna oferta global como local', async () => {
  await expect(setup({ results: [{ ...item, merchant: { merchantId: 'foreign' } }] }).catalog.getMenu(merchant.merchantId, address)).rejects.toMatchObject({ reason: 'merchant_scope_mismatch' });
});
it('busca vazia utiliza browseOffers MERCHANT em vez de searchOffers inválida', async () => {
  const { catalog, callReadTool } = setup({ results: [] });
  await catalog.searchStores('', address);
  expect(callReadTool).toHaveBeenCalledWith('browseOffers', expect.objectContaining({ resultKind: 'MERCHANT', merchantType: 'RESTAURANT' }));
});
it('quando MERCHANT não encontra produto, busca ITEM e extrai a loja real da própria linha', async () => {
  const s = setup();
  s.callReadTool.mockImplementation(async (name: string, args?: Record<string, unknown>) => result(name === 'listAddresses' ? { results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: { latitude: 0, longitude: 0 } }] }
    : args?.resultKind === 'MERCHANT' ? { resultKind: 'MERCHANT', results: [] } : { resultKind: 'ITEM', results: [{ ...item, merchant }] }));
  expect((await s.catalog.searchStores('produto', address))[0]?.id).toBe(merchant.merchantId);
});
it('exploração marca truncamento explícito após três páginas sem afirmar menu completo', async () => {
  const s = setup({ resultKind: 'ITEM', results: [item], hasMore: true, nextPageToken: 'next' });
  let n = 0;
  s.callReadTool.mockImplementation(async (name: string) => result(name === 'listAddresses' ? { results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: { latitude: 0, longitude: 0 } }] }
    : name === 'getMerchant' ? merchant : { resultKind: 'ITEM', results: [{ ...item, itemId: `fixture-${n}` }], hasMore: true, nextPageToken: `page-${++n}` }));
  const menu = await s.catalog.getMenu(merchant.merchantId, address);
  expect(menu.truncated).toBe(true); expect(menu.coverage).toBe('offers_only'); expect(menu.items).toHaveLength(3);
});
it('preço ausente no MCP continua desconhecido na fase preliminar', async () => {
  const { unitPrice: _price, ...withoutPrice } = item; void _price;
  const menu = await setup({ results: [withoutPrice] }).catalog.getMenu(merchant.merchantId, address);
  expect(menu.items[0]).not.toHaveProperty('priceCents');
});
it.each([{}, { promotionalFee: 0 }])('frete ausente em método parcial continua desconhecido mesmo com unidade confirmada: %j', async deliveryMethod => {
  const s = setup(); const original = s.callReadTool.getMockImplementation()!;
  s.callReadTool.mockImplementation(async name => name === 'getMerchant' ? result({ ...merchant, deliveryMethod }) : original(name));
  const port = api.createIfoodDiscoveryCatalog({ callReadTool: s.callReadTool }, { moneyUnit: 'BRL' });
  expect(await port.getStore(merchant.merchantId, address)).not.toHaveProperty('deliveryFeeCents');
});
it('busca truncada exige opt-in da demo e mantém o padrão estrito', async () => {
  const s = setup(); const original = s.callReadTool.getMockImplementation()!;
  s.callReadTool.mockImplementation(async name => name === 'searchOffers' ? result({ resultKind: 'MERCHANT', results: [merchant], hasMore: true, nextPageToken: 'next' }) : original(name));
  await expect(api.createIfoodDiscoveryCatalog(s, { maxPages: 1 }).searchStores('prato', address)).rejects.toMatchObject({ reason: 'pagination_limit' });
  expect(await api.createIfoodDiscoveryCatalog(s, { maxPages: 1, allowTruncatedStoreSearch: true }).searchStores('prato', address)).toHaveLength(1);
});
it('perfil de preço unitário não autoriza converter frete e conserva preço base quando promoção diverge', async () => {
  const s = setup({ results: [{ ...item, promotionalUnitPrice: 9.99 }] });
  const port = api.createIfoodDiscoveryCatalog(s, { itemMoneyUnit: 'BRL' });
  const row = (await port.getMenu(merchant.merchantId, address)).items[0];
  expect(row?.basePriceCents).toBe(1234); expect(row?.priceCents).toBeUndefined();
  expect(await port.getStore(merchant.merchantId, address)).not.toHaveProperty('deliveryFeeCents');
});
it('perfil comprovado converte preço unitário igual ao promocional e busca itens pelo desejo', async () => {
  const s = setup(); const original = s.callReadTool.getMockImplementation()!;
  s.callReadTool.mockImplementation(async (name, args) => name === 'searchOffers' && args?.resultKind === 'ITEM' ? result({ results: [item], hasMore: false }) : original(name));
  const port = api.createIfoodDiscoveryCatalog(s, { itemMoneyUnit: 'BRL', pageSize: 12 });
  expect((await port.getMenu(merchant.merchantId, address)).items[0]?.priceCents).toBe(1234);
  expect((await port.searchItems!('prato', address))[0]?.id).toBe('fixture-item');
  expect(s.callReadTool).toHaveBeenCalledWith('searchOffers', expect.objectContaining({ query: 'prato', merchantType: 'RESTAURANT', resultKind: 'ITEM', pageSize: 12 }));
});
it('unidade desconhecida desabilita preço do item mesmo com configuração financeira legada', async () => {
  const s = setup();
  const row = (await api.createIfoodDiscoveryCatalog(s, { moneyUnit: 'BRL', itemMoneyUnit: 'unknown' }).getMenu(merchant.merchantId, address)).items[0];
  expect(row?.priceCents).toBeUndefined(); expect(row?.basePriceCents).toBeUndefined();
});
