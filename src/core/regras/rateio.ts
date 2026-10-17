import type { MoneyCents, ParticipantId, ParticipantShare, ProposedItem, Split, StoreOrder } from '../contracts.js';
import { assertMoneyCents, somarCents } from './dinheiro.js';

export interface Portion {
  participantId: ParticipantId;
  amountCents: MoneyCents;
}

/**
 * Divide o total em partes iguais de centavos inteiros. O resto vai para os
 * primeiros participantes, na ordem recebida. A soma é sempre igual ao total.
 */
export function dividirIgual(totalCents: MoneyCents, participants: readonly ParticipantId[]): Portion[] {
  assertMoneyCents(totalCents, 'totalCents');
  if (participants.length === 0) {
    throw new RangeError('é preciso ao menos um participante para dividir');
  }
  if (new Set(participants).size !== participants.length) {
    throw new RangeError('participantes repetidos na divisão');
  }

  const base = Math.floor(totalCents / participants.length);
  const remainder = totalCents % participants.length;
  const portions = participants.map((participantId, index) => ({
    participantId,
    amountCents: base + (index < remainder ? 1 : 0),
  }));

  conferirSoma(portions.map((p) => p.amountCents), totalCents);
  return portions;
}

/** O mínimo de um StoreOrder que o rateio usa; um StoreOrder completo também serve. */
export interface SplitInput {
  storeId: StoreOrder['storeId'];
  deliveryFeeCents: MoneyCents;
  items: readonly Pick<ProposedItem, 'participantId' | 'unitPriceCents' | 'quantity'>[];
}

/**
 * Cada pessoa paga seus itens mais sua parte da entrega de cada loja de que
 * pediu. A entrega é dividida só entre quem pediu naquela loja, na ordem em
 * que aparecem nos itens. As partes saem na ordem da primeira aparição.
 */
export function calcularRateio(orders: readonly SplitInput[]): Split {
  const byParticipant = new Map<ParticipantId, { itemsCents: number; deliveryCents: number }>();
  const totalParts: MoneyCents[] = [];

  const accountOf = (participantId: ParticipantId) => {
    let account = byParticipant.get(participantId);
    if (!account) {
      account = { itemsCents: 0, deliveryCents: 0 };
      byParticipant.set(participantId, account);
    }
    return account;
  };

  for (const order of orders) {
    assertMoneyCents(order.deliveryFeeCents, `deliveryFeeCents da loja ${order.storeId}`);
    if (order.items.length === 0) {
      throw new RangeError(`pedido da loja ${order.storeId} não tem itens`);
    }

    const buyers: ParticipantId[] = [];
    for (const item of order.items) {
      assertMoneyCents(item.unitPriceCents, 'unitPriceCents');
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new RangeError(`quantity deve ser inteiro positivo; recebido: ${String(item.quantity)}`);
      }
      const subtotal = item.unitPriceCents * item.quantity;
      assertMoneyCents(subtotal, 'subtotal do item');

      accountOf(item.participantId).itemsCents += subtotal;
      totalParts.push(subtotal);
      if (!buyers.includes(item.participantId)) {
        buyers.push(item.participantId);
      }
    }

    for (const portion of dividirIgual(order.deliveryFeeCents, buyers)) {
      accountOf(portion.participantId).deliveryCents += portion.amountCents;
    }
    totalParts.push(order.deliveryFeeCents);
  }

  const shares: ParticipantShare[] = [...byParticipant].map(([participantId, account]) => {
    const totalCents = account.itemsCents + account.deliveryCents;
    assertMoneyCents(totalCents, `total de ${participantId}`);
    return { participantId, itemsCents: account.itemsCents, deliveryCents: account.deliveryCents, totalCents };
  });

  const totalCents = somarCents(totalParts);
  conferirSoma(shares.map((s) => s.totalCents), totalCents);
  return { shares, totalCents };
}

function conferirSoma(values: readonly MoneyCents[], expected: MoneyCents): void {
  const sum = somarCents(values);
  if (sum !== expected) {
    throw new Error(`invariante do rateio violada: soma ${sum} ≠ total ${expected}`);
  }
}
