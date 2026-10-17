import type { OrderAuthorization, ParticipantId, Proposal, SessionState, SessionStatus } from './contracts.js';

/** Autorização de compra registrada uma única vez, no fechamento. O horário vem de quem chama. */
export type Closure = OrderAuthorization;

/** Pergunta feita durante a coleta, respondida ou considerada na proposta. */
export interface PendingQuestion {
  participantId: ParticipantId;
  text: string;
}

/** Estado interno do core; compatível com SessionState para a interface. */
export interface CoreSession extends SessionState {
  proposal?: Proposal;
  closure?: Closure;
  pendingQuestions?: PendingQuestion[];
}

/** Transições permitidas. closed e cancelled são finais. */
const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  collecting: ['reviewing', 'cancelled'],
  // reviewing → reviewing: proposta substituída após ajuste.
  // reviewing → collecting: alguém novo entrou ou mudou de ideia; a proposta é descartada.
  reviewing: ['reviewing', 'collecting', 'awaiting_confirmation', 'cancelled'],
  // awaiting_confirmation → reviewing: organizador pediu ajuste antes de confirmar.
  awaiting_confirmation: ['closed', 'reviewing', 'cancelled'],
  closed: [],
  cancelled: [],
};

export class TransicaoInvalidaError extends Error {
  constructor(
    readonly from: SessionStatus,
    readonly to: SessionStatus,
  ) {
    super(`transição inválida: ${from} → ${to}`);
    this.name = 'TransicaoInvalidaError';
  }
}

export class NaoAutorizadoError extends Error {
  constructor(
    readonly actorId: ParticipantId,
    readonly action: string,
  ) {
    super(`${actorId} não pode ${action}: apenas o organizador`);
    this.name = 'NaoAutorizadoError';
  }
}

export function podeTransitar(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function transitar(session: CoreSession, to: SessionStatus): void {
  if (!podeTransitar(session.status, to)) {
    throw new TransicaoInvalidaError(session.status, to);
  }
}

function exigirOrganizador(session: CoreSession, actorId: ParticipantId, action: string): void {
  if (actorId !== session.organizerId) {
    throw new NaoAutorizadoError(actorId, action);
  }
}

/** Nova sessão em coleta. */
export function criarSessao(input: Pick<SessionState, 'id' | 'organizerId' | 'participants'>): CoreSession {
  return { id: input.id, organizerId: input.organizerId, status: 'collecting', participants: [...input.participants] };
}

/** Coleta → proposta, ou troca a proposta atual durante a revisão. */
export function apresentarProposta(session: CoreSession, proposal: Proposal): CoreSession {
  transitar(session, 'reviewing');
  if (proposal.sessionId !== session.id) {
    throw new Error(`proposta ${proposal.id} é de outra sessão (${proposal.sessionId})`);
  }
  return { ...session, status: 'reviewing', proposal };
}

/** Proposta → coleta, descartando a proposta atual. */
export function voltarParaColeta(session: CoreSession): CoreSession {
  transitar(session, 'collecting');
  const next: CoreSession = { ...session, status: 'collecting' };
  delete next.proposal;
  return next;
}

/** Proposta → aguardando confirmação do organizador. */
export function pedirConfirmacao(session: CoreSession): CoreSession {
  transitar(session, 'awaiting_confirmation');
  if (!session.proposal) {
    throw new Error('não há proposta para confirmar');
  }
  return { ...session, status: 'awaiting_confirmation' };
}

export interface ConfirmacaoResult {
  session: CoreSession;
  closure: Closure;
  /** true quando a sessão já estava fechada: nenhum fechamento novo foi gerado. */
  alreadyClosed: boolean;
}

/**
 * Confirmação → fechada. Só o organizador confirma. Idempotente: confirmar uma
 * sessão já fechada devolve o mesmo fechamento, sem gerar outro.
 */
export function confirmar(session: CoreSession, actorId: ParticipantId, now: string): ConfirmacaoResult {
  exigirOrganizador(session, actorId, 'confirmar o pedido');

  if (session.status === 'closed' && session.closure) {
    return { session, closure: session.closure, alreadyClosed: true };
  }

  transitar(session, 'closed');
  if (!session.proposal) {
    throw new Error('não há proposta para confirmar');
  }
  const closure: Closure = { proposalId: session.proposal.id, authorizedBy: actorId, authorizedAt: now };
  return { session: { ...session, status: 'closed', closure }, closure, alreadyClosed: false };
}

/** Qualquer fase não final → cancelada. Só o organizador cancela. */
export function cancelar(session: CoreSession, actorId: ParticipantId): CoreSession {
  exigirOrganizador(session, actorId, 'cancelar a sessão');
  transitar(session, 'cancelled');
  return { ...session, status: 'cancelled' };
}
