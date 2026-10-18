import { expect, it, vi } from 'vitest';
import type { DiscoveryCatalogPort, DiscoveryStore, Participant } from '../../src/core/index.js';
import { buscarDescoberta } from '../../src/core/discovery-search.js';
import { proporDescoberta } from '../../src/core/discovery-flow.js';
import { criarSessao } from '../../src/core/sessao.js';

const address = { id: 'saved-test', formatted: 'Endereço sintético' };
const participants: Participant[] = [
  { id: 'p1', displayName: 'Pessoa A', preferences: { wishes: ['hambúrguer'] } },
  { id: 'p2', displayName: 'Pessoa B', preferences: { wishes: ['açaí'] } },
];
const store = (id: string, isOpen = true): DiscoveryStore => ({ id, name: 'Loja sintética', isOpen });
function catalog(): DiscoveryCatalogPort {
  return {
    listSavedAddresses: async () => [address],
    searchStores: async q => [store(q)],
    searchItems: async q => [{ id: `seed-${q}`, storeId: `unknown-${q}`, name: q }],
    getStore: async id => store(id, !id.startsWith('unknown-')),
    getMenu: async id => ({ storeOpen: true, coverage: 'complete', items: [{ id: `item-${id}`, storeId: id, name: id }] }),
  };
}
it('prioriza lojas comprovadamente abertas por desejo antes das lojas ITEM não verificadas', async () => {
  const port = catalog(); const get = vi.spyOn(port, 'getStore');
  const found = await buscarDescoberta(port, participants, address, { maxStores: 2 });
  expect(found.stores.map(s => s.id)).toEqual(['hambúrguer', 'açaí']);
  expect(get.mock.calls.map(([id]) => id)).toEqual(['hambúrguer', 'açaí']);
  expect(found.items.every(i => found.stores.some(s => s.id === i.storeId))).toBe(true);
});
it('candidato ITEM que fecha não consome vaga de outra loja aberta ainda não verificada', async () => {
  const port = catalog(); port.searchStores = async () => [];
  port.searchItems = async () => ['unknown-first', 'open-later'].map(storeId => ({ id: `seed-${storeId}`, storeId, name: 'hambúrguer' }));
  const found = await buscarDescoberta(port, participants.slice(0, 1), address, { maxStores: 1 });
  expect(found.stores.map(s => s.id)).toEqual(['open-later']);
  expect(found.coverage).toMatchObject({ closedStores: 1, checkedStores: 2 });
});
it('estado desconhecido de ITEM não é convertido em aberto e a releitura do menu prevalece', async () => {
  const port = catalog(); port.searchStores = async () => [];
  port.getStore = async id => store(id);
  port.getMenu = async () => ({ storeOpen: false, coverage: 'offers_only', items: [] });
  const session = { ...criarSessao({ id: 's', organizerId: 'p1', participants }), address: { status: 'confirmed' as const, confirmed: address } };
  const found = await proporDescoberta(session, { port, address, proposalId: 'p', mode: 'literal' });
  expect(found.proposal).toBeUndefined(); expect(found.reason).toBe('store_closed');
});
it('resultado fechado do servidor é rejeitado sem ler seu menu', async () => {
  const port = catalog(); port.searchStores = async () => [store('closed', false)]; port.searchItems = async () => [];
  const get = vi.spyOn(port, 'getStore'); const menu = vi.spyOn(port, 'getMenu');
  const found = await buscarDescoberta(port, participants, address);
  expect(found.stores).toEqual([]); expect(found.items).toEqual([]);
  expect(get).not.toHaveBeenCalled(); expect(menu).not.toHaveBeenCalled();
});
it('catálogo parcial não implica limite de chamadas nem de tempo', async () => {
  const port = catalog(); port.searchItems = async () => [];
  port.getMenu = async id => ({ coverage: 'offers_only', items: [{ id, storeId: id, name: id }] });
  const { coverage } = await buscarDescoberta(port, participants, address);
  expect(coverage).toMatchObject({ limited: true, reasons: ['catalog_partial'] });
});
it('paginação truncada da busca é propagada separadamente da amostra parcial do menu', async () => {
  const port = catalog(); port.searchItems = async () => [];
  port.searchStores = async (q, _address, options) => { options?.onTruncated?.(); return [store(q)]; };
  const { coverage } = await buscarDescoberta(port, participants, address);
  expect(coverage).toMatchObject({ limited: true, reasons: ['pagination_truncated'] });
});
it('limite de termos mantém distribuição entre participantes e motivo específico', async () => {
  const port = catalog(); port.searchItems = async () => [];
  const people = participants.map(p => ({ ...p, preferences: { wishes: [...p.preferences.wishes!, 'batata', 'bolo'] } }));
  const queries = vi.spyOn(port, 'searchStores');
  const { coverage } = await buscarDescoberta(port, people, address, { maxSearchTerms: 2 });
  expect(queries.mock.calls.map(([q]) => q)).toEqual(['hambúrguer', 'açaí']);
  expect(coverage).toMatchObject({ reasons: ['term_limit'] });
});
it('limite de lojas representa abertas omitidas, não candidatos fechados rejeitados', async () => {
  const port = catalog(); port.searchItems = async () => [];
  const { coverage } = await buscarDescoberta(port, participants, address, { maxStores: 1 });
  expect(coverage).toMatchObject({ reasons: ['store_limit'], stores: 1 });
});
it('limite de chamadas impede novas leituras e não é descrito como timeout', async () => {
  const { coverage } = await buscarDescoberta(catalog(), participants, address, { maxRequests: 2 });
  expect(coverage).toMatchObject({ requests: 2, reasons: ['request_limit'] });
});
it('tempo esgotado antes da consulta não é descrito como limite de chamadas', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(100);
  try {
    const { coverage } = await buscarDescoberta(catalog(), participants, address, { deadlineMs: 10 });
    expect(coverage).toMatchObject({ requests: 0, reasons: ['time_limit'] });
  } finally { clock.mockRestore(); }
});
it('itens de outra loja continuam bloqueados na seleção reordenada', async () => {
  const port = catalog(); port.getMenu = async () => ({ coverage: 'complete', items: [{ id: 'foreign-item', storeId: 'foreign-store', name: 'Prato' }] });
  await expect(buscarDescoberta(port, participants, address)).rejects.toThrow('Produto fora do estabelecimento');
});
it('nenhum candidato resulta em resposta controlada sem proposta ou classificação', async () => {
  const port = catalog(); port.searchStores = async () => []; port.searchItems = async () => [];
  const generate = vi.fn(async () => { throw new Error('classificação não esperada'); });
  const session = { ...criarSessao({ id: 's', organizerId: 'p1', participants }), address: { status: 'confirmed' as const, confirmed: address } };
  const found = await proporDescoberta(session, { port, address, proposalId: 'p', llm: { generate } });
  expect(found.reason).toBe('no_candidates'); expect(found.proposal).toBeUndefined(); expect(generate).not.toHaveBeenCalled();
});
it('loja encontrada só por ITEM para outro desejo não é excluída por várias abertas do primeiro desejo', async () => {
  const port = catalog();
  port.searchStores = async q => q === 'hambúrguer' ? [store('burger-1'), store('burger-2'), store('burger-3')] : [];
  port.searchItems = async q => q === 'açaí' ? [{ id: 'acai-item', storeId: 'acai-item-owner', name: 'açaí' }] : [];
  port.getStore = async id => store(id);
  const found = await buscarDescoberta(port, participants, address, { maxStores: 2 });
  expect(found.stores.map(s => s.id)).toEqual(['burger-1', 'acai-item-owner']);
});
it('reposição de candidatos rejeitados continua respeitando o limite de chamadas', async () => {
  const port = catalog(); port.searchStores = async () => [];
  port.searchItems = async () => Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}`, storeId: `unknown-${i}`, name: 'Prato' }));
  const get = vi.spyOn(port, 'getStore');
  const found = await buscarDescoberta(port, participants.slice(0, 1), address, { maxRequests: 4, maxStores: 1 });
  expect(found.stores).toEqual([]); expect(get).toHaveBeenCalledTimes(2);
  expect(found.coverage).toMatchObject({ requests: 4, closedStores: 2, reasons: ['request_limit'] });
});
it('loja anunciada aberta mas fechada no getStore é rejeitada e outra ocupa a vaga', async () => {
  const port = catalog(); port.searchStores = async () => [store('stale-open'), store('still-open')]; port.searchItems = async () => [];
  port.getStore = async id => store(id, id !== 'stale-open');
  const menu = vi.spyOn(port, 'getMenu');
  const found = await buscarDescoberta(port, participants.slice(0, 1), address, { maxStores: 1 });
  expect(found.stores.map(s => s.id)).toEqual(['still-open']);
  expect(menu.mock.calls.map(([id]) => id)).toEqual(['still-open']);
  expect(found.coverage).toMatchObject({ closedStores: 1, checkedStores: 2, reasons: [] });
});
it('truncamento do menu é informado sem sugerir limite de tempo/chamadas', async () => {
  const port = catalog(); port.searchItems = async () => [];
  port.getMenu = async id => ({ coverage: 'offers_only', truncated: true, items: [{ id, storeId: id, name: id }] });
  const { coverage } = await buscarDescoberta(port, participants, address);
  expect(coverage.reasons).toEqual(['catalog_partial', 'pagination_truncated']);
});
it('reposição de ITEMs fechados não entrega as duas vagas ao outro desejo', async () => {
  const port = catalog(); port.searchStores = async () => [];
  port.searchItems = async q => (q === 'hambúrguer' ? ['unknown-1', 'unknown-2', 'burger-open'] : ['acai-open-1', 'acai-open-2'])
    .map(storeId => ({ id: `seed-${storeId}`, storeId, name: q }));
  const get = vi.spyOn(port, 'getStore');
  const found = await buscarDescoberta(port, participants, address, { maxStores: 2, maxRequests: 16 });
  expect(new Set(found.stores.map(s => s.id))).toEqual(new Set(['burger-open', 'acai-open-1']));
  expect(get.mock.calls.map(([id]) => id)).not.toContain('acai-open-2');
  expect(found.coverage.requests).toBeLessThanOrEqual(16);
});
