import type { AuthorizedOrder, CoreAction, ParticipantId } from './contracts.js';
import type { TimedCatalogSnapshot } from './regras/validar-escolhas.js';
import type { ProblemaProposta } from './regras/verificar-proposta.js';
import { verificarProposta } from './regras/verificar-proposta.js';
import type { Closure, CoreSession } from './sessao.js';
import { NaoAutorizadoError, TransicaoInvalidaError, confirmar } from './sessao.js';

/** Idade máxima padrão do retrato do catálogo no fechamento. */
export const MAX_CATALOG_AGE_MS = 60_000;

export type FechamentoResult =
  | { ok: true; session: CoreSession; order: AuthorizedOrder; alreadyClosed: boolean; actions: CoreAction[] }
  | { ok: false; problems: ProblemaProposta[] };

export interface FechamentoOptions {
  /** Padrão: MAX_CATALOG_AGE_MS. */
  maxCatalogAgeMs?: number;
}

/**
 * Fecha a sessão após autorização explícita do organizador.
 *
 * - Só o organizador fecha (NaoAutorizadoError para os demais).
 * - Só a partir de awaiting_confirmation (TransicaoInvalidaError fora disso).
 * - O retrato do catálogo precisa ser recente (fetchedAt até maxCatalogAgeMs
 *   antes de now); senão, devolve o problema stale_catalog.
 * - Revalida tudo contra esse catálogo: itens, preços, taxas, pedido mínimo,
 *   rateio e orçamentos. Com problema, não fecha e devolve a lista.
 * - Idempotente: em sessão já fechada devolve o mesmo pedido autorizado,
 *   com alreadyClosed = true, sem revalidar nem gerar outro fechamento.
 */
export function fechar(
  session: CoreSession,
  actorId: ParticipantId,
  now: string,
  catalog: TimedCatalogSnapshot,
  options: FechamentoOptions = {},
): FechamentoResult {
  if (actorId !== session.organizerId) {
    throw new NaoAutorizadoError(actorId, 'fechar o pedido');
  }

  if (session.status === 'closed' && session.closure && session.proposal) {
    return { ok: true, session, order: pedidoAutorizado(session, session.closure), alreadyClosed: true, actions: [] };
  }
  if (session.status !== 'awaiting_confirmation' || !session.proposal) {
    throw new TransicaoInvalidaError(session.status, 'closed');
  }

  const maxAgeMs = options.maxCatalogAgeMs ?? MAX_CATALOG_AGE_MS;
  const ageMs = Date.parse(now) - Date.parse(catalog.fetchedAt);
  // NaN (data inválida) ou idade negativa (consulta "no futuro") também são recusados.
  if (!(ageMs >= 0 && ageMs <= maxAgeMs)) {
    return { ok: false, problems: [{ code: 'stale_catalog', fetchedAt: catalog.fetchedAt, maxAgeMs }] };
  }

  const problems = verificarProposta(session.proposal, session, catalog);
  if (problems.length > 0) return { ok: false, problems };

  const { session: closed, closure } = confirmar(session, actorId, now);
  return {
    ok: true,
    session: closed,
    order: pedidoAutorizado(closed, closure),
    alreadyClosed: false,
    actions: [{ type: 'session_updated', session: closed }],
  };
}

/** Cópia dos dados, para o backend não alterar o estado da sessão por acidente. */
function pedidoAutorizado(session: CoreSession, closure: Closure): AuthorizedOrder {
  const proposal = session.proposal;
  if (!proposal || proposal.id !== closure.proposalId) {
    throw new Error(`fechamento aponta para a proposta ${closure.proposalId}, que não é a atual`);
  }
  return structuredClone({
    sessionId: session.id,
    proposalId: proposal.id,
    authorization: closure,
    orders: proposal.orders,
    split: proposal.split,
  });
}
