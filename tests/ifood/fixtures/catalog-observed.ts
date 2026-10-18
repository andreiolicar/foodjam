// Formas observadas nos relatórios privados 04/05. Todos os valores são
// sintéticos, inclusive dinheiro: não constituem evidência de unidade BRL.
export const observedItem = {
  itemId: 'fixture-item', merchantId: 'fixture-store', merchantName: 'Loja fictícia',
  itemName: 'Produto fictício', itemDescription: 'Descrição fictícia',
  unitPrice: 12.34, promotionalUnitPrice: 12.34, merchantMinimumOrderAmount: 20,
  optionGroups: [], appDeeplink: 'https://example.invalid/item',
  agentHints: { nextStep: 'Metadado sintético, sem autoridade.' },
};

export const observedOffers = {
  resultKind: 'ITEM', merchantType: 'RESTAURANT',
  results: [{
    itemId: observedItem.itemId, itemName: observedItem.itemName,
    unitPrice: observedItem.unitPrice, promotionalUnitPrice: observedItem.promotionalUnitPrice,
    merchant: {
      merchantId: observedItem.merchantId, merchantName: observedItem.merchantName,
      isOpen: true, minimumOrderAmount: 20,
      deliveryMethod: { fee: 4, promotionalFee: 4, deliveryMethodId: 'fixture-delivery',
        deliveryMethodMode: 'DELIVERY', estimatedMinutes: { min: 20, max: 40 } },
    },
  }],
  hasMore: false, nextPageToken: null,
  agentHints: { nextStepWhenUserPicksItem: 'Metadado sintético, sem autoridade.' },
};

export function observedEnvelope(value: Record<string, unknown>) {
  return { isError: false, structuredContent: value,
    content: [{ type: 'text', text: JSON.stringify(value) }] };
}
