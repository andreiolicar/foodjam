import { z } from 'zod';
import type { IfoodMcpClient } from './client.js';
import { catalogAddress, savedAddressLocation, savedAddressRecords } from './catalog-address.js';
import {
  addCatalogRecord, catalogMerchantIdentity, catalogDocument, catalogInput, catalogPage, IfoodCatalogError,
  mapMenuItem, mapMerchant, merchantMissing,
} from './catalog-data.js';

export interface IfoodCatalogOptions {
  /** Unidade dos campos financeiros do perfil, confirmada pelo integrador. */
  moneyUnit: 'BRL' | 'cents';
  /** Na composição com Core: id => new StoreNotFoundError(id). */
  storeNotFoundError: (storeId: string) => Error;
  /** 1–100. Ao atingir o limite com mais páginas, rejeita em vez de truncar. */
  maxPages?: number;
}

const optionsSchema = z.object({
  storeNotFoundError: z.custom<(storeId: string) => Error>((value) => typeof value === 'function'),
  moneyUnit: z.enum(['BRL', 'cents']), maxPages: z.number().int().min(1).max(100).default(20),
}).strict();

/**
 * Dois métodos de leitura da CatalogPort atual, sem validateAddress/quoteOrder.
 * Perfil ainda não homologado: conferir CATALOG.md. Não abre/fecha o cliente.
 */
export function createIfoodCatalog(client: Pick<IfoodMcpClient, 'callReadTool'>, options: IfoodCatalogOptions) {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success) throw new IfoodCatalogError('invalid_config');
  const { moneyUnit, maxPages } = parsed.data;
  const missingError = parsed.data.storeNotFoundError;

  const read = async (name: 'listAddresses' | 'searchOffers' | 'browseOffers' | 'getMerchant', args: Record<string, unknown>) => {
    let result;
    try { result = await client.callReadTool(name, args); }
    catch { throw new IfoodCatalogError('read_failed'); }
    return catalogDocument(result);
  };

  async function pages<T extends { id: string }>(
    tool: 'searchOffers' | 'browseOffers', args: Record<string, unknown>, location: { latitude: number; longitude: number }, map: (row: unknown) => T,
  ): Promise<T[]> {
    const rows = new Map<string, T>();
    const seen = new Set<string>();
    let nextPageToken: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const response = catalogPage(await read(tool, {
        ...args, userLocation: { ...location }, ...(nextPageToken === undefined ? {} : { nextPageToken }),
      }), tool === 'searchOffers' ? 'MERCHANT' : 'ITEM');
      for (const row of response.results) addCatalogRecord(rows, map(row));
      if (!response.nextPageToken) return [...rows.values()];
      if (seen.has(response.nextPageToken)) throw new IfoodCatalogError('pagination_cycle');
      seen.add(response.nextPageToken);
      nextPageToken = response.nextPageToken;
    }
    throw new IfoodCatalogError('pagination_limit');
  }

  async function resolveAddress(address: { formatted: string; id?: string }) {
    const selected = catalogAddress(address); // snapshot antes do await
    return savedAddressLocation(await read('listAddresses', {}), selected);
  }

  async function readMerchant(storeId: string, location: { latitude: number; longitude: number }) {
    const response = await read('getMerchant', { merchantId: storeId, userLocation: { ...location } });
    if (merchantMissing(response, storeId)) throw missingError(storeId);
    const identity = catalogMerchantIdentity(response);
    if (identity.merchantId !== storeId) throw new IfoodCatalogError('merchant_scope_mismatch');
    return response;
  }

  async function getStoreAt(storeId: string, location: { latitude: number; longitude: number }) {
    const response = await readMerchant(storeId, location);
    // getMerchant observado tem deliveryMethods vazio; não preencher frete
    // nem escolher método da lista sem estrutura/semântica comprovada.
    if (!response || typeof response !== 'object' || !('deliveryMethod' in response)) throw new IfoodCatalogError('delivery_fee_unconfirmed');
    return mapMerchant(response, moneyUnit);
  }

  return {
    /** Opções da conta; listar não confirma nem escolhe destino. */
    async listSavedAddresses() {
      return savedAddressRecords(await read('listAddresses', {}))
        .map((row) => ({ id: row.addressId, formatted: row.formattedAddress }));
    },
    async searchStores(query: string, address: { formatted: string; id?: string }) {
      catalogInput(query);
      const location = await resolveAddress(address);
      return pages('searchOffers', { query, merchantType: 'RESTAURANT', resultKind: 'MERCHANT' }, location, (row) => mapMerchant(row, moneyUnit));
    },
    async getMenu(storeId: string, address: { formatted: string; id?: string }) {
      catalogInput(storeId);
      const location = await resolveAddress(address);
      // Não confundir uma página vazia de ofertas com estabelecimento inexistente.
      await readMerchant(storeId, location);
      return pages('browseOffers', { merchantType: 'RESTAURANT', resultKind: 'ITEM', refinements: { merchantId: storeId } }, location, (row) => mapMenuItem(row, storeId, moneyUnit));
    },
    // Extensão somente do adaptador; não altera a porta compartilhada.
    async getStore(storeId: string, address: { formatted: string; id?: string }) {
      catalogInput(storeId);
      return getStoreAt(storeId, await resolveAddress(address));
    },
  };
}
