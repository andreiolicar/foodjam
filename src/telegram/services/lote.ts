import type { Api } from 'grammy';

import type { ParticipantId, Resposta, SessionId } from '../../core/index.js';

// Última mensagem de cada pessoa em cada grupo, para reagir a ela quando o lote voltar.
const ultimaMensagem = new Map<string, number>();

const chave = (sessionId: SessionId, participantId: ParticipantId) => `${sessionId}:${participantId}`;

export function lembrarMensagem(sessionId: SessionId, participantId: ParticipantId, messageId: number): void {
  ultimaMensagem.set(chave(sessionId, participantId), messageId);
}

/** Lote que trocou itens da proposta: o grupo precisa ver a proposta nova. */
export function loteAjustouProposta(resposta: Resposta): boolean {
  return (resposta.proposal !== undefined || resposta.preliminary !== undefined) && (resposta.resultados ?? []).some((r) => r.outcome === 'adjusted');
}

/** Reage com 👍 à última mensagem de quem teve a preferência registrada. Falha não atrapalha o fluxo. */
export async function reagirPreferencias(
  api: Pick<Api, 'setMessageReaction'>,
  sessionId: SessionId,
  resposta: Resposta,
): Promise<void> {
  for (const { participantId, outcome } of resposta.resultados ?? []) {
    if (outcome !== 'preference_updated') continue;
    const messageId = ultimaMensagem.get(chave(sessionId, participantId));
    if (messageId === undefined) continue;
    try {
      await api.setMessageReaction(sessionId, messageId, [{ type: 'emoji', emoji: '👍' }]);
    } catch {
      // reações podem estar desligadas no grupo; ignora
    }
  }
}
