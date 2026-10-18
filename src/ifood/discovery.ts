import type { DiscoveryCatalogPort } from '../core/ports.js';
import type { DiscoveryItem, DiscoveryStore } from '../core/contracts.js';
import type { IfoodMcpClient } from './client.js';
import { catalogAddress, savedAddressLocation, savedAddressRecords } from './catalog-address.js';
import { addCatalogRecord, catalogDocument, catalogInput, catalogDiscoveryItem, catalogMerchantIdentity, catalogPage, IfoodCatalogError, mapMerchant, catalogMoneyCents } from './catalog-data.js';

/** Porta preliminar. Não configura unidade financeira por padrão. */
export function createIfoodDiscoveryCatalog(client: Pick<IfoodMcpClient, 'callReadTool'>,
  options: { moneyUnit?: 'BRL' | 'cents'; itemMoneyUnit?: 'BRL' | 'cents' | 'unknown'; maxPages?: number; pageSize?: number; allowTruncatedStoreSearch?: boolean } = {}): DiscoveryCatalogPort {
  const unit = options.moneyUnit;
  const maxPages = options.maxPages ?? 3;
  const itemUnit = options.itemMoneyUnit === 'unknown' ? undefined : options.itemMoneyUnit ?? unit;
  if (itemUnit !== undefined && itemUnit !== 'BRL' && itemUnit !== 'cents' || options.pageSize !== undefined && (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 50)) throw new IfoodCatalogError('invalid_config');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 3 || unit !== undefined && unit !== 'BRL' && unit !== 'cents') throw new IfoodCatalogError('invalid_config');
  async function read(name: string, args: Record<string, unknown>) {
    try { return catalogDocument(await client.callReadTool(name, args)); }
    catch (e) { if (e instanceof IfoodCatalogError) throw e; throw new IfoodCatalogError('read_failed'); }
  }
  async function location(address: { formatted: string; id?: string }) {
    const selected = catalogAddress(address);
    return savedAddressLocation(await read('listAddresses', {}), selected);
  }
  function store(value: unknown): DiscoveryStore {
    const row = catalogMerchantIdentity(value);
    const result: DiscoveryStore = { id: row.merchantId, name: row.merchantName, isOpen: row.isOpen };
    if (unit && value && typeof value === 'object' && 'deliveryMethod' in value) {
      const method = value.deliveryMethod;
      if (method && typeof method === 'object' && !('fee' in method)) return result;
      try { return mapMerchant(value, unit); }
      catch (e) { if (!(e instanceof IfoodCatalogError) || e.reason !== 'delivery_fee_unconfirmed') throw e; }
    }
    return result;
  }
  function item(value: unknown, storeId: string): DiscoveryItem {
    const row = catalogDiscoveryItem(value, storeId);
    const base = itemUnit && row.unitPrice !== undefined ? catalogMoneyCents(row.unitPrice, itemUnit) : undefined;
    const pricesEqual = row.promotionalUnitPrice === undefined || itemUnit && catalogMoneyCents(row.promotionalUnitPrice, itemUnit) === base;
    return { id: row.itemId, storeId: row.merchantId, name: row.itemName,
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.category === undefined ? {} : { category: row.category }),
      ...(row.available === undefined ? {} : { available: row.available }),
      ...(base === undefined ? {} : pricesEqual ? { priceCents: base } : { basePriceCents: base }),
    };
  }
  async function pages<T extends { id: string }>(name: string, args: Record<string, unknown>, kind: 'MERCHANT' | 'ITEM', map: (value: unknown) => T, allowTruncation = false) {
    const rows = new Map<string, T>(); const tokens = new Set<string>();
    let nextPageToken: string | undefined;
    for (let n = 0; n < maxPages; n++) {
      const page = catalogPage(await read(name, { ...args, ...(options.pageSize ? { pageSize: options.pageSize } : {}), ...(nextPageToken ? { nextPageToken } : {}) }), kind);
      for (const value of page.results) addCatalogRecord(rows, map(value));
      if (!page.nextPageToken) return { rows: [...rows.values()], truncated: false };
      if (tokens.has(page.nextPageToken)) throw new IfoodCatalogError('pagination_cycle');
      tokens.add(page.nextPageToken); nextPageToken = page.nextPageToken;
    }
    if (allowTruncation) return { rows: [...rows.values()], truncated: true };
    throw new IfoodCatalogError('pagination_limit');
  }
  async function merchant(storeId: string, userLocation: { latitude: number; longitude: number }) {
    const value = await read('getMerchant', { merchantId: storeId, userLocation });
    if (catalogMerchantIdentity(value).merchantId !== storeId) throw new IfoodCatalogError('merchant_scope_mismatch');
    return value;
  }
  return {
    async listSavedAddresses() {
      return savedAddressRecords(await read('listAddresses', {})).map(row => ({ id: row.addressId, formatted: row.formattedAddress }));
    },
    async searchStores(query, address) {
      if (typeof query !== 'string') throw new IfoodCatalogError('invalid_input');
      const userLocation = await location(address);
      const args = { merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation };
      const stores = await pages(query.trim() ? 'searchOffers' : 'browseOffers', { ...args, ...(query.trim() ? { query } : {}) }, 'MERCHANT', store, options.allowTruncatedStoreSearch === true);
      if (stores.rows.length || !query.trim()) return stores.rows;
      // Uma busca de produto pode não encontrar MERCHANT. Cada linha ITEM
      // fornece a própria loja, sem atribuir ofertas globais a outra loja.
      const offers = await pages('searchOffers', { ...args, resultKind: 'ITEM', query }, 'ITEM', value => {
        if (!value || typeof value !== 'object' || !('merchant' in value)) throw new IfoodCatalogError('invalid_data');
        const actual = store(value.merchant);
        catalogDiscoveryItem(value, actual.id);
        return actual;
      }, options.allowTruncatedStoreSearch === true);
      return offers.rows;
    },
    async searchItems(query, address) {
      catalogInput(query);
      const offers = await pages('searchOffers', { merchantType: 'RESTAURANT', resultKind: 'ITEM', query, userLocation: await location(address) }, 'ITEM', value => {
        if (!value || typeof value !== 'object') throw new IfoodCatalogError('invalid_data');
        const row = value as { merchantId?: unknown; merchant?: { merchantId?: unknown } };
        const owner = row.merchant?.merchantId ?? row.merchantId;
        if (typeof owner !== 'string') throw new IfoodCatalogError('invalid_data');
        return item(value, owner);
      }, true);
      return offers.rows;
    },
    async getStore(storeId, address) {
      catalogInput(storeId);
      return store(await merchant(storeId, await location(address)));
    },
    async getMenu(storeId, address) {
      catalogInput(storeId);
      const userLocation = await location(address);
      const current = catalogMerchantIdentity(await merchant(storeId, userLocation));
      const items = await pages('browseOffers', { merchantType: 'RESTAURANT', resultKind: 'ITEM', userLocation,
        refinements: { merchantId: storeId } }, 'ITEM', value => item(value, storeId), true);
      return { items: items.rows, coverage: 'offers_only', truncated: items.truncated, storeOpen: current.isOpen };
    },
  };
}
