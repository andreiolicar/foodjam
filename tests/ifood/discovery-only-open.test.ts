import { expect, it, vi } from 'vitest';
import { createIfoodDiscoveryCatalog } from '../../src/ifood/discovery.js';
const address = { id: 'saved-test', formatted: 'Endereço sintético' };
const merchant = { merchantId: 'store-test', merchantName: 'Loja sintética', isOpen: true };
const item = { itemId: 'item-test', itemName: 'Prato', merchant };
const envelope = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
function setup(emptyMerchant = false) {
  const callReadTool = vi.fn(async (name: string, args: Record<string, unknown>) => envelope(name === 'listAddresses'
    ? { results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: { latitude: 0, longitude: 0 } }] }
    : name === 'getMerchant' ? merchant
      : { resultKind: args.resultKind, results: args.resultKind === 'MERCHANT' ? emptyMerchant ? [] : [merchant] : [item], hasMore: false }));
  return { callReadTool, catalog: createIfoodDiscoveryCatalog({ callReadTool }) };
}
it.each(['prato', ''])('MERCHANT aplica refinements.onlyOpen na ferramenta suportada: %j', async query => {
  const s = setup(); const found = await s.catalog.searchStores(query, address);
  expect(found[0]?.isOpen).toBe(true);
  expect(s.callReadTool).toHaveBeenCalledWith(query ? 'searchOffers' : 'browseOffers', expect.objectContaining({
    merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation: { latitude: 0, longitude: 0 }, refinements: { onlyOpen: true },
  }));
});
it('fallback ITEM e busca por desejo também filtram sem perder associação', async () => {
  const s = setup(true);
  expect((await s.catalog.searchStores('prato', address))[0]?.id).toBe(merchant.merchantId);
  expect((await s.catalog.searchItems!('prato', address))[0]?.storeId).toBe(merchant.merchantId);
  const itemCalls = s.callReadTool.mock.calls.filter(([, args]) => args.resultKind === 'ITEM');
  expect(itemCalls).toHaveLength(2);
  for (const [, args] of itemCalls) expect(args).toMatchObject({ refinements: { onlyOpen: true }, merchantType: 'RESTAURANT' });
});
it('menu de loja já identificada preserva merchantId e releitura independente getMerchant', async () => {
  const s = setup(); await s.catalog.getMenu(merchant.merchantId, address);
  expect(s.callReadTool).toHaveBeenCalledWith('browseOffers', expect.objectContaining({ refinements: { merchantId: merchant.merchantId } }));
  expect(s.callReadTool).toHaveBeenCalledWith('getMerchant', { merchantId: merchant.merchantId, userLocation: { latitude: 0, longitude: 0 } });
});
it('notifica paginação da busca quando o opt-in entrega amostra truncada', async () => {
  const s = setup(); const original = s.callReadTool.getMockImplementation()!;
  s.callReadTool.mockImplementation(async (name, args) => name === 'searchOffers'
    ? envelope({ resultKind: args.resultKind, results: [merchant], hasMore: true, nextPageToken: 'next-test-page' }) : original(name, args));
  const catalog = createIfoodDiscoveryCatalog(s, { maxPages: 1, allowTruncatedStoreSearch: true });
  const onTruncated = vi.fn();
  await catalog.searchStores('prato', address, { onTruncated });
  expect(onTruncated).toHaveBeenCalledTimes(1);
});
it('somente leituras autorizadas são usadas e isOpen ausente não é inventado', async () => {
  const s = setup(); const original = s.callReadTool.getMockImplementation()!;
  s.callReadTool.mockImplementation(async (name, args) => name === 'getMerchant' ? envelope({ merchantId: merchant.merchantId, merchantName: merchant.merchantName }) : original(name, args));
  await expect(s.catalog.getStore(merchant.merchantId, address)).rejects.toMatchObject({ reason: 'invalid_data' });
  expect(s.callReadTool.mock.calls.every(([name]) => ['listAddresses', 'getMerchant'].includes(name))).toBe(true);
});
it('mantém onlyOpen e localização em todas as páginas sem descartar o token', async () => {
  const s = setup(); const original = s.callReadTool.getMockImplementation()!;
  s.callReadTool.mockImplementation(async (name, args) => name === 'searchOffers' ? envelope({ resultKind: 'MERCHANT', results: [merchant], hasMore: !args.nextPageToken, nextPageToken: args.nextPageToken ? null : 'next-test' }) : original(name, args));
  await s.catalog.searchStores('prato', address);
  const calls = s.callReadTool.mock.calls.filter(([name]) => name === 'searchOffers');
  expect(calls).toHaveLength(2);
  for (const [, args] of calls) expect(args).toMatchObject({ merchantType: 'RESTAURANT', userLocation: { latitude: 0, longitude: 0 }, refinements: { onlyOpen: true } });
  expect(calls[1]![1].nextPageToken).toBe('next-test');
});
