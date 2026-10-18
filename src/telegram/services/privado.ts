import type { ParticipantId, SessionId } from '../../core/index.js';
import type { Envio } from './envios.js';

// Estado do privado. Em memória, como as sessões do core.

// Grupo da última mensagem privada enviada a cada pessoa: quando ela responde no
// privado (ex.: digitando o endereço), a mensagem vai para a sessão desse grupo.
const sessaoDaPessoa = new Map<ParticipantId, SessionId>();

// DMs que falharam porque a pessoa ainda não iniciou conversa com o bot:
// entregues quando ela mandar /start.
const pendentes = new Map<ParticipantId, Envio[]>();

export function lembrarSessao(participantId: ParticipantId, sessionId: SessionId): void {
  sessaoDaPessoa.set(participantId, sessionId);
}

export function sessaoDa(participantId: ParticipantId): SessionId | undefined {
  return sessaoDaPessoa.get(participantId);
}

export function guardarPendente(participantId: ParticipantId, envio: Envio): void {
  pendentes.set(participantId, [...(pendentes.get(participantId) ?? []), envio]);
}

export function retirarPendentes(participantId: ParticipantId): Envio[] {
  const lista = pendentes.get(participantId) ?? [];
  pendentes.delete(participantId);
  return lista;
}
