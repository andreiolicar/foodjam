import { expect, it, vi } from 'vitest';
import { createIfoodDiscoveryCatalog } from '../../src/ifood/discovery.js';
const address = { id: 'a', formatted: 'Teste' };
const image = 'https://static.ifood-static.com.br/image.jpg?signature=keep%2Bthis';
const merchant = { merchantId: 's', merchantName: 'Loja', isOpen: true };
function setup(extra: Record<string, unknown> = {}, storeExtra: Record<string, unknown> = {}) {
  const read = vi.fn(async (name: string, args: Record<string, unknown>) => ({ content: [], structuredContent: name === 'listAddresses'
    ? { results: [{ addressId: 'a', formattedAddress: 'Teste', coordinates: { latitude: 0, longitude: 0 } }] }
    : name === 'getMerchant' ? { ...merchant, ...storeExtra }
      : args.resultKind === 'MERCHANT' ? { results: [{ ...merchant, ...storeExtra }] }
        : { results: [{ itemId: 'i', itemName: 'Produto', merchant, ...extra }] } }));
  return { read, catalog: createIfoodDiscoveryCatalog({ callReadTool: read }) };
}
it.each(['search', 'browse'])('propaga foto HTTPS assinada de %s sem getItem', async mode => {
  const { catalog, read } = setup({ itemImageUrl: image });
  const items = mode === 'search' ? await catalog.searchItems!('produto', address) : (await catalog.getMenu('s', address)).items;
  expect(items[0]).toHaveProperty('itemImageUrl', image);
  expect(read.mock.calls.some(([name]) => name === 'getItem')).toBe(false);
});
it.each([undefined, null, 123, '', 'broken', 'http://static.ifood-static.com.br/a', 'https://user:pass@static.ifood-static.com.br/a', 'https://@static.ifood-static.com.br/a', 'https://:@static.ifood-static.com.br/a', 'https:static.ifood-static.com.br/a', 'https:////static.ifood-static.com.br/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://169.254.169.254/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://192.168.1.1/a', 'https://static.ifood-static.com.br.evil.test/a', 'https://evil.test/a', 'https://static.ifood-static.com.br:8443/a'])('omite imagem insegura/ausente sem invalidar item: %s', async itemImageUrl => {
  const { catalog } = setup({ itemImageUrl });
  expect((await catalog.getMenu('s', address)).items[0]).toEqual({ id: 'i', storeId: 's', name: 'Produto' });
});
it.each(['search', 'get'])('propaga avaliação do estabelecimento em %s', async mode => {
  const { catalog } = setup({}, { reviewRating: 4.7000001, ratingCount: 850 });
  const store = mode === 'get' ? await catalog.getStore('s', address) : (await catalog.searchStores('produto', address))[0];
  expect(store).toMatchObject({ reviewRating: 4.7000001, ratingCount: 850 });
});
it.each([[-1, -1], [6, 1.5], [NaN, Infinity], ['4.7', '850'], [null, null], [Infinity, Number.MAX_SAFE_INTEGER + 1]])('omite avaliação malformada %s e contagem %s', async (reviewRating, ratingCount) => {
  const { catalog } = setup({}, { reviewRating, ratingCount });
  expect(await catalog.getStore('s', address)).toEqual({ id: 's', name: 'Loja', isOpen: true });
});
it.each([0, 5])('preserva limite válido da avaliação: %s', async reviewRating => {
  expect(await setup({}, { reviewRating, ratingCount: 0 }).catalog.getStore('s', address)).toMatchObject({ reviewRating, ratingCount: 0 });
});
it('duplicatas variando apenas metadados não invalidam a descoberta, mas preço divergente sim', async () => {
  const s = setup(); const original = s.read.getMockImplementation()!;
  let conflict = false;
  s.read.mockImplementation(async (name, args) => name === 'searchOffers' ? { content: [], structuredContent: { results: [
    { itemId: 'i', itemName: 'Produto', merchant, itemImageUrl: image, unitPrice: 10 },
    { itemId: 'i', itemName: 'Produto', merchant, itemImageUrl: 'https://static.ifood-static.com.br/other.jpg', unitPrice: conflict ? 11 : 10 },
  ] } } : original(name, args));
  const catalog = createIfoodDiscoveryCatalog({ callReadTool: s.read }, { itemMoneyUnit: 'BRL' });
  expect(await catalog.searchItems!('produto', address)).toHaveLength(1);
  conflict = true;
  await expect(catalog.searchItems!('produto', address)).rejects.toMatchObject({ reason: 'conflicting_duplicate' });
});
it('extrai avaliação de merchant aninhado em ITEM e deduplica lojas com avaliações opcionais diferentes', async () => {
  const s = setup(); const original = s.read.getMockImplementation()!;
  s.read.mockImplementation(async (name, args) => name === 'searchOffers'
    ? { content: [], structuredContent: { results: args.resultKind === 'MERCHANT' ? [] : [
      { itemId: 'i1', itemName: 'Um', merchant: { ...merchant, reviewRating: 4.7, ratingCount: 850 } },
      { itemId: 'i2', itemName: 'Dois', merchant: { ...merchant, reviewRating: 4.8, ratingCount: 851 } },
    ] } } : original(name, args));
  expect(await s.catalog.searchStores('produto', address)).toEqual([{ id: 's', name: 'Loja', isOpen: true, reviewRating: 4.8, ratingCount: 851 }]);
});
it.each([{}, { promotionalFee: 0 }, { fee: 0 }])('avaliação não é perdida por caminho de frete parcial/comprovado: %j', async deliveryMethod => {
  const s = setup({}, { reviewRating: 4.7, ratingCount: 850, deliveryMethod });
  const catalog = createIfoodDiscoveryCatalog({ callReadTool: s.read }, { moneyUnit: 'BRL' });
  expect(await catalog.getStore('s', address)).toMatchObject({ reviewRating: 4.7, ratingCount: 850 });
});
it('contagem inválida não apaga nota válida e nota inválida não fabrica avaliação', async () => {
  expect(await setup({}, { reviewRating: 4.7, ratingCount: -1 }).catalog.getStore('s', address)).toEqual({ id: 's', name: 'Loja', isOpen: true, reviewRating: 4.7 });
  expect(await setup({}, { reviewRating: 8, ratingCount: 850 }).catalog.getStore('s', address)).toEqual({ id: 's', name: 'Loja', isOpen: true, ratingCount: 850 });
});
it('foto não relaxa escopo nem validação de IDs do produto', async () => {
  await expect(setup({ itemImageUrl: image, merchantId: 'foreign' }).catalog.getMenu('s', address)).rejects.toMatchObject({ reason: 'merchant_scope_mismatch' });
  await expect(setup({ itemImageUrl: image, itemId: '' }).catalog.getMenu('s', address)).rejects.toMatchObject({ reason: 'invalid_data' });
});
