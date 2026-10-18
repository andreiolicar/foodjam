import type { CoreAction, IncomingMessage, MoneyCents, Participant, ParticipantId, ParticipantPreferences } from './contracts.js';
import type { LlmCallRecord } from './llm.js';
import { LlmSaidaInvalidaError, gerarEstruturado } from './llm.js';
import type { LlmPort } from './ports.js';
import { SISTEMA_COLETA, SISTEMA_COLETA_LOTE, montarPromptColeta, montarPromptColetaLote } from './prompts/coleta.js';
import type { ColetaOutput } from './schemas.js';
import { ColetaOutputSchema, criarColetaLoteSchema } from './schemas.js';
import type { CoreSession } from './sessao.js';
import { quantidadesDaMensagem } from './regras/quantidades.js';

/** Mensagens maiores são cortadas antes de ir ao modelo. */
export const MAX_MESSAGE_LENGTH = 500;
/** Orçamento acima disso é tratado como engano de digitação e ignorado. */
export const MAX_BUDGET_CENTS = 100_000;

export const TEXTO_FALHA_MODELO = 'Não consegui entender agora. Pode repetir o que você quer comer?';
export const TEXTO_PERGUNTA_ANOTADA = 'Anotei sua pergunta e vou levar em conta na proposta.';
/** Itens que uma pessoa pode pedir (wishes); o resto é ignorado. */
export const MAX_ITENS_POR_PESSOA = 3;
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

  const current: ParticipantPreferences = session.participants.find((p) => p.id === message.participantId)?.preferences ?? {};

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
    return { session, actions: [mensagemPrivada(session, message.participantId, TEXTO_FALHA_MODELO)], outcome: 'model_failed' };
  }

  return aplicarSaidaColeta(session, message.participantId, text, output, displayName);
}

/**
 * Aplica a interpretação do modelo para UMA pessoa: atualiza só as
 * preferências dela, guarda perguntas, devolve pergunta de esclarecimento.
 * Usada pela coleta individual e pela coleta em lote.
 */
function aplicarSaidaColeta(
  session: CoreSession,
  participantId: ParticipantId,
  text: string,
  output: ColetaOutput,
  displayName: string | undefined,
): ColetaResult {
  const existing = session.participants.find((p) => p.id === participantId);
  const current: ParticipantPreferences = existing?.preferences ?? {};

  switch (output.kind) {
    case 'irrelevant':
      return { session, actions: [], outcome: 'irrelevant' };
    case 'question': {
      const pending = session.pendingQuestions ?? [];
      const doParticipante = pending.filter((q) => q.participantId === participantId).length;
      const next: CoreSession =
        doParticipante < MAX_PENDING_QUESTIONS_PER_PARTICIPANT
          ? { ...session, pendingQuestions: [...pending, { participantId, text }] }
          : session;
      return { session: next, actions: [mensagemPrivada(session, participantId, TEXTO_PERGUNTA_ANOTADA)], outcome: 'question' };
    }
    case 'ambiguous':
      return {
        session,
        actions: [mensagemPrivada(session, participantId, output.clarification ?? TEXTO_FALHA_MODELO)],
        outcome: 'clarification',
      };
    case 'preference': {
      const preferences: ParticipantPreferences = {
        foodPreferences: limparLista(output.foodPreferences),
        dietaryRestrictions: limparLista(output.dietaryRestrictions),
        avoids: limparLista(output.avoids),
        wishes: limparLista(output.wishes).slice(0, MAX_ITENS_POR_PESSOA),
      };
      const quantities = quantidadesDaMensagem(text, preferences.wishes!, current);
      if (!quantities) return { session, outcome: 'clarification', actions: [mensagemPrivada(session, participantId, 'Qual a quantidade de cada item? Informe um número inteiro de 1 a 10.')] };
      if (quantities.some(n => n !== 1)) preferences.wishQuantities = quantities;
      const budgetCents = output.budgetText ? extrairOrcamentoCents(output.budgetText) : current.budgetCents;
      if (budgetCents !== undefined) preferences.budgetCents = budgetCents;

      const participant: Participant = {
        id: participantId,
        displayName: existing?.displayName ?? displayName ?? participantId,
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

function mensagemPrivada(session: CoreSession, participantId: ParticipantId, text: string): CoreAction {
  return { type: 'send_message', sessionId: session.id, participantId, text };
}

// ---------------------------------------------------------------------------
// Coleta em lote
// ---------------------------------------------------------------------------

/** Pessoas por chamada ao modelo; lotes maiores viram mais de uma chamada. */
export const MAX_PARTICIPANTES_POR_CHAMADA = 10;

export interface ItemLote {
  participantId: ParticipantId;
  text: string;
  displayName?: string;
}

export interface ResultadoLote {
  participantId: ParticipantId;
  outcome: ColetaOutcome;
}

export interface ColetaLoteResult {
  session: CoreSession;
  actions: CoreAction[];
  /** Um por pessoa do lote, na ordem da primeira mensagem dela. */
  resultados: ResultadoLote[];
}

/**
 * Coleta em lote: várias mensagens quase simultâneas numa única chamada ao
 * modelo (até MAX_PARTICIPANTES_POR_CHAMADA pessoas por chamada). Mensagens
 * da mesma pessoa são juntadas em ordem. Cada resultado só altera a pessoa
 * dele, com as mesmas regras da coleta individual. Se o modelo falhar, cada
 * pessoa do trecho recebe a mensagem de fallback. Um único session_updated
 * no fim, com o estado final.
 */
export async function coletarLote(
  session: CoreSession,
  itens: readonly ItemLote[],
  deps: ColetaDeps,
): Promise<ColetaLoteResult> {
  if (session.status !== 'collecting') {
    throw new Error(`coleta só é possível na fase collecting; a sessão está em ${session.status}`);
  }

  // Agrupa por pessoa, na ordem da primeira mensagem; filtro barato por mensagem.
  const porPessoa = new Map<ParticipantId, { textos: string[]; displayName?: string }>();
  for (const item of itens) {
    const entrada = porPessoa.get(item.participantId) ?? { textos: [] };
    if (item.displayName !== undefined) entrada.displayName = item.displayName;
    const text = item.text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (passaNoFiltro(text)) entrada.textos.push(text);
    porPessoa.set(item.participantId, entrada);
  }

  const resultados: ResultadoLote[] = [];
  const actions: CoreAction[] = [];
  let atual = session;

  const comTexto = [...porPessoa].filter(([id, entrada]) => {
    if (entrada.textos.length > 0) return true;
    resultados.push({ participantId: id, outcome: 'filtered' });
    return false;
  });

  for (let i = 0; i < comTexto.length; i += MAX_PARTICIPANTES_POR_CHAMADA) {
    const trecho = comTexto.slice(i, i + MAX_PARTICIPANTES_POR_CHAMADA);
    const ids = trecho.map(([id]) => id);

    let output;
    try {
      output = await gerarEstruturado({
        llm: deps.llm,
        phase: 'coleta_lote',
        tier: 'fast',
        system: SISTEMA_COLETA_LOTE,
        prompt: montarPromptColetaLote(
          trecho.map(([id, entrada]) => ({
            participantId: id,
            mensagens: entrada.textos,
            atuais: atual.participants.find((p) => p.id === id)?.preferences ?? {},
          })),
        ),
        outputName: 'coleta_lote',
        schema: criarColetaLoteSchema(ids),
        ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
        ...(deps.registrar && { registrar: deps.registrar }),
      });
    } catch (error) {
      if (!(error instanceof LlmSaidaInvalidaError)) throw error;
      for (const id of ids) {
        resultados.push({ participantId: id, outcome: 'model_failed' });
        actions.push(mensagemPrivada(atual, id, TEXTO_FALHA_MODELO));
      }
      continue;
    }

    for (const [id, entrada] of trecho) {
      const saida = output.resultados.find((r) => r.participantId === id);
      if (!saida) continue; // o schema garante um resultado por pessoa
      const campos: ColetaOutput = {
        kind: saida.kind,
        foodPreferences: saida.foodPreferences,
        dietaryRestrictions: saida.dietaryRestrictions,
        avoids: saida.avoids,
        wishes: saida.wishes,
        budgetText: saida.budgetText,
        clarification: saida.clarification,
      };
      const r = aplicarSaidaColeta(atual, id, entrada.textos.join('\n'), campos, entrada.displayName);
      atual = r.session;
      resultados.push({ participantId: id, outcome: r.outcome });
      actions.push(...r.actions.filter((a) => a.type !== 'session_updated'));
    }
  }

  if (atual !== session) actions.push({ type: 'session_updated', session: atual });
  const ordem = [...porPessoa.keys()];
  resultados.sort((a, b) => ordem.indexOf(a.participantId) - ordem.indexOf(b.participantId));
  return { session: atual, actions, resultados };
}
