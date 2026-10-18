import type { Agente, Resposta } from './agente.js';
import type { ItemLote } from './coleta.js';
import type { IncomingMessage, SessionId } from './contracts.js';

export interface AgrupadorOptions {
  /** Espera sem mensagens novas antes de enviar o lote (debounce). Padrão: 2.000 ms. */
  esperaMs?: number;
  /** Espera máxima desde a primeira mensagem do lote, mesmo com mensagens chegando. Padrão: 6.000 ms. */
  esperaMaxMs?: number;
  /** Envia na hora ao juntar este número de mensagens. Padrão: 10. */
  maxLote?: number;
  /** Recebe o resultado de cada lote: o bot envia as actions e reage aos resultados. */
  aoResponder: (sessionId: SessionId, resposta: Resposta) => void | Promise<void>;
  /** Erro ao responder (o lote em si nunca lança: o agente devolve outcome). */
  onError?: (error: unknown) => void;
}

export interface Agrupador {
  /** Guarda a mensagem para o próximo lote do chat. Não espera o modelo. */
  adicionar(message: IncomingMessage, displayName?: string): void;
  /** Envia já o lote pendente do chat (use antes de propor, fechar ou cancelar). */
  esvaziar(sessionId: SessionId): Promise<void>;
  /** Envia todos os lotes pendentes (ex.: ao desligar o bot). */
  esvaziarTudo(): Promise<void>;
  /** Mensagens aguardando no lote do chat. */
  pendentes(sessionId: SessionId): number;
}

interface Pendente {
  itens: ItemLote[];
  primeiraEm: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Junta mensagens quase simultâneas do mesmo chat e as envia ao agente como
 * um lote (agente.mensagens), para 10 pessoas falando juntas virarem uma
 * chamada ao modelo em vez de dez. Chats diferentes têm lotes separados.
 */
export function criarAgrupador(agente: Agente, options: AgrupadorOptions): Agrupador {
  const esperaMs = options.esperaMs ?? 2_000;
  const esperaMaxMs = options.esperaMaxMs ?? 6_000;
  const maxLote = options.maxLote ?? 10;
  const pendentes = new Map<SessionId, Pendente>();

  async function enviar(sessionId: SessionId): Promise<void> {
    const pendente = pendentes.get(sessionId);
    if (!pendente) return;
    clearTimeout(pendente.timer);
    pendentes.delete(sessionId);

    const resposta = await agente.mensagens(sessionId, pendente.itens);
    try {
      await options.aoResponder(sessionId, resposta);
    } catch (error) {
      options.onError?.(error);
    }
  }

  return {
    adicionar(message, displayName) {
      const agora = Date.now();
      const pendente = pendentes.get(message.sessionId) ?? { itens: [], primeiraEm: agora, timer: undefined };
      pendente.itens.push({
        participantId: message.participantId,
        text: message.text,
        ...(displayName !== undefined && { displayName }),
      });
      pendentes.set(message.sessionId, pendente);

      clearTimeout(pendente.timer);
      if (pendente.itens.length >= maxLote) {
        void enviar(message.sessionId);
        return;
      }
      const restanteMax = Math.max(0, pendente.primeiraEm + esperaMaxMs - agora);
      pendente.timer = setTimeout(() => void enviar(message.sessionId), Math.min(esperaMs, restanteMax));
    },
    esvaziar: (sessionId) => enviar(sessionId),
    esvaziarTudo: async () => {
      await Promise.all([...pendentes.keys()].map((id) => enviar(id)));
    },
    pendentes: (sessionId) => pendentes.get(sessionId)?.itens.length ?? 0,
  };
}
