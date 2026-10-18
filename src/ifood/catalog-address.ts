import { z } from 'zod';
import { catalogPage, IfoodCatalogError } from './catalog-data.js';

// Validação local de entrada; não é um contrato compartilhado alternativo.
const addressSchema = z.object({
  formatted: z.string().refine((value) => value.trim().length > 0),
  id: z.string().refine((value) => value.trim().length > 0).optional(),
});
const coordinates = z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
});
const savedAddressSchema = z.object({
  addressId: z.string().min(1), formattedAddress: z.string().min(1), coordinates,
});

export function catalogAddress(value: { formatted: string; id?: string }) {
  const checked = addressSchema.safeParse(value);
  if (!checked.success) throw new IfoodCatalogError('invalid_address');
  if (checked.data.id === undefined) throw new IfoodCatalogError('address_resolution_required');
  return { formatted: checked.data.formatted, id: checked.data.id };
}

/**
 * Perfil candidato de listAddresses: só resolve um endereço salvo, por ID e
 * texto exatos no MESMO registro que contém coordenadas. Não valida texto livre,
 * cobertura de entrega ou confirmação do organizador. Não escreve endereços.
 */
export function savedAddressRecords(document: unknown) {
  const fail = (): never => { throw new IfoodCatalogError('address_resolution_required'); };
  let page;
  try { page = catalogPage(document); } catch { return fail(); }
  if (page.nextPageToken || page.hasMore === true) return fail();
  const checked = z.array(savedAddressSchema).safeParse(page.results);
  if (!checked.success) return fail();
  const ids = new Set(checked.data.map((row) => row.addressId));
  if (ids.size !== checked.data.length) return fail();
  return checked.data;
}

export function savedAddressLocation(document: unknown, address: { formatted: string; id?: string }) {
  const selected = catalogAddress(address);
  const matches = savedAddressRecords(document).filter((row) => row.addressId === selected.id);
  const record = matches[0];
  if (matches.length !== 1 || !record || record.formattedAddress !== selected.formatted) {
    throw new IfoodCatalogError('address_resolution_required');
  }
  return record.coordinates;
}
