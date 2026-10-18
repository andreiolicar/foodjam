import { expect, it } from 'vitest';
import type { DiscoveryItem, Participant } from '../../src/core/contracts.js';
import type { DiscoveryCatalogPort, LlmPort } from '../../src/core/ports.js';
import { criarSessao } from '../../src/core/sessao.js';
import { proporDescoberta } from '../../src/core/discovery-flow.js';
import { textoPropostaPreliminar, textosItensPropostaPreliminar } from '../../src/telegram/services/card.js';

const address = { id: 'semantic-address', formatted: 'Endereço sintético' };
const product = (id: string, name: string, storeId = 's1'): DiscoveryItem => ({ id, storeId, name, priceCents: 850 });
const people: Participant[] = ['misto quente', 'cappuccino', 'croissant'].map((wish, index) => ({
  id: `p${index + 1}`, displayName: `Pessoa ${index + 1}`, preferences: { wishes: [wish] },
}));
type Classification = { atende: string[]; substitutos: string[] };
async function recommend(items: DiscoveryItem[], participants = people,
  classify: (id: string, wish: number) => Classification = () => ({ atende: items.map(i => i.id), substitutos: [] })) {
  const stores = [...new Set(items.map(i => i.storeId))].map(id => ({ id, name: `Loja ${id}`, isOpen: true }));
  const port: DiscoveryCatalogPort = {
    listSavedAddresses: async () => [address], searchStores: async () => stores,
    getStore: async id => stores.find(s => s.id === id)!,
    getMenu: async id => ({ coverage: 'offers_only', items: items.filter(i => i.storeId === id) }),
  };
  const llm: LlmPort = { generate: async request => {
    const persons = JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(request.prompt)![1]!) as { participantId: string; desejos: string[] }[];
    return { pessoas: persons.map(p => ({ participantId: p.participantId, desejos: p.desejos.map((_, n) => classify(p.participantId, n)) })) };
  } };
  const session = { ...criarSessao({ id: 'semantic-group', organizerId: participants[0]!.id, participants }), address: { status: 'confirmed' as const, confirmed: address } };
  return proporDescoberta(session, { port, llm, address, proposalId: 'semantic-proposal' });
}
const person = (wish: string): Participant[] => [{ id: 'p1', displayName: 'Pessoa', preferences: { wishes: [wish] } }];

it.each(['atende', 'substitutos'] as const)('A/D: classificação maliciosa em %s não transforma água ou misto em cobertura 3/3', async field => {
  const result = await recommend([product('misto', 'Misto quente'), product('agua', 'Água mineral')], people,
    id => id === 'p1' ? { atende: ['misto'], substitutos: [] } : { atende: [], substitutos: [], [field]: [id === 'p2' ? 'agua' : 'misto'] });
  expect(result.proposal?.items).toEqual([{ participantId: 'p1', storeId: 's1', menuItemId: 'misto', quantity: 1 }]);
  expect(result.proposal?.participants).toHaveLength(3);
  expect(result.alternatives).toEqual([]);
  const summary = textoPropostaPreliminar({ proposal: result.proposal! });
  expect(summary).toContain('1 de 3 pessoas com item');
  expect(summary).toContain('Pessoa 2: sem item compatível nesta amostra');
  expect(summary).toContain('Pessoa 3: sem item compatível nesta amostra');
  expect(summary).toContain('Do pedido: 1; com alternativa compatível: 0; sem item adequado: 2.');
  expect(summary).not.toMatch(/R\$|subtotal|total financeiro/i);
  expect(summary).toContain('Nenhum carrinho, pagamento ou compra foi autorizado');
});

it('B: três produtos reais permanecem associados aos três pedidos, mesmo com IDs incompatíveis classificados primeiro', async () => {
  const items = [product('agua', 'Água mineral'), product('misto', 'Misto quente'), product('cappuccino', 'Cappuccino'), product('croissant', 'Croissant de manteiga', 's2')];
  const result = await recommend(items);
  expect(result.proposal?.items).toEqual([
    { participantId: 'p1', storeId: 's1', menuItemId: 'misto', quantity: 1 },
    { participantId: 'p2', storeId: 's1', menuItemId: 'cappuccino', quantity: 1 },
    { participantId: 'p3', storeId: 's2', menuItemId: 'croissant', quantity: 1 },
  ]);
  expect(textoPropostaPreliminar({ proposal: result.proposal! })).toContain('3 de 3 pessoas com item');
  expect(result.proposal?.pending).toContain('commercial_validation');
  expect(result.proposal).not.toHaveProperty('split');
  expect(result.items).toEqual(expect.arrayContaining(items));
  expect(result.items).toHaveLength(4);
});

it.each(['Misto quente', 'Cappuccino', 'Croissant de manteiga', 'Pão de queijo', 'Tapioca de queijo', 'Suco de laranja'])('C: pedido amplo de café da manhã permite %s', async name => {
  const result = await recommend([product('breakfast', name)], person('quero algo para o café da manhã'));
  expect(result.proposal?.items[0]?.menuItemId).toBe('breakfast');
});

it.each([
  ['cappuccino', 'Cappuccino'], ['cappuccino', 'Capuccino'], ['capuccino', 'Cappuccino'],
  ['croissant', 'Croissant de queijo'], ['misto quente', 'Misto quente'],
  ['hambúrguer', 'Hamburger artesanal'], ['hamburger', 'Hambúrguer'],
  ['refri', 'Refrigerante lata'], ['aipim', 'Mandioca frita'],
  ['pão francês', 'Pão de sal'], ['suco de laranja', 'Suco de laranja natural'],
  ['falafel', 'Falafel assado'], ['bolinhos de arroz', 'Bolinho de arroz'],
])('correspondência e sinônimos: %s aceita %s com evidência no nome', async (wish, name) => {
  const result = await recommend([product('real', name)], person(wish));
  expect(result.proposal?.items[0]?.menuItemId).toBe('real');
});

it.each(['atende', 'substitutos'] as const)('D: %s não ultrapassa a validação independente de pedidos específicos', async field => {
  const pairs = [
    ['cappuccino', 'Água mineral'], ['croissant', 'Misto quente'],
    ['pizza de calabresa', 'Pizza de queijo'], ['bolo de chocolate', 'Bolo de cenoura'],
    ['pão de queijo', 'Pão de alho com queijo'], ['cappuccino', 'Bolo de cappuccino'],
    ['croissant', 'Coxinha de frango'], ['misto quente', 'Misto frio'],
    ['suco de laranja', 'Suco de uva'], ['hambúrguer', 'Água mineral'],
    ['café da manhã com croissant', 'Misto quente'], ['cappuccino sem leite', 'Cappuccino com leite sem lactose'],
  ];
  for (const [wish, name] of pairs) {
    const result = await recommend([product('bad', name!)], person(wish!), () => ({ atende: [], substitutos: [], [field]: ['bad'] }));
    expect(result.proposal, `${wish} não deve receber ${name} via ${field}`).toBeUndefined();
    expect(result.reason).toBe('no_candidates');
  }
});

it('descrição, categoria comercial, loja e preço não provam identidade de um produto específico', async () => {
  for (const item of [
    { ...product('bad', 'Água mineral'), description: 'Para acompanhar seu cappuccino', category: 'drink' as const },
    { ...product('bad', 'Bebidas'), description: 'Cappuccino, suco, água', category: 'drink' as const },
    { ...product('bad', 'Produto especial'), description: 'Croissant', category: 'food' as const },
  ]) {
    const result = await recommend([item], person(item.category === 'drink' ? 'cappuccino' : 'croissant'));
    expect(result.proposal).toBeUndefined();
  }
});

it('pedido amplo não torna cerveja pertinente ao café da manhã apenas por classificação da IA', async () => {
  const result = await recommend([product('beer', 'Cerveja')], person('algo para o café da manhã'));
  expect(result.proposal).toBeUndefined();
});

it.each([
  ['quero algo para comer', 'Falafel'], ['qualquer comida', 'Hambúrguer'],
  ['quero um lanche', 'Sanduíche de queijo'], ['algo para o almoço', 'Arroz com feijão'],
  ['quero uma bebida', 'Cappuccino'],
])('pedidos amplos preservam flexibilidade pertinente: %s → %s', async (wish, name) => {
  const result = await recommend([product('real', name)], person(wish));
  expect(result.proposal?.items[0]?.menuItemId).toBe('real');
});

it.each([
  ['café', 'Café da manhã completo'], ['cappuccino', 'Cappuccino em pó'],
  ['café', 'Café em cápsulas'], ['pizza 4 queijos', 'Pizza 3 queijos'],
  ['pão de queijo', 'Pão com queijo'], ['suco natural', 'Suco artificial'],
  ['hambúrguer artesanal', 'Hambúrguer industrializado'],
  ['algo para o café da manhã', 'Café em pó'], ['algo para comer', 'Sachê de ketchup'],
  ['algo para comer', 'Taxa de entrega'], ['algo para comer', 'Sabonete'],
  ['café', 'Café moído 500g'], ['café', 'Café solúvel'],
  ['algo para o café da manhã', 'Café em grãos'],
])('mesmo início de nome não dispensa qualificadores de identidade: %s × %s', async (wish, name) => {
  const result = await recommend([product('bad', name)], person(wish));
  expect(result.proposal).toBeUndefined();
});

it.each([
  ['cappuccino em pó', 'Cappuccino em pó'], ['suco natural', 'Suco natural de laranja'],
  ['hambúrguer artesanal', 'Hambúrguer artesanal'],
])('qualificador explícito é aceito somente quando demonstrado: %s → %s', async (wish, name) => {
  const result = await recommend([product('real', name)], person(wish));
  expect(result.proposal?.items[0]?.menuItemId).toBe('real');
});

it('restrições alimentares continuam prevalecendo sobre correspondência semântica e IA', async () => {
  const participants = [{ ...person('cappuccino')[0]!, preferences: { wishes: ['cappuccino'], dietaryRestrictions: ['sem lactose'] } }];
  const result = await recommend([{ ...product('milk', 'Cappuccino'), description: 'Contém leite integral' }], participants);
  expect(result.proposal).toBeUndefined();
});

it('substituto justificável mantém indicação de alternativa e cobertura separada do pedido atendido', async () => {
  const result = await recommend([product('alias', 'Hamburger artesanal')], person('hambúrguer'), () => ({ atende: [], substitutos: ['alias'] }));
  expect(result.proposal?.items[0]?.isSubstitute).toBe(true);
  const summary = textoPropostaPreliminar({ proposal: result.proposal! });
  expect(summary).toContain('Do pedido: 0; com alternativa compatível: 1; sem item adequado: 0.');
  expect(textosItensPropostaPreliminar({ proposal: result.proposal!, items: result.items, stores: result.stores })[0]?.texto).toContain('sugestão parecida');
});

it('outra opção só contém produtos com identidade compatível e preserva o limite de duas lojas', async () => {
  const result = await recommend([product('water', 'Água mineral'), product('misto', 'Misto quente'), product('misto2', 'Misto quente tradicional', 's2'), product('cappuccino', 'Cappuccino'), product('cappuccino2', 'Capuccino tradicional', 's2'), product('croissant', 'Croissant'), product('croissant2', 'Croissant de manteiga', 's2')]);
  expect(result.alternatives?.length).toBeGreaterThan(0);
  for (const proposal of [result.proposal!, ...result.alternatives!]) {
    expect(new Set(proposal.items.map(i => i.storeId)).size).toBeLessThanOrEqual(2);
    expect(proposal.items.map(i => i.participantId)).toEqual(['p1', 'p2', 'p3']);
    for (const item of proposal.items) expect(item.menuItemId).toMatch(item.participantId === 'p1' ? /^misto/ : item.participantId === 'p2' ? /^cappuccino/ : /^croissant/);
  }
});
