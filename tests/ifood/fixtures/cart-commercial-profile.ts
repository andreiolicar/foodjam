/** Perfil financeiro observado; IDs e endereço substituídos por dados fictícios. Não é catálogo de produção. */
export const cartCommercialProfile = {
  'cartId': 'fixture-cart',
  'merchant': {
    'merchantId': 'fixture-store'
  },
  'items': [
    {
      'itemId': 'fixture-item-0',
      'quantity': 1,
      'unitPrice': 35.9
    },
    {
      'itemId': 'fixture-item-1',
      'quantity': 1,
      'unitPrice': 39.9
    },
    {
      'itemId': 'fixture-item-2',
      'quantity': 1,
      'unitPrice': 32.9
    }
  ],
  'deliveryAddress': {
    'streetName': 'Rua fictícia',
    'streetNumber': '0',
    'neighborhood': 'Bairro fictício'
  },
  'deliveryMethod': {
    'fee': 0.0
  },
  'fees': [
    {
      'amount': 2.17
    }
  ],
  'summary': {
    'totalAmount': 80.87,
    'subtotalAmount': 108.7,
    'deliveryFeeAmount': 0.0,
    'feeTotalAmount': 2.17,
    'benefitsTotalAmount': 39.9,
    'voucherTotalAmount': 0.0
  }
};
