import { expect, it } from 'vitest';
import { buscarDescoberta } from '../../src/core/discovery-search.js';
import type { DiscoveryCatalogPort, DiscoveryStore } from '../../src/core/index.js';
const image = 'https://static.ifood-static.com.br/controlled.jpg';
const address = { formatted: 'Teste' };
const participants = [{ id: 'p', displayName: 'Pessoa', preferences: { wishes: ['prato'] } }];
function catalog(current: DiscoveryStore): DiscoveryCatalogPort {
  const item = { id: 'i', storeId: 's', name: 'Prato' };
  return {
    listSavedAddresses: async () => [],
    searchStores: async () => [{ id: 's', name: 'Loja', isOpen: true, reviewRating: 3.5, ratingCount: 25 }],
    searchItems: async () => [{ ...item, itemImageUrl: image }],
    getStore: async () => current,
    getMenu: async () => ({ coverage: 'offers_only', items: [item] }),
  };
}
it('releitura sem foto preserva foto de searchOffers sem alterar seleção', async () => {
  const found = await buscarDescoberta(catalog({ id: 's', name: 'Loja', isOpen: true }), participants, address);
  expect(found.items).toEqual([{ id: 'i', storeId: 's', name: 'Prato', itemImageUrl: image }]);
});
it('avaliação de getMerchant prevalece sobre listagem sem misturar contagem antiga', async () => {
  const found = await buscarDescoberta(catalog({ id: 's', name: 'Loja', isOpen: true, reviewRating: 4.7 }), participants, address);
  expect(found.stores[0]).toMatchObject({ reviewRating: 4.7 }); expect(found.stores[0]).not.toHaveProperty('ratingCount');
});
it('avaliação válida da listagem continua informativa quando releitura não tem avaliação', async () => {
  const found = await buscarDescoberta(catalog({ id: 's', name: 'Loja', isOpen: true }), participants, address);
  expect(found.stores[0]).toMatchObject({ reviewRating: 3.5, ratingCount: 25 });
});
