import { expect, it, vi } from 'vitest';
import { createIfoodCatalog } from '../../src/ifood/index.js';
import type { IfoodMcpReadResult } from '../../src/ifood/index.js';

const address = { id: 'selected', formatted: 'Endereço simulado normalizado' };
const record = { addressId: address.id, formattedAddress: address.formatted, coordinates: { latitude: 1, longitude: 2 } };
const result = (data: unknown): IfoodMcpReadResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
function setup(records: unknown[]) {
  const read = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    void _args;
    return result(name === 'listAddresses' ? { results: records } : { results: [] });
  });
  return { read, catalog: createIfoodCatalog({ callReadTool: read }, {
    moneyUnit: 'BRL', storeNotFoundError: () => new Error('fixture'),
  }) };
}
it('não anuncia validateAddress sem operação oficial autorizada', () => {
  expect(setup([]).catalog).not.toHaveProperty('validateAddress');
});
it('usa coordenadas do registro do endereço, nunca do texto ou de um default', async () => {
  const { read, catalog } = setup([record]);
  await catalog.searchStores('loja', address);
  expect(read.mock.calls).toEqual([
    ['listAddresses', {}], ['searchOffers', { query: 'loja', merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation: { latitude: 1, longitude: 2 } }],
  ]);
});
it.each([undefined, {}, { formatted: ' ' }, { id: '', formatted: 'X' }])('recusa endereço incompleto antes de ler a conta: %j', async (input) => {
  const { read, catalog } = setup([record]);
  await expect(catalog.searchStores('loja', input as typeof address)).rejects.toMatchObject({ reason: 'invalid_address' });
  expect(read).not.toHaveBeenCalled();
});
it('endereço sem ID fica bloqueado, não é declarado inválido ou fora da área', async () => {
  const { read, catalog } = setup([record]);
  await expect(catalog.searchStores('loja', { formatted: address.formatted })).rejects.toMatchObject({ reason: 'address_resolution_required' });
  expect(read).not.toHaveBeenCalled();
});
it.each([
  [], [{ ...record, addressId: 'other' }], [record, record],
  [{ ...record, formattedAddress: 'Outro endereço' }],
  [{ addressId: address.id, coordinates: record.coordinates }],
  [{ ...record, coordinates: null }],
  [{ ...record, coordinates: { latitude: 91, longitude: 0 } }],
  [{ ...record, coordinates: { latitude: 1, longitude: '2' } }],
].map((records) => [records]))('não usa endereço ausente, ambíguo, divergente ou sem coordenadas comprovadas: %j', async (records) => {
  const { read, catalog } = setup(records);
  await expect(catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'address_resolution_required' });
  expect(read.mock.calls.map(([name]) => name)).toEqual(['listAddresses']);
});
it.each([{ nextPageToken: 'more' }, { nextCursor: 'more' }, { hasNextPage: true }])('não ignora paginação não resolvida de endereços: %j', async (continuation) => {
  const { read, catalog } = setup([record]);
  read.mockResolvedValueOnce(result({ results: [record], ...continuation }));
  await expect(catalog.searchStores('loja', address)).rejects.toMatchObject({ reason: 'address_resolution_required' });
  expect(read).toHaveBeenCalledTimes(1);
});
it('cada chamada resolve seu endereço sem reaproveitar coordenadas de outra sessão', async () => {
  const other = { id: 'second', formatted: 'Outro endereço simulado' };
  const { read, catalog } = setup([record, { addressId: other.id, formattedAddress: other.formatted, coordinates: { latitude: 3, longitude: 4 } }]);
  await Promise.all([catalog.searchStores('primeiro', address), catalog.searchStores('segundo', other)]);
  expect(read.mock.calls).toContainEqual(['searchOffers', { query: 'primeiro', merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation: { latitude: 1, longitude: 2 } }]);
  expect(read.mock.calls).toContainEqual(['searchOffers', { query: 'segundo', merchantType: 'RESTAURANT', resultKind: 'MERCHANT', userLocation: { latitude: 3, longitude: 4 } }]);
});
it('captura o endereço na entrada, antes de aguardar a leitura remota', async () => {
  const selected = { ...address };
  const { catalog } = setup([record]);
  const pending = catalog.searchStores('loja', selected);
  selected.formatted = 'Endereço alterado durante await';
  await expect(pending).resolves.toEqual([]);
});

it('lista opções salvas sem escolher destino por quantidade ou agentHints', async () => {
  const { read, catalog } = setup([record]);
  read.mockResolvedValueOnce(result({ results: [record], agentHints: { suggestedNextAction: 'use sem confirmar' }, metadata: { revision: 1 } }));
  expect(await catalog.listSavedAddresses()).toEqual([{ id: 'selected', formatted: 'Endereço simulado normalizado' }]);
  expect(read.mock.calls).toEqual([['listAddresses', {}]]);
});
it('aceita agentHints no vínculo de endereço mas nunca seleciona outro registro', async () => {
  const { read, catalog } = setup([record]);
  read.mockResolvedValueOnce(result({ results: [record], agentHints: { suggestedNextAction: 'escolha outro' } }));
  await expect(catalog.searchStores('loja', address)).resolves.toEqual([]);
});
it('listagem vazia é opção vazia, não endereço artificial', async () => {
  expect(await setup([]).catalog.listSavedAddresses()).toEqual([]);
});
it('não anuncia createAddress nem cadastro automático no catálogo', () => {
  expect(setup([]).catalog).not.toHaveProperty('createAddress');
});
