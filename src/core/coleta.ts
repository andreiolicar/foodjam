import type { CoreAction, IncomingMessage, MoneyCents, Participant, ParticipantPreferences } from './contracts.js';
import type { LlmCallRecord } from './llm.js';
import { LlmSaidaInvalidaError, gerarEstruturado } from './llm.js';
import type { LlmPort } from './ports.js';
import { SISTEMA_COLETA, montarPromptColeta } from './prompts/coleta.js';
import { ColetaOutputSchema } from './schemas.js';
import type { CoreSession } from './sessao.js';

/** Mensagens maiores são cortadas antes de ir ao modelo. */
export const MAX_MESSAGE_LENGTH = 500;
/** Orçamento acima disso é tratado como engano de digitação e ignorado. */
export const MAX_BUDGET_CENTS = 100_000;

export const TEXTO_FALHA_MODELO = 'Não consegui entender agora. Pode repetir o que você quer comer?';
export const TEXTO_PERGUNTA_ANOTADA = 'Anotei sua pergunta e vou levar em conta na proposta.';
/** Limite de perguntas guardadas por pessoa, para não inflar o prompt da proposta. */
export const MAX_PENDING_QUESTIONS_PER_PARTICIPANT = 3;

export type ColetaOutcome = 'filtered' | 'preference_updated' | 'question' | 'irrelevant' | 'clarification' | 'model_failed';

export interface ColetaResult {
  session: CoreSession;
  actions: CoreAction[];
  outcome: ColetaOutcome;
}

export interface ColetaDeps {
  llm: LlmPort;
  registrar?: (record: LlmCallRecord) => void;
  timeoutMs?: number;
}

/**
 * Filtro barato antes do modelo: descarta mensagens vazias ou sem nenhuma
 * letra ou número (só emoji, pontuação ou espaços).
 */
export function passaNoFiltro(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Converte o trecho de orçamento citado pela pessoa em centavos.
 * Aceita "30", "R$ 25,90", "25.50", "1.000". Devolve undefined se não houver valor plausível.
 */
export function extrairOrcamentoCents(text: string): MoneyCents | undefined {
  const match = /(\d{1,3}(?:\.\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)/.exec(text);
  if (!match?.[1]) return undefined;

  const reais = Number(match[1].replaceAll('.', ''));
  const centavos = Number((match[2] ?? '0').padEnd(2, '0'));
  const total = reais * 100 + centavos;
  return Number.isSafeInteger(total) && total > 0 && total <= MAX_BUDGET_CENTS ? total : undefined;
}

const limparLista = (items: readonly string[]) => [...new Set(items.map((i) => i.trim()).filter(Boolean))];

/**
 * Fase de coleta: interpreta uma mensagem e atualiza as preferências de quem
 * escreveu. Não altera outros participantes nem a fase da sessão.
 */
export async function coletar(
  session: CoreSession,
  message: IncomingMessage,
  deps: ColetaDeps,
  displayName?: string,
): Promise<ColetaResult> {
  if (message.sessionId !== session.id) {
    throw new Error(`mensagem da sessão ${message.sessionId} enviada para a sessão ${session.id}`);
  }
  if (session.status !== 'collecting') {
    throw new Error(`coleta só é possível na fase collecting; a sessão está em ${session.status}`);
  }

  const text = message.text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!passaNoFiltro(text)) {
    return { session, actions: [], outcome: 'filtered' };
  }

  const existing = session.participants.find((p) => p.id === message.participantId);
  const current: ParticipantPreferences = existing?.preferences ?? {};

  let output;
  try {
    output = await gerarEstruturado({
      llm: deps.llm,
      phase: 'coleta',
      tier: 'fast',
      system: SISTEMA_COLETA,
      prompt: montarPromptColeta(text, current),
      outputName: 'coleta',
      schema: ColetaOutputSchema,
      ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
      ...(deps.registrar && { registrar: deps.registrar }),
    });
  } catch (error) {
    if (!(error instanceof LlmSaidaInvalidaError)) throw error;
    return { session, actions: [mensagemPrivada(session, message, TEXTO_FALHA_MODELO)], outcome: 'model_failed' };
  }

  switch (output.kind) {
    case 'irrelevant':
      return { session, actions: [], outcome: 'irrelevant' };
    case 'question': {
      const pending = session.pendingQuestions ?? [];
      const doParticipante = pending.filter((q) => q.participantId === message.participantId).length;
      const next: CoreSession =
        doParticipante < MAX_PENDING_QUESTIONS_PER_PARTICIPANT
          ? { ...session, pendingQuestions: [...pending, { participantId: message.participantId, text }] }
          : session;
      return { session: next, actions: [mensagemPrivada(session, message, TEXTO_PERGUNTA_ANOTADA)], outcome: 'question' };
    }
    case 'ambiguous':
      return {
        session,
        actions: [mensagemPrivada(session, message, output.clarification ?? TEXTO_FALHA_MODELO)],
        outcome: 'clarification',
      };
    case 'preference': {
      const preferences: ParticipantPreferences = {
        foodPreferences: limparLista(output.foodPreferences),
        dietaryRestrictions: limparLista(output.dietaryRestrictions),
        avoids: limparLista(output.avoids),
      };
      const budgetCents = output.budgetText ? extrairOrcamentoCents(output.budgetText) : current.budgetCents;
      if (budgetCents !== undefined) preferences.budgetCents = budgetCents;

      const participant: Participant = {
        id: message.participantId,
        displayName: existing?.displayName ?? displayName ?? message.participantId,
        preferences,
      };
      const participants = existing
        ? session.participants.map((p) => (p.id === participant.id ? participant : p))
        : [...session.participants, participant];
      const next: CoreSession = { ...session, participants };
      return { session: next, actions: [{ type: 'session_updated', session: next }], outcome: 'preference_updated' };
    }
  }
}

function mensagemPrivada(session: CoreSession, message: IncomingMessage, text: string): CoreAction {
  return { type: 'send_message', sessionId: session.id, participantId: message.participantId, text };
}
