import { expect, it, vi } from 'vitest';
import * as api from '../../src/ifood/index.js';
import { createPreparationAuthority } from '../../src/core/commercial-flow.js';
import type { PreliminaryProposal } from '../../src/core/contracts.js';
import { cartCommercialProfile } from './fixtures/cart-commercial-profile.js';
const proposal: PreliminaryProposal = { id: 'proposal', sessionId: 'session', organizerId: 'organizer', address: { id: 'address', formatted: 'Endereço fictício' }, participants: [{ id: 'organizer', displayName: 'Pessoa', preferences: {} }], items: [{ participantId: 'organizer', storeId: 'store', menuItemId: 'item', quantity: 1 }], status: 'preliminary', pending: ['commercial_validation'] };
const cart = { cartId: 'cart', merchant: { merchantId: 'store' }, items: [{ itemId: 'item', quantity: 1, unitPrice: 10 }], deliveryAddress: { addressId: 'address' }, deliveryMethod: { fee: 2 }, fees: [{ amount: 1 }], summary: { subtotalAmount: 10, deliveryFeeAmount: 2, feeTotalAmount: 1, benefitsTotalAmount: 0, voucherTotalAmount: 0, totalAmount: 13 } };
const envelope = (d: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
function setup() {
  const records = new Map<string, { cartId?: string; scope?: string }>();
  const journal = { get: vi.fn(async (key: string) => records.get(key)), reserve: vi.fn(async (key: string, scope?: string) => { if (records.has(key)) return false; records.set(key, scope ? { scope } : {}); return true; }), saveCart: vi.fn(async (key: string, cartId: string) => { records.set(key, { ...records.get(key), cartId }); }), hasUnresolved: async (scope: string) => [...records.values()].some(r => r.scope === scope && !r.cartId) };
  const authority = createPreparationAuthority(); const entry = authority.authorize(proposal, 'organizer', 'user')[0]!;
  const client = { callCartTool: vi.fn(async (name: string) => envelope(name === 'createCart' ? { cartId: 'cart' } : cart)), callReadTool: vi.fn(async (name: string) => envelope(name === 'getMerchant' ? { merchantId: 'store', merchantName: 'Loja', isOpen: true } : name === 'listAddresses' ? { results: [{ addressId: 'address', formattedAddress: 'Endereço fictício', coordinates: { latitude: 0, longitude: 0 } }] } : { itemId: 'item', merchantId: 'store', itemName: 'Prato', unitPrice: 10, optionGroups: [] })) };
  return { entry, authority, client, journal };
}
it('permissão fabricada é recusada antes de chamada remota', async () => {
  const s = setup(); const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user', moneyUnit: 'BRL' });
  await expect(port.prepare(s.entry.context, { purpose: 'prepare_cart' })).rejects.toThrow();
  expect(s.client.callCartTool).not.toHaveBeenCalled(); expect(s.client.callReadTool).not.toHaveBeenCalled();
});
it('mesma composição autorizada cria uma vez, depois consulta o mesmo carrinho', async () => {
  const s = setup(); const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user', moneyUnit: 'BRL' });
  expect((await port.prepare(s.entry.context, s.entry.permit)).amounts?.totalCents).toBe(1300);
  await port.prepare(s.entry.context, s.entry.permit);
  expect(s.client.callCartTool.mock.calls.filter(c => c[0] === 'createCart')).toHaveLength(1);
  expect(s.client.callCartTool.mock.calls.filter(c => c[0] === 'getCart')).toHaveLength(2);
});
it('falha ambígua depois do envio nunca recria automaticamente', async () => {
  const s = setup(); s.client.callCartTool.mockRejectedValue(new Error('remote-private'));
  const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user' });
  await expect(port.prepare(s.entry.context, s.entry.permit)).rejects.toThrow();
  await expect(port.prepare(s.entry.context, s.entry.permit)).rejects.toThrow();
  expect(s.client.callCartTool).toHaveBeenCalledTimes(1);
});
it('leitura de carrinho sem prova de unidade não converte os valores', async () => {
  const s = setup(); const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user' });
  const observation = await port.readKnownCart(s.entry.context, 'cart');
  expect(observation.amounts).toBeUndefined(); expect(observation.issues).toContain('unit_unconfirmed');
  expect(s.client.callCartTool).toHaveBeenCalledWith('getCart', { cartId: 'cart' });
});
it('divergência financeira e endereço não identificado bloqueiam sem reconstruir desconto', async () => {
  const s = setup(); s.client.callCartTool.mockResolvedValue(envelope({ ...cart, deliveryAddress: {}, summary: { ...cart.summary, totalAmount: 11 } }));
  const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user', moneyUnit: 'BRL' });
  const observation = await port.readKnownCart(s.entry.context, 'cart');
  expect(observation.issues).toContain('total_decomposition_mismatch');
  expect(observation.issues).toContain('address_binding_unconfirmed');
  expect(observation.amounts?.totalCents).toBe(1100);
});
it('leitura isolada captura contexto antes do await', async () => {
  const s = setup();
  let release!: (value: ReturnType<typeof envelope>) => void;
  s.client.callCartTool.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const pending = api.readIfoodCart(s.client, s.entry.context, 'cart', 'BRL');
  s.entry.context.storeId = 'foreign'; release(envelope(cart));
  expect((await pending).storeId).toBe('store');
});
it('indisponibilidade explícita no detalhe impede criação mesmo com permissão válida', async () => {
  const s = setup(); const original = s.client.callReadTool.getMockImplementation()!;
  s.client.callReadTool.mockImplementation(async name => name === 'getItem' ? envelope({ merchantId: 'store', itemId: 'item', available: false, optionGroups: [] }) : original(name));
  const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user' });
  await expect(port.prepare(s.entry.context, s.entry.permit)).rejects.toThrow();
  expect(s.client.callCartTool).not.toHaveBeenCalled();
});
it('permite zero adicionais quando todos os grupos declaram minSelections zero explicitamente', async () => {
  const s = setup(); const original = s.client.callReadTool.getMockImplementation()!;
  s.client.callReadTool.mockImplementation(async name => name === 'getItem' ? envelope({ merchantId: 'store', itemId: 'item', optionGroups: [
    { optionGroupId: 'group-a', minSelections: 0, maxSelections: 4, options: [{ optionId: 'optional-a', additionalPrice: 5 }] },
    { optionGroupId: 'group-b', minSelections: 0, maxSelections: 1, options: [{ optionId: 'optional-b', additionalPrice: 2.5 }] },
  ] }) : original(name));
  const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user', moneyUnit: 'BRL' });
  await expect(port.prepare(s.entry.context, s.entry.permit)).resolves.toHaveProperty('amounts.totalCents', 1300);
  expect(s.client.callCartTool).toHaveBeenCalledWith('createCart', { merchantId: 'store', addressId: 'address', items: [{ itemId: 'item', quantity: 1, options: [] }] });
});
it.each([{ minSelections: 1, maxSelections: 1 }, { maxSelections: 1 }, { minSelections: 0, maxSelections: -1 }])(
  'não omite opções obrigatórias ou ambíguas: %j', async constraints => {
    const s = setup(); const original = s.client.callReadTool.getMockImplementation()!;
    s.client.callReadTool.mockImplementation(async name => name === 'getItem' ? envelope({ merchantId: 'store', itemId: 'item', optionGroups: [
      { optionGroupId: 'group', options: [{ optionId: 'option' }], ...constraints },
    ] }) : original(name));
    const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user' });
    await expect(port.prepare(s.entry.context, s.entry.permit)).rejects.toThrow();
    expect(s.client.callCartTool).not.toHaveBeenCalled();
  });
it('contexto com IDs repetidos não aceita itens extras no carrinho inspecionado', async () => {
  const s = setup(); const context = structuredClone(s.entry.context);
  context.items.push({ ...context.items[0]! });
  s.client.callCartTool.mockResolvedValue(envelope({ ...cart, items: [...cart.items, { itemId: 'foreign', quantity: 1, unitPrice: 1 }] }));
  await expect(api.readIfoodCart(s.client, context, 'cart')).rejects.toThrow();
});
it('distingue ID de endereço divergente de ID ausente e nunca confirma ausência nos dois lados', async () => {
  const s = setup();
  s.client.callCartTool.mockResolvedValue(envelope({ ...cart, deliveryAddress: { addressId: 'different' } }));
  expect((await api.readIfoodCart(s.client, s.entry.context, 'cart', 'BRL')).issues).toContain('address_binding_mismatch');
  delete s.entry.context.address.id;
  s.client.callCartTool.mockResolvedValue(envelope({ ...cart, deliveryAddress: {} }));
  expect((await api.readIfoodCart(s.client, s.entry.context, 'cart', 'BRL')).issues).toContain('address_binding_unconfirmed');
});
it('perfil financeiro observado conserva cada agregado e o total sem corrigir benefício para fechar a fórmula', async () => {
  const s = setup();
  s.client.callCartTool.mockResolvedValue(envelope(cartCommercialProfile));
  const context = { ...s.entry.context, storeId: cartCommercialProfile.merchant.merchantId,
    items: cartCommercialProfile.items.map(i => ({ menuItemId: i.itemId, quantity: i.quantity })) };
  const observation = await api.readIfoodCart(s.client, context, cartCommercialProfile.cartId, 'BRL');
  expect(observation.amounts).toEqual({ subtotalCents: 10870, deliveryCents: 0, feesCents: 217,
    benefitsCents: 3990, voucherCents: 0, totalCents: 8087 });
  expect(observation.items.reduce((sum, i) => sum + i.unitPriceCents! * i.quantity, 0)).toBe(10870);
  expect(observation.issues).toEqual(['address_binding_unconfirmed', 'total_decomposition_mismatch']);
});
it('agregados relatados no ensaio preservam total remoto e pendências sem deduzir significado dos benefícios', async () => {
  const s = setup();
  // Linha hipotética apenas para isolar a aritmética dos agregados relatados;
  // não representa itens/preços do carrinho real, cujo payload não foi salvo.
  s.client.callCartTool.mockResolvedValue(envelope({ ...cart, items: [{ itemId: 'item', quantity: 1, unitPrice: 35.99 }],
    deliveryAddress: {}, deliveryMethod: { fee: 0 }, fees: [{ amount: 0.99 }], summary: {
      subtotalAmount: 35.99, deliveryFeeAmount: 0, feeTotalAmount: 0.99,
      benefitsTotalAmount: 22.98, voucherTotalAmount: 0, totalAmount: 18.99,
    } }));
  const observation = await api.readIfoodCart(s.client, s.entry.context, 'cart', 'BRL');
  expect(observation.amounts).toEqual({ subtotalCents: 3599, deliveryCents: 0, feesCents: 99, benefitsCents: 2298, voucherCents: 0, totalCents: 1899 });
  expect(observation.issues).toEqual(['address_binding_unconfirmed', 'total_decomposition_mismatch']);
  expect(s.client.callCartTool).toHaveBeenCalledExactlyOnceWith('getCart', { cartId: 'cart' });
});
it.each(['address_order', 'changed_quantity'])('reserva ambígua bloqueia recriação da mesma proposta/loja: %s', async variation => {
  const s = setup(); s.client.callCartTool.mockRejectedValue(new Error('timeout'));
  const port = api.createIfoodCommercialPreparation(s.client, { authority: s.authority, journal: s.journal, authenticatedUserId: 'user' });
  await expect(port.prepare(s.entry.context, s.entry.permit)).rejects.toThrow();
  const modified = structuredClone(proposal);
  if (variation === 'address_order') modified.address = { formatted: proposal.address.formatted, id: proposal.address.id! };
  else modified.items[0]!.quantity = 2;
  const entry = s.authority.authorize(modified, 'organizer', 'user')[0]!;
  await expect(port.prepare(entry.context, entry.permit)).rejects.toThrow();
  expect(s.client.callCartTool).toHaveBeenCalledTimes(1);
});

it('revisão usa somente getCart registrado; antes da criação não permite nenhuma mutação', async () => {
 const s=setup();const port=api.createIfoodCommercialPreparation(s.client,{authority:s.authority,journal:s.journal,authenticatedUserId:'user',moneyUnit:'BRL'});
 await expect(port.readPrepared(s.entry.context)).rejects.toThrow();expect(s.client.callCartTool).not.toHaveBeenCalled();
 await port.prepare(s.entry.context,s.entry.permit);await port.readPrepared(s.entry.context);
 expect(s.client.callCartTool.mock.calls.map(c=>c[0])).toEqual(['createCart','getCart','getCart']);
});
it('cancelar durante preflight impede escrita e reserva',async()=>{
 const s=setup();let current=true;const read=s.client.callReadTool.getMockImplementation()!;
 s.client.callReadTool.mockImplementation(async name=>{const result=await read(name);if(name==='getItem')current=false;return result;});
 const port=api.createIfoodCommercialPreparation(s.client,{authority:s.authority,journal:s.journal,authenticatedUserId:'user',isCurrent:async()=>current});
 await expect(port.prepare(s.entry.context,s.entry.permit)).rejects.toThrow();expect(s.client.callCartTool).not.toHaveBeenCalled();expect(s.journal.reserve).not.toHaveBeenCalled();
});
it('journal por sessão não permite contornar escrita incerta trocando ID de proposta após reinício',async()=>{
 const s=setup();s.client.callCartTool.mockRejectedValueOnce(new Error('timeout'));
 const options={authority:s.authority,journal:s.journal,authenticatedUserId:'user',scopeBySession:true};
 await expect(api.createIfoodCommercialPreparation(s.client,options).prepare(s.entry.context,s.entry.permit)).rejects.toThrow();
 const next=s.authority.authorize({...proposal,id:'new-id'},'organizer','user')[0]!;
 await expect(api.createIfoodCommercialPreparation(s.client,options).prepare(next.context,next.permit)).rejects.toThrow();expect(s.client.callCartTool).toHaveBeenCalledTimes(1);
});
it('nova proposta explicitamente autorizada não reutiliza carrinho antigo conhecido, mas repetição da nova lê o mesmo ID',async()=>{
 const s=setup();const port=api.createIfoodCommercialPreparation(s.client,{authority:s.authority,journal:s.journal,authenticatedUserId:'user',scopeBySession:true,moneyUnit:'BRL'});
 await port.prepare(s.entry.context,s.entry.permit);
 const next=s.authority.authorize({...proposal,id:'new-order'},'organizer','user')[0]!;await port.prepare(next.context,next.permit);await port.prepare(next.context,next.permit);
 expect(s.client.callCartTool.mock.calls.map(c=>c[0])).toEqual(['createCart','getCart','createCart','getCart','getCart']);
});
