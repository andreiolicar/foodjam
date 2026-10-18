import type { Resposta } from './agente.js';
import type { CheckoutInspection, CommercialReview, PreliminaryProposal } from './contracts.js';
import type { SessionStore } from './ports.js';

export interface CartPreparationService {
  prepare(proposal: PreliminaryProposal, actor: string, current: () => Promise<boolean>): Promise<CommercialReview>;
  read(proposal: PreliminaryProposal, actor: string, current: () => Promise<boolean>): Promise<CommercialReview>;
  checkout?(proposal: PreliminaryProposal, actor: string, current: () => Promise<boolean>): Promise<CheckoutInspection>;
}

/** A reserva local é síncrona antes da rede. Escritas também têm journal durável no adaptador. */
export function createCartController(sessions: SessionStore, service: CartPreparationService) {
  const attempts = new Map<string, { sessionId: string; fingerprint: string; busy: boolean; review?: CommercialReview }>();
  async function act(id: string, actor: string, expected: string, mode: 'prepare' | 'read' | 'checkout'): Promise<Resposta> {
    const readOnly = mode !== 'prepare';
    const record = await sessions.get(id); const session = record?.session;
    if (!session || ['closed', 'cancelled'].includes(session.status)) return { outcome: 'proposal_stale', actions: [] };
    if (session.organizerId !== actor) return { outcome: 'not_authorized', actions: [] };
    const proposal = session.preliminary;
    if (!expected || proposal?.id !== expected || session.address?.status !== 'confirmed'
      || JSON.stringify(session.address.confirmed) !== JSON.stringify(proposal.address)) return { outcome: 'proposal_stale', actions: [] };
    if (mode === 'checkout' && !service.checkout) return { outcome: 'checkout_unavailable', actions: [] };
    const snapshot = structuredClone(proposal);
    const fingerprint = JSON.stringify({ proposal, participants: session.participants, address: session.address });
    let expired = false;
    const current = async () => {
      const s = (await sessions.get(id))?.session;
      return !expired && !!s && !['closed', 'cancelled'].includes(s.status)
        && JSON.stringify({ proposal: s.preliminary, participants: s.participants, address: s.address }) === fingerprint;
    };
    const key = JSON.stringify([id, expected]);
    const previous = attempts.get(key);
    if (previous && previous.fingerprint !== fingerprint) return { outcome: 'proposal_stale', actions: [] };
    if (!readOnly && !previous && [...attempts.values()].some(a => a.sessionId === id && (a.busy || !a.review))) return { outcome: 'cart_previous_pending', actions: [] };
    const result = (review?: CommercialReview): Resposta => review
      ? { outcome: 'cart_review', actions: [], cartReview: structuredClone(review), cartProposal: snapshot,
        ...(record?.discoveryCatalog ? { items: record.discoveryCatalog.items } : {}) }
      : { outcome: 'cart_uncertain', actions: [] };
    if (previous?.busy) return { outcome: 'cart_preparing', actions: [] };
    if (!readOnly && previous) return result(previous.review);
    if (readOnly && !previous) return { outcome: 'cart_not_prepared', actions: [] };
    const attempt = previous ?? { sessionId: id, fingerprint, busy: false };
    attempt.busy = true; attempts.set(key, attempt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('Prazo comercial incerto.')); }, 30_000); });
      let inspection: CheckoutInspection | undefined;
      const operation = async () => {
        if (mode === 'checkout') { inspection = await service.checkout!(snapshot, actor, current); return inspection.review; }
        return (readOnly ? service.read : service.prepare)(snapshot, actor, current);
      };
      const review = await Promise.race([operation(), timeout]);
      if (!await current()) return { outcome: 'proposal_stale', actions: [] };
      attempt.review = structuredClone(review);
      return inspection ? { ...result(review), outcome: 'checkout_blocked', checkout: structuredClone(inspection) } : result(review);
    } catch {
      delete attempt.review;
      return expired || await current() ? result() : { outcome: 'proposal_stale', actions: [] };
    } finally { clearTimeout(timer); expired = true; attempt.busy = false; }
  }
  return {
    prepararCarrinho: (id: string, actor: string, expected: string) => act(id, actor, expected, 'prepare'),
    revisarCarrinho: (id: string, actor: string, expected: string) => act(id, actor, expected, 'read'),
    revisarCheckout: (id: string, actor: string, expected: string) => act(id, actor, expected, 'checkout'),
  };
}
