import { expect, it, vi } from 'vitest';
import type { Agente, LlmRequest } from '../../src/core/index.js';
import { criarAgenteDescoberta } from '../../src/core/discovery-agent.js';
const address = { id: 'fixture-address', formatted: 'Endereço de teste' };
const catalog = { listSavedAddresses: async () => [address], searchStores: async () => [{ id: 'fixture-store', name: 'Restaurante teste', isOpen: true }], getStore: async () => ({ id: 'fixture-store', name: 'Restaurante teste', isOpen: true }), getMenu: async () => ({ coverage: 'offers_only' as const, items: ['a', 'b'].map(id => ({ id: `fixture-${id}`, storeId: 'fixture-store', name: `Hambúrguer ${id}` })) }) };
const llm = { generate: vi.fn(async (r: LlmRequest) => r.outputName === 'coleta_lote' ? { resultados: ((r.outputSchema.properties as {resultados:{items:{properties:{participantId:{enum:string[]}}}}}).resultados.items.properties.participantId.enum).map(participantId => ({ participantId, kind: 'preference', wishes: ['hambúrguer'], foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null })) } : { pessoas: [{ participantId: (r.outputSchema.properties as {pessoas:{items:{properties:{participantId:{enum:string[]}}}}}).pessoas.items.properties.participantId.enum[0], desejos: [{ atende: ['fixture-a', 'fixture-b'], substitutos: [] }] }] }) };
async function prepared() {
  const agent = criarAgenteDescoberta({ catalog, llm });
  await agent.iniciar('fixture-group', { id: 'p1', displayName: 'Pessoa A' }); await agent.confirmarEndereco('fixture-group', 'p1', address);
  await agent.mensagens('fixture-group', ['p1', 'p2'].map(participantId => ({ participantId, text: 'Hambúrguer', displayName: participantId })));
  return agent;
}
it('cumpre a API do grammY com nomes, alternativa real, ajustes e retorno para coleta', async () => {
  const agent = await prepared(); const contract: Agente = agent;
  const first = await contract.propor('fixture-group', 'p1');
  expect(first.preliminary?.items).toHaveLength(2);
  expect(await contract.nomes('fixture-group')).toEqual({ lojas: { 'fixture-store': 'Restaurante teste' }, itens: { 'fixture-a': 'Hambúrguer a', 'fixture-b': 'Hambúrguer b' } });
  const before = llm.generate.mock.calls.length;
  const next = await contract.outraOpcao('fixture-group', 'p1');
  expect(next.outcome).toBe('switched'); expect(next.preliminary?.items).not.toEqual(first.preliminary?.items);
  expect(llm.generate.mock.calls.length).toBe(before);
  const adjusted = await contract.mensagens('fixture-group', [{ participantId: 'p2', text: 'Quero hambúrguer b' }]);
  expect(adjusted.preliminary).toBeDefined(); expect(adjusted.resultados?.some(r => r.outcome === 'adjusted')).toBe(true);
  expect((await contract.reabrirColeta('fixture-group', 'p1')).outcome).toBe('collecting');
  expect((await contract.obter('fixture-group'))?.preliminary).toBeUndefined();
});
it('revisão e orçamento desconhecido não emitem pedido autorizado e preservam o organizador', async () => {
  const agent: Agente = await prepared(); await agent.propor('fixture-group', 'p1');
  expect((await agent.fechar('fixture-group', 'p2')).outcome).toBe('not_authorized');
  const result = await agent.fechar('fixture-group', 'p1'); expect(result.outcome).toBe('commercial_pending'); expect(result.order).toBeUndefined();
  expect((await agent.responderOrcamento('fixture-group', 'p2', 'aceito')).outcome).toBe('commercial_pending');
  expect((await agent.outraOpcao('fixture-group', 'p2')).outcome).toBe('not_authorized');
  expect((await agent.cancelar('fixture-group', 'p2')).outcome).toBe('not_authorized');
  expect((await agent.cancelar('fixture-group', 'p1')).outcome).toBe('cancelled');
});
it('trocar o endereço invalida a proposta e exige nova confirmação sem perder preferências', async () => {
  const agent = await prepared(); await agent.propor('fixture-group', 'p1');
  const changed = await agent.pedirOutroEndereco('fixture-group', 'p1');
  expect(changed.session?.preliminary).toBeUndefined(); expect(changed.session?.preliminaryAlternative).toBeUndefined();
  expect(changed.session?.address?.status).toBe('pending_confirmation');
  expect(changed.session?.participants).toHaveLength(2);
  expect((await agent.propor('fixture-group', 'p1')).outcome).toBe('address_required');
  expect(changed.actions.some(a => a.type === 'send_message' && a.text.includes('Não há outro endereço salvo'))).toBe(true);
});
it('falha ao reler endereços durante troca não mantém proposta ou destino anterior confirmados', async () => {
  let unavailable = false;
  const agent = criarAgenteDescoberta({ catalog: { ...catalog, async listSavedAddresses() { if (unavailable) throw new Error('falha de leitura'); return [address]; } }, llm });
  await agent.iniciar('group-failure', { id: 'p1', displayName: 'Pessoa A' }); await agent.confirmarEndereco('group-failure', 'p1', address);
  await agent.mensagens('group-failure', [{ participantId: 'p1', text: 'hambúrguer' }]); await agent.propor('group-failure', 'p1');
  unavailable = true; await agent.pedirOutroEndereco('group-failure', 'p1');
  expect((await agent.obter('group-failure'))?.preliminary).toBeUndefined();
  expect((await agent.obter('group-failure'))?.address?.status).not.toBe('confirmed');
});
