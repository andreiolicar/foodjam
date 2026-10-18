import { expect, it, vi } from 'vitest';
import { createIfoodDiscoveryCatalog, createIfoodCommercialPreparation } from '../../src/ifood/index.js';
import { createPreparationAuthority, reviewCommercial } from '../../src/core/commercial-flow.js';
import { runIntegrationRead } from '../../scripts/integracao-ifood.js';
const address = { id: 'fixture-address', formatted: 'Endereço fictício' };
const envelope = (d: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
it('modo model sem LlmPort recusa antes de consultar o MCP e não usa seleção literal como fallback', async () => {
  const client = { callReadTool: vi.fn(), callCartTool: vi.fn() };
  const catalog = { listSavedAddresses: vi.fn(), searchStores: vi.fn(), getStore: vi.fn(), getMenu: vi.fn() };
  await expect(runIntegrationRead({ sessionId: 'fixture', organizerId: 'a', participants: [{ id: 'a', displayName: 'A', preferences: {} }],
    confirmedAddress: address, mode: 'model' }, { client, catalog })).rejects.toThrow('Modelo real não configurado.');
  expect(client.callReadTool).not.toHaveBeenCalled();
  expect(catalog.listSavedAddresses).not.toHaveBeenCalled();
});
it('grupo → catálogo MCP controlado → Core → duas preparações autorizadas → rateio para revisão', async () => {
  const client = {
    callReadTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'getUser') return envelope({ success: true, data: { email: 'test@example.invalid' } });
      if (name === 'listAddresses') return envelope({ results: [{ addressId: address.id, formattedAddress: address.formatted, coordinates: { latitude: 0, longitude: 0 } }] });
      if (name === 'searchOffers' && args.resultKind === 'ITEM') return envelope({ resultKind: 'ITEM', results: ['one', 'two'].map(id => ({ itemId: `${id}-item`, merchant: { merchantId: id }, itemName: id === 'one' ? 'PratoA' : 'PratoB', unitPrice: 10 })), hasMore: false });
      if (name === 'searchOffers') return envelope({ resultKind: 'MERCHANT', results: ['one', 'two'].map(id => ({ merchantId: id, merchantName: 'Loja fictícia', isOpen: true })), hasMore: false });
      if (name === 'getMerchant') return envelope({ merchantId: args.merchantId, merchantName: 'Loja fictícia', isOpen: true });
      if (name === 'getItem') return envelope({ merchantId: args.merchantId, itemId: args.itemId, optionGroups: [] });
      const storeId = (args.refinements as { merchantId: string }).merchantId;
      return envelope({ resultKind: 'ITEM', hasMore: false, nextPageToken: null, results: [{ itemId: `${storeId}-item`, merchant: { merchantId: storeId }, itemName: storeId === 'one' ? 'PratoA' : 'PratoB', unitPrice: 10 }] });
    }),
    callCartTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'createCart') return envelope({ cartId: `${args.merchantId}-cart` });
      const storeId = String(args.cartId).replace('-cart', '');
      return envelope({ cartId: args.cartId, merchant: { merchantId: storeId }, deliveryAddress: { addressId: address.id }, items: [{ itemId: `${storeId}-item`, quantity: 1, unitPrice: 10 }], deliveryMethod: { fee: 3 }, fees: [{ amount: 2 }], summary: { subtotalAmount: 10, deliveryFeeAmount: 3, feeTotalAmount: 2, benefitsTotalAmount: 0, voucherTotalAmount: 0, totalAmount: 15 } });
    }),
  };
  const port = createIfoodDiscoveryCatalog(client);
  const read = await runIntegrationRead({ sessionId: 'fixture-session', organizerId: 'a', confirmedAddress: address, mode: 'literal', participants: [
    { id: 'a', displayName: 'A', preferences: { wishes: ['PratoA'], budgetCents: 1000 } },
    { id: 'b', displayName: 'B', preferences: { wishes: ['PratoB'] } },
  ] }, { client, catalog: port });
  expect(client.callCartTool).not.toHaveBeenCalled();
  const proposal = read.preliminary.proposal!;
  expect(new Set(proposal.items.map(i => i.storeId)).size).toBe(2);
  const authority = createPreparationAuthority();
  const records = new Map<string, { cartId?: string }>();
  const commercial = createIfoodCommercialPreparation(client, { authenticatedUserId: 'fixture-user', moneyUnit: 'BRL', authority,
    journal: { get: async k => records.get(k), reserve: async k => { if (records.has(k)) return false; records.set(k, {}); return true; }, saveCart: async (k, cartId) => { records.set(k, { cartId }); } } });
  const entries = authority.authorize(proposal, 'a', 'fixture-user');
  const snapshots = [];
  for (const entry of entries) snapshots.push(await commercial.prepare(entry.context, entry.permit));
  const review = reviewCommercial(proposal, snapshots);
  expect(review.status).toBe('review_required');
  expect(review.split?.totalCents).toBe(3000);
  expect(review.split?.shares.reduce((s, p) => s + p.totalCents, 0)).toBe(3000);
  expect(review.overBudget).toEqual([{ participantId: 'a', totalCents: 1500 }]);
  expect(client.callCartTool.mock.calls.map(c => c[0])).toEqual(['createCart', 'getCart', 'createCart', 'getCart']);
});
