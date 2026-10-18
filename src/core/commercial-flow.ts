import type { CommercialPreparationPort } from './ports.js';
import { createHash } from 'node:crypto';
import type { CartObservation, CommercialReview, CommercialShare, PreliminaryProposal, PreparationAuthority, PreparationContext, PreparationPermit } from './contracts.js';
import { assertMoneyCents, somarCents } from './regras/dinheiro.js';
import { dividirIgual } from './regras/rateio.js';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Só chamar a partir de evento autenticado do organizador, nunca saída do LLM. */
export function createPreparationAuthority() {
  const issued = new WeakMap<PreparationPermit, string>();
  const authority: PreparationAuthority & {
    authorize(proposal: PreliminaryProposal, actorId: string, authenticatedUserId: string): { context: PreparationContext; permit: PreparationPermit }[];
  } = {
    authorize(proposal, actorId, authenticatedUserId) {
      if (actorId !== proposal.organizerId || !authenticatedUserId || !proposal.address.id || proposal.status !== 'preliminary') throw new Error('Preparação não autorizada.');
      const groups = new Map<string, Map<string, number>>();
      for (const item of proposal.items) {
        if (!proposal.participants.some(p => p.id === item.participantId) || !item.menuItemId || !item.storeId
          || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) throw new Error('Composição inválida.');
        const group = groups.get(item.storeId) ?? new Map<string, number>();
        group.set(item.menuItemId, (group.get(item.menuItemId) ?? 0) + item.quantity); groups.set(item.storeId, group);
      }
      if (groups.size < 1 || groups.size > 2) throw new Error('Esperadas uma ou duas lojas.');
      return [...groups].map(([storeId, group]) => {
        const context: PreparationContext = { authenticatedUserId, sessionId: proposal.sessionId, proposalId: proposal.id,
          storeId, address: { ...proposal.address }, items: [...group].map(([menuItemId, quantity]) => ({ menuItemId, quantity })) };
        const permit = Object.freeze({ purpose: 'prepare_cart' as const });
        issued.set(permit, fingerprint(context));
        return { context, permit };
      });
    },
    verify(permit, context) {
      if (!permit || issued.get(permit) !== fingerprint(context)) throw new Error('Permissão de preparação inválida.');
    },
  };
  return authority;
}

export type DiscountPolicy = 'block_unattributed' | 'proportional_items' | 'proportional_unattributed_adjustment';

/** Política explícita: benefício agregado proporcional ao valor bruto dos itens. */
function distributeDiscount(total: number, weights: readonly { participantId: string; amount: number }[], limitToItems = true) {
  const denominator = BigInt(somarCents(weights.map(w => w.amount)));
  if (!total) return weights.map(w => ({ participantId: w.participantId, amount: 0 }));
  if (denominator === 0n || limitToItems && BigInt(total) > denominator) throw new Error('Ajuste sem base atribuível.');
  const parts = weights.map((w, index) => {
    const numerator = BigInt(total) * BigInt(w.amount);
    return { participantId: w.participantId, amount: Number(numerator / denominator), remainder: numerator % denominator, index };
  });
  let remaining = total - somarCents(parts.map(p => p.amount));
  for (const p of [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (remaining-- > 0) p.amount++;
  }
  return parts;
}

/** Preserva total remoto; ajuste sem origem só entra por política explícita e revisão. */
export function reviewCommercial(proposal: PreliminaryProposal, observations: readonly CartObservation[], policy: DiscountPolicy = 'block_unattributed'): CommercialReview {
  const revision = fingerprint({ proposal, observations, policy });
  const expectedStores = [...new Set(proposal.items.map(i => i.storeId))];
  const failures: string[] = [];
  const accounts = new Map<string, CommercialShare>();
  const totals: number[] = [];
  const adjustmentBuyers = new Set<string>();
  const useAdjustment = policy === 'proportional_unattributed_adjustment';
  if (!expectedStores.length || expectedStores.length > 2 || observations.length !== expectedStores.length
    || new Set(observations.map(o => o.cartId)).size !== observations.length || new Set(proposal.participants.map(p => p.id)).size !== proposal.participants.length) {
    return { status: 'blocked', observations: structuredClone([...observations]), failures: expectedStores, overBudget: [], revision };
  }
  for (const storeId of expectedStores) {
    try {
      const matches = observations.filter(o => o.storeId === storeId);
      if (matches.length !== 1) throw new Error('Carrinho ausente/ambíguo.');
      const cart = matches[0]!;
      if (!cart.amounts || cart.issues.some(issue => !useAdjustment || issue !== 'total_decomposition_mismatch') || !cart.cartId) throw new Error('Dados comerciais incompletos.');
      Object.values(cart.amounts).forEach(v => assertMoneyCents(v));
      const requested = proposal.items.filter(i => i.storeId === storeId);
      const quantities = new Map<string, number>();
      const weights = new Map<string, number>();
      for (const item of requested) {
        if (!proposal.participants.some(p => p.id === item.participantId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('Participação inválida.');
        quantities.set(item.menuItemId, (quantities.get(item.menuItemId) ?? 0) + item.quantity);
        const actual = cart.items.filter(i => i.menuItemId === item.menuItemId);
        if (actual.length !== 1) throw new Error('Item ausente/ambíguo.');
        assertMoneyCents(actual[0]!.unitPriceCents);
        weights.set(item.participantId, somarCents([weights.get(item.participantId) ?? 0, actual[0]!.unitPriceCents * item.quantity]));
      }
      if (cart.items.length !== quantities.size || cart.items.some(i => i.quantity !== quantities.get(i.menuItemId))) throw new Error('Quantidade divergente.');
      const amounts = cart.amounts;
      const subtotal = somarCents([...weights.values()]);
      // Nesta política os agregados de benefícios são preservados na observação,
      // mas não subtraídos: sua sobreposição/origem não foi comprovada.
      const discount = useAdjustment ? 0 : somarCents([amounts.benefitsCents, amounts.voucherCents]);
      const grossTotal = somarCents([subtotal, amounts.deliveryCents, amounts.feesCents]);
      if (subtotal !== amounts.subtotalCents || !useAdjustment && grossTotal - discount !== amounts.totalCents) throw new Error('Total sem reconciliação.');
      if (discount && policy !== 'proportional_items') throw new Error('Política de benefício não definida.');
      const buyers = [...weights.keys()];
      const delivery = dividirIgual(amounts.deliveryCents, buyers);
      const fees = dividirIgual(amounts.feesCents, buyers);
      const discounts = distributeDiscount(discount, [...weights].map(([participantId, amount]) => ({ participantId, amount })));
      const credit = useAdjustment && grossTotal > amounts.totalCents ? grossTotal - amounts.totalCents : 0;
      const debit = useAdjustment && amounts.totalCents > grossTotal ? amounts.totalCents - grossTotal : 0;
      const credits = distributeDiscount(credit, [...weights].map(([participantId, amount]) => ({ participantId, amount })), false);
      const debits = distributeDiscount(debit, [...weights].map(([participantId, amount]) => ({ participantId, amount })), false);
      if (useAdjustment) buyers.forEach(id => adjustmentBuyers.add(id));
      for (const [index, participantId] of buyers.entries()) {
        const account = accounts.get(participantId) ?? { participantId, itemsCents: 0, deliveryCents: 0, feesCents: 0, discountCents: 0, totalCents: 0 };
        account.itemsCents = somarCents([account.itemsCents, weights.get(participantId)!]);
        account.deliveryCents = somarCents([account.deliveryCents, delivery[index]!.amountCents]);
        account.feesCents = somarCents([account.feesCents, fees[index]!.amountCents]);
        account.discountCents = somarCents([account.discountCents, discounts[index]!.amount]);
        if (useAdjustment) {
          account.unattributedAdjustment = {
            creditCents: somarCents([account.unattributedAdjustment?.creditCents ?? 0, credits[index]!.amount]),
            debitCents: somarCents([account.unattributedAdjustment?.debitCents ?? 0, debits[index]!.amount]),
          };
          // Nenhuma loja pode produzir parcela negativa, mesmo que outra compense.
          assertMoneyCents(somarCents([weights.get(participantId)!, delivery[index]!.amountCents, fees[index]!.amountCents, debits[index]!.amount]) - credits[index]!.amount);
        }
        accounts.set(participantId, account);
      }
      totals.push(amounts.totalCents);
    } catch { failures.push(storeId); }
  }
  if (failures.length) return { status: 'blocked', observations: structuredClone([...observations]), failures, overBudget: [], revision };
  const shares = [...accounts.values()].map(a => ({ ...a, totalCents: somarCents([a.itemsCents, a.deliveryCents, a.feesCents,
    a.unattributedAdjustment?.debitCents ?? 0]) - a.discountCents - (a.unattributedAdjustment?.creditCents ?? 0) }));
  shares.forEach(s => assertMoneyCents(s.totalCents));
  const totalCents = somarCents(totals);
  if (somarCents(shares.map(s => s.totalCents)) !== totalCents) throw new Error('Rateio não reconcilia.');
  const overBudget = shares.filter(s => {
    const budget = proposal.participants.find(p => p.id === s.participantId)?.preferences.budgetCents;
    if (budget === undefined) return false;
    assertMoneyCents(budget); return s.totalCents > budget;
  }).map(s => ({ participantId: s.participantId, totalCents: s.totalCents }));
  return { status: 'review_required', observations: structuredClone([...observations]), failures: [], split: { shares, totalCents }, overBudget, revision,
    ...(useAdjustment ? { adjustmentPolicy: { name: 'proportional_unattributed_adjustment' as const, requiredParticipantIds: [...adjustmentBuyers] } } : {}) };
}

/** Revisão da proposta, nunca autorização de compra nem submitOrder. */
export function canConfirmCommercial(review: CommercialReview, actorId: string, organizerId: string,
  accepted: readonly { participantId: string; revision: string }[]): boolean {
  const required = [...review.overBudget.map(p => p.participantId), ...(review.adjustmentPolicy?.requiredParticipantIds ?? [])];
  return actorId === organizerId && review.status === 'review_required' && required.every(id => accepted.some(a => a.participantId === id && a.revision === review.revision));
}

/** Chamado pelo controlador apenas no evento explícito de preparar do organizador. */
export async function prepareCommercialProposal(proposal: PreliminaryProposal, actorId: string, authenticatedUserId: string,
  authority: ReturnType<typeof createPreparationAuthority>, port: CommercialPreparationPort, policy: DiscountPolicy = 'block_unattributed') {
  const snapshot = structuredClone(proposal);
  const entries = authority.authorize(snapshot, actorId, authenticatedUserId);
  const observations: CartObservation[] = [];
  const failed: string[] = [];
  for (const entry of entries) {
    try { observations.push(await port.prepare(entry.context, entry.permit)); }
    catch { failed.push(entry.context.storeId); }
  }
  const review = reviewCommercial(snapshot, observations, policy);
  return failed.length ? { ...review, status: 'blocked' as const, failures: [...new Set([...review.failures, ...failed])] } : review;
}
