import type { MenuItem, ParticipantId, ProposedItem, SessionState, Store } from '../contracts.js';
import type { ModelPick } from '../schemas.js';
import { assertMoneyCents } from './dinheiro.js';

/** Lojas e itens que o core consultou no catálogo durante esta sessão. */
export interface CatalogSnapshot {
  stores: readonly Store[];
  menuItems: readonly MenuItem[];
}

/** Retrato com o horário da consulta (ISO 8601), exigido no fechamento. */
export interface TimedCatalogSnapshot extends CatalogSnapshot {
  fetchedAt: string;
}

export type PickRejectionReason =
  | 'unknown_participant'
  | 'store_not_in_catalog'
  | 'item_not_in_catalog'
  | 'item_from_other_store'
  | 'store_closed'
  | 'item_unavailable'
  | 'not_eligible';

export interface RejectedPick {
  pick: ModelPick;
  reason: PickRejectionReason;
}

export interface PickValidation {
  accepted: ProposedItem[];
  rejected: RejectedPick[];
}

/**
 * Confere as escolhas do modelo contra a sessão e o catálogo consultado.
 * Escolhas inválidas são descartadas com o motivo. As aceitas viram
 * ProposedItem com o preço copiado do catálogo, nunca do modelo.
 */
export function validarEscolhas(
  picks: readonly ModelPick[],
  session: Pick<SessionState, 'participants'>,
  catalog: CatalogSnapshot,
): PickValidation {
  const participantIds = new Set<ParticipantId>(session.participants.map((p) => p.id));
  const stores = new Map(catalog.stores.map((s) => [s.id, s]));
  const menuItems = new Map(catalog.menuItems.map((i) => [i.id, i]));

  const accepted: ProposedItem[] = [];
  const rejected: RejectedPick[] = [];

  for (const pick of picks) {
    const store = stores.get(pick.storeId);
    const menuItem = menuItems.get(pick.menuItemId);

    let reason: PickRejectionReason | undefined;
    if (!participantIds.has(pick.participantId)) reason = 'unknown_participant';
    else if (!store) reason = 'store_not_in_catalog';
    else if (!menuItem) reason = 'item_not_in_catalog';
    else if (menuItem.storeId !== store.id) reason = 'item_from_other_store';
    else if (!store.isOpen) reason = 'store_closed';
    else if (!menuItem.available) reason = 'item_unavailable';

    if (reason || !store || !menuItem) {
      rejected.push({ pick, reason: reason ?? 'item_not_in_catalog' });
      continue;
    }

    assertMoneyCents(menuItem.priceCents, `priceCents do item ${menuItem.id}`);
    const item: ProposedItem = {
      participantId: pick.participantId,
      storeId: store.id,
      menuItemId: menuItem.id,
      quantity: pick.quantity,
      unitPriceCents: menuItem.priceCents,
    };
    if (pick.isSubstitute !== undefined) item.isSubstitute = pick.isSubstitute;
    accepted.push(item);
  }

  return { accepted, rejected };
}
