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
   * Tempo máximo de cada provedor antes de passar ao próximo. O último da fila
   * não tem limite próprio: vale o timeout de quem chamou. Padrão: 10 s.
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
  constructor(
    readonly tentativas: number,
    readonly ultimoErro: unknown,
    /** Todos falharam por chave, plano ou cota: tentar de novo não adianta. */
    readonly fatal: boolean,
  ) {
    const detalhe = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro);
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
 * sozinho depois. Se todos estiverem em pausa, tenta mesmo assim, do que volta
 * primeiro ao que volta por último.
 *
 * Saída fora do schema não é problema do provedor: a nova tentativa com
 * correção fica no gerarEstruturado, como sem a cascata.
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
    const pausados = indices
      .filter((i) => (this.pausadoAte[i] ?? 0) > agora)
      .sort((a, b) => (this.pausadoAte[a] ?? 0) - (this.pausadoAte[b] ?? 0));
    return [...livres, ...pausados];
  }

  async generate(request: LlmRequest): Promise<unknown> {
    const fila = this.fila();
    let ultimoErro: unknown;
    let todosFatais = true;

    for (const [posicao, indice] of fila.entries()) {
      const provedor = this.options.provedores[indice];
      if (!provedor) continue;
      const ultimo = posicao === fila.length - 1;
      const antes = usosDe(provedor.llm)?.length ?? 0;
      try {
        const resultado = await this.chamar(provedor.llm, request, ultimo);
        this.pausadoAte[indice] = 0;
        this.usos.push(...(usosDe(provedor.llm)?.slice(antes) ?? []));
        return resultado;
      } catch (error) {
        // Quem chamou desistiu (timeout total ou cancelamento): não segue a fila.
        if (request.signal?.aborted) throw error;
        ultimoErro = error;
        if (!erroFatal(error)) todosFatais = false;
        const motivo = motivoDe(error);
        const pausaMs = PAUSA_MS[motivo];
        if (pausaMs > 0) this.pausadoAte[indice] = this.now() + pausaMs;
        const proximo = this.options.provedores[fila[posicao + 1] ?? -1];
        const troca: TrocaDeProvedor = {
          tier: request.tier,
          de: provedor.nome,
          ...(proximo && { para: proximo.nome }),
          motivo,
          pausaMs,
        };
        this.trocas.push(troca);
        this.options.aoTrocar?.(troca);
      }
    }
    throw new CascataEsgotadaError(fila.length, ultimoErro, todosFatais);
  }

  /** Chama um provedor com timeout próprio (exceto o último), ligado ao sinal de quem chamou. */
  private async chamar(llm: LlmPort, request: LlmRequest, ultimo: boolean): Promise<unknown> {
    const controller = new AbortController();
    const repassar = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) throw request.signal.reason;
    request.signal?.addEventListener('abort', repassar, { once: true });

    const limiteMs = this.options.timeoutPorProvedorMs ?? 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tempoEsgotado = ultimo
      ? undefined
      : new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const erro = new TimeoutDoProvedor(limiteMs);
            controller.abort(erro);
            reject(erro);
          }, limiteMs);
        });
    try {
      const chamada = llm.generate({ ...request, signal: controller.signal });
      return await (tempoEsgotado ? Promise.race([chamada, tempoEsgotado]) : chamada);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', repassar);
    }
  }
}
