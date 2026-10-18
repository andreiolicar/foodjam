import { erroFatal } from './llm.js';
import type { LlmErrorKind, UsoTokens } from './llm-openai.js';
import { LlmHttpError } from './llm-openai.js';
import type { LlmPort, LlmRequest, LlmTier } from './ports.js';

export interface ProvedorDaCascata {
  /** Nome para o registro (ex.: api.groq.com). */
  nome: string;
  llm: LlmPort;
}

/**
 * Por que um provedor foi pulado: tipo do erro HTTP, tempo esgotado, falha de
 * rede ou resposta sem JSON.
 */
export type MotivoTroca = LlmErrorKind | 'timeout' | 'rede' | 'resposta_invalida';

export interface TrocaDeProvedor {
  tier: LlmTier;
  de: string;
  /** Próximo provedor da fila; ausente quando não sobrou nenhum. */
  para?: string;
  motivo: MotivoTroca;
  /** Por quanto tempo o provedor que falhou vai para o fim da fila. */
  pausaMs: number;
}

export interface CascataOptions {
  /** Em ordem de preferência: o primeiro disponível atende. */
  provedores: readonly ProvedorDaCascata[];
  /**
   * Tempo máximo de cada provedor, incluindo o último. Padrão: 8 s;
   * o prazo total/cancelamento do chamador também prevalece.
   */
  timeoutPorProvedorMs?: number;
  /** Relógio em ms, injetável para testes. Padrão: Date.now. */
  now?: () => number;
  /** Avisado a cada provedor pulado (para o log). */
  aoTrocar?: (troca: TrocaDeProvedor) => void;
}

/** Quanto tempo o provedor que falhou fica no fim da fila, por motivo. */
const PAUSA_MS: Record<MotivoTroca, number> = {
  rate_limit: 60_000,
  plan_or_quota: 3_600_000,
  auth: 3_600_000,
  unavailable: 30_000,
  timeout: 30_000,
  rede: 30_000,
  other: 60_000,
  resposta_invalida: 0,
};

export class CascataEsgotadaError extends Error {
  /** A chamada já percorreu a fila; não repetir via gerarEstruturado. */
  readonly retryable = false;

  constructor(
    readonly tentativas: number,
    ultimoErro: unknown,
    /** Todos falharam por chave, plano ou cota: tentar de novo não adianta. */
    readonly fatal: boolean,
  ) {
    const detalhe = ultimoErro instanceof LlmHttpError ? `HTTP ${ultimoErro.status}` : 'indisponibilidade ou saída inválida';
    super(`nenhum dos ${tentativas} provedor(es) de IA respondeu; último erro: ${detalhe}`);
    this.name = 'CascataEsgotadaError';
  }
}

class TimeoutDoProvedor extends Error {
  constructor(ms: number) {
    super(`provedor não respondeu em ${ms} ms`);
    this.name = 'TimeoutDoProvedor';
  }
}

function motivoDe(error: unknown): MotivoTroca {
  if (error instanceof LlmHttpError) return error.kind;
  if (error instanceof TimeoutDoProvedor) return 'timeout';
  // fetch lança TypeError em falha de rede (DNS, conexão recusada, TLS).
  if (error instanceof TypeError) return 'rede';
  return 'resposta_invalida';
}

/** Uso de tokens do adaptador, quando ele registra (ex.: OpenAiCompatLlm). */
function usosDe(llm: LlmPort): readonly UsoTokens[] | undefined {
  const usos = (llm as { usos?: unknown }).usos;
  return Array.isArray(usos) ? (usos as UsoTokens[]) : undefined;
}

/**
 * LlmPort que empilha vários provedores: tenta o primeiro disponível e, se ele
 * falhar (429, 5xx, timeout, rede, chave ou cota), passa ao próximo na hora.
 * O provedor que falhou vai para o fim da fila por um tempo (PAUSA_MS) e volta
 * sozinho depois. Provedores em cooldown não recebem chamadas.
 * Saída fora do schema Zod também permite tentar o próximo provedor.
 */
export class LlmEmCascata implements LlmPort {
  /** Uso de tokens das respostas, na ordem em que chegaram. */
  readonly usos: UsoTokens[] = [];
  /** Provedores pulados, para o registro e o documento técnico. */
  readonly trocas: TrocaDeProvedor[] = [];
  private readonly pausadoAte: number[];
  private readonly now: () => number;

  constructor(private readonly options: CascataOptions) {
    if (options.provedores.length === 0) throw new Error('a cascata precisa de pelo menos um provedor');
    this.pausadoAte = options.provedores.map(() => 0);
    this.now = options.now ?? Date.now;
  }

  get nomes(): string[] {
    return this.options.provedores.map((p) => p.nome);
  }

  /** Índices na ordem em que a próxima chamada vai tentar. */
  fila(): number[] {
    const agora = this.now();
    const indices = this.options.provedores.map((_, i) => i);
    const livres = indices.filter((i) => (this.pausadoAte[i] ?? 0) <= agora);
    return livres;
  }

  async generate(request: LlmRequest): Promise<unknown> {
    if (request.signal?.aborted) throw request.signal.reason;
    const fila = this.fila();
    let ultimoErro: unknown;
    let todosFatais = true;

    for (const [posicao, indice] of fila.entries()) {
      const provedor = this.options.provedores[indice];
      if (!provedor || (this.pausadoAte[indice] ?? 0) > this.now()) continue;
      if (request.signal?.aborted) throw request.signal.reason;
      const antes = usosDe(provedor.llm)?.length ?? 0;
      try {
        const resultado = await this.chamar(provedor.llm, request);
        if (request.validateOutput && !request.validateOutput(resultado)) throw new Error('saída incompatível com schema');
        this.usos.push(...(usosDe(provedor.llm)?.slice(antes) ?? []));
        return resultado;
      } catch (error) {
        // Quem chamou desistiu (timeout total ou cancelamento): não segue a fila.
        if (request.signal?.aborted) throw error;
        ultimoErro = error;
        if (!erroFatal(error)) todosFatais = false;
        const motivo = motivoDe(error);
        const pausaMs = Math.max(PAUSA_MS[motivo], error instanceof LlmHttpError ? error.retryAfterMs ?? 0 : 0);
        if (pausaMs > 0) this.pausadoAte[indice] = Math.max(this.pausadoAte[indice] ?? 0, this.now() + pausaMs);
        const proximo = this.options.provedores[fila[posicao + 1] ?? -1];
        const troca: TrocaDeProvedor = {
          tier: request.tier,
          de: provedor.nome,
          ...(proximo && { para: proximo.nome }),
          motivo,
          pausaMs,
        };
        this.trocas.push(troca);
        try { this.options.aoTrocar?.(troca); } catch { /* Diagnóstico não interfere na recuperação. */ }
      }
    }
    throw new CascataEsgotadaError(fila.length, ultimoErro, todosFatais);
  }

  /** Prazo por provedor e cancelamento também encerram transportes que ignoram o sinal. */
  private async chamar(llm: LlmPort, request: LlmRequest): Promise<unknown> {
    const controller = new AbortController();
    const limiteMs = this.options.timeoutPorProvedorMs ?? 8_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let repassar = () => {};
    const interrompido = new Promise<never>((_, reject) => {
      repassar = () => {
        const erro = request.signal?.reason ?? new Error('requisição cancelada');
        controller.abort(erro); reject(erro);
      };
      if (request.signal?.aborted) { repassar(); return; }
      request.signal?.addEventListener('abort', repassar, {once: true});
      timer = setTimeout(() => {
        const erro = new TimeoutDoProvedor(limiteMs);
        controller.abort(erro); reject(erro);
      }, limiteMs);
    });
    try {
      return await Promise.race([llm.generate({...request, signal: controller.signal}), interrompido]);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', repassar);
    }
  }
}
