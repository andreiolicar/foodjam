import { expect, it, vi } from 'vitest';
import { criarAgenteDescoberta } from '../../src/core/discovery-agent.js';
const address = { id: 'address', formatted: 'Endereço fictício' };
const port = { listSavedAddresses: vi.fn(async () => [address]), searchStores: vi.fn(async () => [{ id: 'store', name: 'Loja', isOpen: true }]),
  getStore: vi.fn(async () => ({ id: 'store', name: 'Loja', isOpen: true })), getMenu: vi.fn(async () => ({ coverage: 'offers_only' as const, items: [{ id: 'item', storeId: 'store', name: 'Hambúrguer' }] })) };
const llm = { generate: vi.fn(async (request: { outputName: string; outputSchema: Record<string, unknown> }) => request.outputName === 'coleta_lote'
  ? { resultados: ['a', 'b'].map(participantId => ({ participantId, kind: 'preference', wishes: ['hambúrguer'], foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null })) }
  : { pessoas: ((request.outputSchema.properties as { pessoas: { items: { properties: { participantId: { enum: string[] } } } } }).pessoas.items.properties.participantId.enum).map(participantId => ({ participantId, desejos: [{ atende: ['item'], substitutos: [] }] })) }) };
it('preserva coleta em lote, endereço confirmado e revisão preliminar sem porta cotada fake', async () => {
  const agent = criarAgenteDescoberta({ catalog: port, llm });
  expect((await agent.iniciar('group', { id: 'a', displayName: 'A' })).session?.address?.status).toBe('pending_confirmation');
  expect((await agent.confirmarEndereco('group', 'b')).outcome).toBe('not_authorized');
  await agent.confirmarEndereco('group', 'a');
  await agent.mensagens('group', [{ participantId: 'a', text: 'Hambúrguer', displayName: 'A' }, { participantId: 'b', text: 'Hambúrguer', displayName: 'B' }]);
  expect((await agent.propor('group', 'b')).outcome).toBe('not_authorized');
  const result = await agent.propor('group', 'a');
  expect(result.preliminary?.items).toHaveLength(2);
  expect(result).not.toHaveProperty('proposal');
  expect((await agent.obter('group'))?.status).toBe('collecting');
  expect(llm.generate.mock.calls.map(([r]) => r.outputName)).toEqual(['coleta_lote', 'proposta_classificacao', 'proposta_classificacao']);
});
it('loja que fecha entre busca e cardápio é informada e não recebe proposta', async () => {
  const agent = criarAgenteDescoberta({ catalog: { ...port, getStore: async () => ({ id: 'store', name: 'Loja', isOpen: false }) }, llm });
  await agent.iniciar('group', { id: 'a', displayName: 'A' }); await agent.confirmarEndereco('group', 'a');
  await agent.mensagens('group', [{ participantId: 'a', text: 'Hambúrguer' }, { participantId: 'b', text: 'Hambúrguer' }]);
  const result = await agent.propor('group', 'a');
  expect(result.outcome).toBe('store_closed'); expect(result.preliminary).toBeUndefined();
});
it('cancelamento impede confirmação tardia e nova seleção de endereço', async () => {
  const agent = criarAgenteDescoberta({ catalog: port, llm });
  await agent.iniciar('group', { id: 'a', displayName: 'A' }); await agent.cancelar('group', 'a');
  expect((await agent.confirmarEndereco('group', 'a')).outcome).toBe('no_session');
  expect((await agent.pedirOutroEndereco('group', 'a')).outcome).toBe('no_session');
});
it('confirmação é vinculada ao candidato exibido, inclusive quando uma troca já está na fila', async () => {
  const other = { id: 'other-address', formatted: 'Outro endereço fictício' };
  const agent = criarAgenteDescoberta({ catalog: { ...port, listSavedAddresses: async () => [address, other] }, llm });
  await agent.iniciar('group', { id: 'a', displayName: 'A' });
  const changing = agent.pedirOutroEndereco('group', 'a');
  const oldConfirmation = agent.confirmarEndereco('group', 'a', address);
  await changing;
  expect((await oldConfirmation).outcome).toBe('address_stale');
  expect((await agent.obter('group'))?.address?.status).toBe('pending_confirmation');
});
