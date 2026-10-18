import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { MenuItemId, MoneyCents, ParticipantId, Proposal, SessionState, StoreId } from '../contracts.js';
import { ProposalSchema } from '../schemas.js';
import { calcularRateio } from './rateio.js';
import type { CatalogSnapshot, PickRejectionReason } from './validar-escolhas.js';
import { validarEscolhas } from './validar-escolhas.js';

/** Problemas sem valores de orçamento: podem ser mostrados sem expor o limite de ninguém. */
export type ProblemaProposta =
  | { code: 'wrong_session'; proposalSessionId: string }
  | { code: 'invalid_proposal'; detail: string }
  | { code: 'item_rejected'; participantId: ParticipantId; menuItemId: MenuItemId; reason: PickRejectionReason }
  | { code: 'price_changed'; menuItemId: MenuItemId; proposedCents: MoneyCents; currentCents: MoneyCents }
  | { code: 'delivery_fee_changed'; storeId: StoreId; proposedCents: MoneyCents; currentCents: MoneyCents }
  | { code: 'below_minimum'; storeId: StoreId }
  | { code: 'split_mismatch' }
  | { code: 'over_budget'; participantId: ParticipantId }
  | { code: 'stale_catalog'; fetchedAt: string; maxAgeMs: number }
  /** Ajuste: a pessoa tem vários itens e não ficou claro qual trocar. */
  | { code: 'which_item'; participantId: ParticipantId; menuItemIds: MenuItemId[] };

/**
 * Validação completa de uma proposta contra a sessão e o catálogo atual.
 * Lista vazia = proposta pode seguir. Usada no ajuste e no fechamento.
 */
export function verificarProposta(
  proposal: Proposal,
  session: Pick<SessionState, 'id' | 'participants'>,
  catalog: CatalogSnapshot,
): ProblemaProposta[] {
  const problems: ProblemaProposta[] = [];

  if (proposal.sessionId !== session.id) {
    problems.push({ code: 'wrong_session', proposalSessionId: proposal.sessionId });
  }
  const parsed = ProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    // Sem estrutura e contas consistentes, as checagens abaixo não são confiáveis.
    return [...problems, { code: 'invalid_proposal', detail: z.prettifyError(parsed.error) }];
  }

  for (const order of proposal.orders) {
    for (const item of order.items) {
      const { accepted, rejected } = validarEscolhas([item], session, catalog);
      const [rejection] = rejected;
      if (rejection) {
        problems.push({ code: 'item_rejected', participantId: item.participantId, menuItemId: item.menuItemId, reason: rejection.reason });
      } else if (accepted[0] && accepted[0].unitPriceCents !== item.unitPriceCents) {
        problems.push({
          code: 'price_changed',
          menuItemId: item.menuItemId,
          proposedCents: item.unitPriceCents,
          currentCents: accepted[0].unitPriceCents,
        });
      }
    }

    const store = catalog.stores.find((s) => s.id === order.storeId);
    if (!store) continue; // já reportado como item_rejected
    if (store.deliveryFeeCents !== order.deliveryFeeCents) {
      problems.push({
        code: 'delivery_fee_changed',
        storeId: order.storeId,
        proposedCents: order.deliveryFeeCents,
        currentCents: store.deliveryFeeCents,
      });
    }
    if (store.minimumOrderCents !== undefined && order.subtotalCents < store.minimumOrderCents) {
      problems.push({ code: 'below_minimum', storeId: order.storeId });
    }
  }

  if (!isDeepStrictEqual(calcularRateio(proposal.orders), proposal.split)) {
    problems.push({ code: 'split_mismatch' });
    return problems;
  }

  // "Até X reais" vale para a soma dos itens da pessoa (como o iFood mostra os
  // preços). A parte da entrega aparece no rateio, mas não tira ninguém do pedido.
  for (const share of proposal.split.shares) {
    const budget = session.participants.find((p) => p.id === share.participantId)?.preferences.budgetCents;
    if (budget !== undefined && share.itemsCents > budget) {
      problems.push({ code: 'over_budget', participantId: share.participantId });
    }
  }

  return problems;
}
