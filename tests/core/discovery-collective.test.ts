import { expect, it, vi } from 'vitest';
import type { DiscoveryCatalogPort, Participant } from '../../src/core/index.js';
import { criarSessao } from '../../src/core/sessao.js';
import { proporDescoberta } from '../../src/core/discovery-flow.js';
const address = { id: 'saved-fixture', formatted: 'Endereço de teste' };
const people: Participant[] = [
  { id: 'p1', displayName: 'Pessoa A', preferences: { wishes: ['hambúrguer'] } },
  { id: 'p2', displayName: 'Pessoa B', preferences: { wishes: ['açaí'] } },
];
const session = { ...criarSessao({ id: 'group', organizerId: 'p1', participants: people }), address: { status: 'confirmed' as const, confirmed: address } };
function catalog(shared = false) {
  const searches: string[] = [];
  const port: DiscoveryCatalogPort = {
    listSavedAddresses: async () => [address],
    searchStores: async q => { searches.push(q); return [{ id: shared ? 'both' : q === 'açaí' ? 'acai' : 'burger', name: 'Loja teste', isOpen: true }]; },
    getStore: async id => ({ id, name: 'Loja teste', isOpen: true }),
    getMenu: async id => ({ coverage: 'offers_only', items: (id === 'both' ? ['hambúrguer', 'açaí'] : id === 'acai' ? ['açaí'] : ['hambúrguer']).map(name => ({ id: `${id}-${name}`, storeId: id, name })) }),
  };
  return { port, searches };
}
it('busca desejos distintos e propõe duas lojas quando isso amplia participantes atendidos', async () => {
  const c = catalog(); const r = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(c.searches).toEqual(['hambúrguer', 'açaí']);
  expect(new Set(r.proposal?.items.map(i => i.storeId)).size).toBe(2);
  expect(r.proposal?.items.map(i => i.participantId)).toEqual(['p1', 'p2']);
});
it('uma loja que atende os dois desejos vence duas lojas equivalentes', async () => {
  const c = catalog(true); const r = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(r.proposal?.items).toHaveLength(2); expect(new Set(r.proposal?.items.map(i => i.storeId)).size).toBe(1);
});
it('prioriza participantes distintos antes da quantidade de itens para uma pessoa', async () => {
  const participants = [{ ...people[0]!, preferences: { wishes: ['hambúrguer', 'batata', 'bolo'] } }, people[1]!];
  const c = catalog();
  c.port.searchStores = async q => [{ id: q === 'açaí' ? 'acai' : q === 'hambúrguer' ? 'burger' : 'extras', name: 'Loja teste', isOpen: true }];
  c.port.getMenu = async id => ({ coverage: 'offers_only', items: (id === 'extras' ? ['batata', 'bolo'] : id === 'acai' ? ['açaí'] : ['hambúrguer']).map(name => ({ id: `${id}-${name}`, storeId: id, name })) });
  const r = await proporDescoberta({ ...session, participants }, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(new Set(r.proposal?.items.map(i => i.participantId)).size).toBe(2);
  expect(new Set(r.proposal?.items.map(i => i.storeId)).size).toBeLessThanOrEqual(2);
});
it('não esgota as lojas candidatas com resultados do primeiro desejo; deduplica a pesquisa', async () => {
  const c = catalog(); c.port.searchStores = async q => Array.from({ length: 6 }, (_, i) => ({ id: q === 'açaí' ? `acai-${i}` : `burger-${i}`, name: 'Loja teste', isOpen: true }));
  c.port.getMenu = async id => ({ coverage: 'offers_only', items: [{ id: `item-${id}`, storeId: id, name: id.startsWith('acai') ? 'açaí' : 'hambúrguer' }] });
  const r = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(new Set(r.proposal?.items.map(i => i.participantId)).size).toBe(2);
});
it('limites de consulta ficam explícitos e não são interpretados como catálogo inexistente', async () => {
  const c = catalog(); const r = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal', limits: { maxRequests: 2 } });
  expect(r.coverage?.limited).toBe(true); expect(r.coverage?.requests).toBeLessThanOrEqual(2);
});
it('falha do servidor não vira resultado vazio e associação incorreta interrompe', async () => {
  const c = catalog(); c.port.searchStores = vi.fn(async () => { throw new Error('falha de transporte'); });
  await expect(proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' })).rejects.toThrow();
});
it('MCP retorna o mesmo produto em busca e menu sem duplicar itens; bloqueia loja divergente', async () => {
  const c = catalog(true);
  c.port.searchItems = async () => [{ id: 'both-hambúrguer', storeId: 'both', name: 'hambúrguer' }];
  const r = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(r.items.filter(i => i.id === 'both-hambúrguer')).toHaveLength(1);
  c.port.getMenu = async () => ({ coverage: 'offers_only', items: [{ id: 'foreign', storeId: 'outro', name: 'hambúrguer' }] });
  await expect(proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' })).rejects.toThrow('Produto fora');
});
it('limite de tempo impede iniciar outra consulta sem ocultar falhas de rede', async () => {
  const clock = vi.spyOn(Date, 'now'); clock.mockReturnValueOnce(0).mockReturnValue(100);
  try {
    const c = catalog(); const r = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal', limits: { deadlineMs: 10 } });
    expect(c.searches).toHaveLength(0); expect(r.coverage?.limited).toBe(true);
  } finally { clock.mockRestore(); }
});
it('loja que fecha ao reler o menu não usa sementes antigas de searchOffers', async () => {
  const c = catalog(true);
  c.port.searchItems = async () => [{ id: 'seed', storeId: 'both', name: 'hambúrguer' }];
  c.port.getMenu = async () => ({ storeOpen: false, coverage: 'offers_only', items: [{ id: 'seed', storeId: 'both', name: 'hambúrguer' }] });
  const result = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(result.proposal).toBeUndefined(); expect(result.reason).toBe('store_closed');
});
it('outra opção preserva cobertura coletiva; uma alternativa que abandona alguém não é oferecida', async () => {
  const c = catalog(); const r = await proporDescoberta(session, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(r.proposal?.items).toHaveLength(2); expect(r.alternatives).toEqual([]);
});
it('restrição explícita bloqueia produto incompatível antes da classificação', async () => {
  const c = catalog(true); c.port.getMenu = async () => ({ coverage: 'offers_only', items: [{ id: 'milk', storeId: 'both', name: 'Açaí com leite', description: 'Contém leite condensado' }] });
  const restricted = { ...session, participants: [{ ...people[1]!, preferences: { wishes: ['açaí'], dietaryRestrictions: ['sem lactose'] } }] };
  const r = await proporDescoberta(restricted, { port: c.port, address, proposalId: 'p', mode: 'literal' });
  expect(r.proposal).toBeUndefined();
});
it('classificação tem janela por pessoa e prioriza produtos encontrados para o desejo dela', async () => {
  const c = catalog(true);
  const rows = Array.from({ length: 24 }, (_, i) => ({ id: `item-${i}`, storeId: 'both', name: i === 23 ? 'açaí' : `hambúrguer ${i}` }));
  c.port.searchItems = async q => q === 'açaí' ? [rows[23]!] : rows.slice(0, 12);
  c.port.getMenu = async () => ({ coverage: 'offers_only', items: rows });
  const sizes: number[] = [];
  const model = { async generate(request: { prompt: string }) {
    const people = JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(request.prompt)![1]!);
    sizes.push(people[0].itensPermitidos.length);
    expect(people[0].itensPermitidos.length).toBeLessThanOrEqual(8);
    if (people[0].participantId === 'p2') expect(people[0].itensPermitidos).toContain('item-23');
    return { pessoas: [{ participantId: people[0].participantId, desejos: [{ atende: [people[0].participantId === 'p2' ? 'item-23' : 'item-0'], substitutos: [] }] }] };
  } };
  const r = await proporDescoberta(session, { port: c.port, llm: model, address, proposalId: 'p' });
  expect(sizes).toEqual([8, 8]); expect(r.proposal?.items).toHaveLength(2); expect(r.items.length).toBeGreaterThan(8);
});
