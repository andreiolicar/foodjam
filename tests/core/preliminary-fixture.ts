import { vi } from 'vitest';
import type { DiscoveryCatalogPort, LlmPort, SessionStore } from '../../src/core/ports.js';
import { criarAgenteDescoberta } from '../../src/core/discovery-agent.js';

/** Somente as fronteiras externas são controladas; coleta, seleção e sessões são reais. */
export function preliminaryFixture(sessions?: SessionStore) {
  const address = { id: 'fixture-address', formatted: 'Endereço sintético' };
  const store = { id: 'fixture-store', name: 'Loja de teste', isOpen: true };
  const items = [
    { id: 'burger-a', storeId: store.id, name: 'Hambúrguer A' },
    { id: 'burger-b', storeId: store.id, name: 'Hambúrguer B' },
    { id: 'acai-a', storeId: store.id, name: 'Açaí A' },
    { id: 'acai-b', storeId: store.id, name: 'Açaí B' },
  ];
  const catalog: DiscoveryCatalogPort = {
    listSavedAddresses: async () => [address], searchStores: async () => [store],
    getStore: async () => store, getMenu: async () => ({ items, coverage: 'offers_only' }),
  };
  const generate = vi.fn<LlmPort['generate']>(async request => {
    if (request.outputName === 'coleta_lote') {
      const shape = request.outputSchema as { properties: { resultados: { items: { properties: { participantId: { enum: string[] } } } } } };
      return { resultados: shape.properties.resultados.items.properties.participantId.enum.map(participantId => ({
        participantId, kind: 'preference', wishes: ['hambúrguer'], foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null,
      })) };
    }
    const people = JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(request.prompt)![1]!) as { participantId: string; desejos: string[] }[];
    return { pessoas: people.map(p => ({ participantId: p.participantId, desejos: p.desejos.map(wish => ({
      atende: wish.includes('açaí') ? ['acai-a', 'acai-b'] : ['burger-a', 'burger-b'], substitutos: [],
    })) })) };
  });
  const iris = criarAgenteDescoberta({ catalog, llm: { generate }, ...(sessions ? { sessions } : {}) });
  function collection(kind: 'preference' | 'irrelevant' | 'question', wishes: Record<string, string[]> = {}) {
    generate.mockResolvedValueOnce({ resultados: Object.entries(wishes).map(([participantId, desire]) => ({
      participantId, kind, wishes: desire, foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null,
    })) });
  }
  return { iris, address, generate, collection };
}
