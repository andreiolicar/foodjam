import type { LlmPort, LlmRequest, LlmTier } from './ports.js';

/** Modos de saída estruturada, do mais forte para o mais simples. */
export type ResponseMode = 'json_schema' | 'json_object' | 'none';
const MODOS: readonly ResponseMode[] = ['json_schema', 'json_object', 'none'];

export interface OpenAiCompatOptions {
  /** Compatibilidade por modelo: não muda o modelo nem a validação Zod do Core. */
  initialResponseModes?: Readonly<Partial<Record<string, ResponseMode>>>;
  /** Ex.: https://generativelanguage.googleapis.com/v1beta/openai (sem /chat/completions). */
  baseUrl: string;
  apiKey?: string;
  models: Record<LlmTier, string>;
  /**
   * Modelo reserva por nível, usado quando o principal responde 429 (cota por
   * minuto ou por dia). O principal fica de lado pelo tempo pedido pelo
   * provedor (padrão: 1 min; 1 h para cota diária). Use um modelo com cota separada.
   */
  fallbacks?: Partial<Record<LlmTier, string>>;
  /**
   * reasoning_effort por nível (modelos de raciocínio, ex.: gpt-oss na Groq).
   * Ausente = não envia (padrão do provedor).
   */
  reasoningEffort?: Partial<Record<LlmTier, ReasoningEffort>>;
  /** Injetável para testes; padrão: fetch global. */
  fetch?: typeof fetch;
  /** Relógio em ms, injetável para testes. Padrão: Date.now. */
  now?: () => number;
  /** Novas tentativas em 429 de limite por minuto. Padrão: 3. */
  maxRateLimitRetries?: number;
  /** Espera máxima aceitável num 429; se o provedor pedir mais, desiste. Padrão: 10 s. */
  maxRateLimitWaitMs?: number;
  /** Injetável para testes; padrão: setTimeout que respeita o AbortSignal. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Tipo do erro HTTP do provedor:
 * - auth: chave ausente, inválida ou sem permissão (401, 403, "API key not valid").
 * - plan_or_quota: plano/cobrança (402, FreeTier) ou cota diária esgotada.
 * - rate_limit: limite por minuto (429 comum), resolve esperando.
 * - unavailable: provedor sobrecarregado (502, 503, 504), resolve esperando.
 * - other: demais erros.
 * auth e plan_or_quota são fatais: tentar de novo não adianta.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';
export const ESFORCOS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

export interface UsoTokens {
  tier: LlmTier;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Parte de completionTokens gasta em raciocínio (modelos como gpt-oss). */
  reasoningTokens: number;
  totalTokens: number;
}

export interface TrocaDeModelo {
  tier: LlmTier;
  de: string;
  para: string;
  motivo: LlmErrorKind;
  /** Por quanto tempo o principal fica de lado. */
  esperaMs: number;
}

export type LlmErrorKind = 'auth' | 'plan_or_quota' | 'rate_limit' | 'unavailable' | 'other';

export class LlmHttpError extends Error {
  readonly kind: LlmErrorKind;
  /** Mensagem do provedor (corpo da resposta), sem a chave. */
  readonly providerMessage: string;

  constructor(
    readonly status: number,
    body: string,
  ) {
    const providerMessage = body.replace(/\s+/g, ' ').trim().slice(0, 1000);
    super(`provedor respondeu HTTP ${status}: ${providerMessage}`);
    this.name = 'LlmHttpError';
    this.kind = classificarErro(status, body);
    this.providerMessage = providerMessage;
  }

  /** Erro que não melhora com nova tentativa (lido por gerarEstruturado). */
  get fatal(): boolean {
    return this.kind === 'auth' || this.kind === 'plan_or_quota';
  }
}

const CHAVE_INVALIDA = /api[ _-]?key not valid|API_KEY_INVALID|invalid api key|invalid_api_key|unauthenticated/i;
const PLANO = /free ?tier|freetiererror|billing|payment|insufficient_quota|credit/i;
const COTA_DIARIA = /per ?day|perday|daily|requests per day|tokens per day|\bRPD\b|\bTPD\b/i;

export function classificarErro(status: number, body: string): LlmErrorKind {
  if (status === 401 || CHAVE_INVALIDA.test(body)) return 'auth';
  if (status === 402) return 'plan_or_quota';
  if (status === 403) return PLANO.test(body) ? 'plan_or_quota' : 'auth';
  if (status === 429) {
    // O Gemini cita "plan and billing" até no limite por minuto: o que decide é o quotaId.
    if (/PerMinute|per ?minute|\bRPM\b|\bTPM\b/i.test(body)) return 'rate_limit';
    return COTA_DIARIA.test(body) || /insufficient_quota/i.test(body) ? 'plan_or_quota' : 'rate_limit';
  }
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'other';
}

/**
 * Quanto esperar num 429, em ms: header Retry-After, "retryDelay": "23s"
 * (Gemini) ou "try again in 1m2.5s" / "in 450ms" (Groq/OpenAI).
 */
export function tempoDeEspera(headers: Headers, body: string): number | undefined {
  const header = headers.get('retry-after');
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header) * 1000);

  const retryDelay = /retry_?delay"?\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(body);
  if (retryDelay?.[1]) return Math.ceil(Number(retryDelay[1]) * 1000);

  // "in 1.5s", "in 450ms", "in 2m3.5s", "in 7h12m0.5s", "in 3h2m"
  const tryAgain = /(?:try again|retry) in ((?:\d+h)?(?:\d+m(?!s))?(?:\d+(?:\.\d+)?(?:ms|s))?)/i.exec(body)?.[1];
  if (tryAgain) {
    const parte = (re: RegExp) => Number(re.exec(tryAgain)?.[1] ?? 0);
    const ms =
      parte(/(\d+)h/) * 3_600_000 +
      parte(/(\d+)m(?!s)/) * 60_000 +
      parte(/(\d+(?:\.\d+)?)s/) * 1000 +
      parte(/(\d+(?:\.\d+)?)ms/);
    if (ms > 0) return Math.ceil(ms);
  }
  return undefined;
}

const dormir = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/**
 * Adaptador para APIs compatíveis com OpenAI (/chat/completions), via fetch,
 * sem SDK. Funciona com Gemini (AI Studio), Groq, OpenAI, OpenRouter, Ollama...
 *
 * - Formato: tenta response_format json_schema; se o provedor recusar (400/422),
 *   cai para json_object e depois para nenhum, lembrando o modo que funcionou.
 * - 429 por minuto e 502/503/504: espera (Retry-After/retryDelay ou 1 s, 2 s, 4 s) e tenta de novo.
 * - Chave, plano ou cota diária: LlmHttpError fatal, sem nova tentativa.
 * - Com modelo reserva no nível: 429 do principal troca para o reserva na hora.
 *
 * O schema também vai no prompt de sistema; a validação Zod fica no core.
 */
export class OpenAiCompatLlm implements LlmPort {
  /** Uso de tokens de cada resposta bem-sucedida, como o provedor informou. */
  readonly usos: UsoTokens[] = [];
  /** Trocas para o modelo reserva, para o registro e o documento técnico. */
  readonly trocas: TrocaDeModelo[] = [];
  /** Índice em MODOS por modelo: cada modelo pode aceitar um formato diferente. */
  private readonly modeIndex = new Map<string, number>();
  /** Até quando (ms) cada modelo principal fica de lado depois de um 429. */
  private readonly bloqueadoAte = new Map<string, number>();
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: OpenAiCompatOptions) {
    for (const [model, mode] of Object.entries(options.initialResponseModes ?? {})) {
      if (mode !== undefined) this.modeIndex.set(model, MODOS.indexOf(mode));
    }
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? dormir;
    this.now = options.now ?? Date.now;
  }

  /** Modo de saída estruturada em uso no modelo fast principal. */
  get mode(): ResponseMode {
    return this.modoDe(this.options.models.fast);
  }

  modoDe(model: string): ResponseMode {
    return MODOS[this.modeIndex.get(model) ?? 0] ?? 'none';
  }

  /** Modelo que a próxima chamada do nível vai usar (o reserva, se o principal estiver em espera). */
  modeloAtual(tier: LlmTier): string {
    const principal = this.options.models[tier];
    const reserva = this.options.fallbacks?.[tier];
    return reserva && (this.bloqueadoAte.get(principal) ?? 0) > this.now() ? reserva : principal;
  }

  async generate(request: LlmRequest): Promise<unknown> {
    const maxRetries = this.options.maxRateLimitRetries ?? 3;
    const maxWait = this.options.maxRateLimitWaitMs ?? 10_000;
    const principal = this.options.models[request.tier];
    const reserva = this.options.fallbacks?.[request.tier];
    let model = this.modeloAtual(request.tier);
    let rateLimitRetries = 0;

    for (;;) {
      const response = await this.post(request, model);
      if (response.ok) {
        const data = (await response.json()) as unknown;
        this.registrarUso(request.tier, model, data);
        return extrairJson(data);
      }
      const body = await response.text();
      const error = new LlmHttpError(response.status, body);

      // 429 no principal (cota por minuto ou por dia) com reserva configurado: troca na hora.
      if (response.status === 429 && reserva && model === principal) {
        const espera = tempoDeEspera(response.headers, body) ?? (error.kind === 'plan_or_quota' ? 3_600_000 : 60_000);
        this.bloqueadoAte.set(principal, this.now() + espera);
        this.trocas.push({ tier: request.tier, de: principal, para: reserva, motivo: error.kind, esperaMs: espera });
        model = reserva;
        continue;
      }
      if (error.fatal) throw error;

      if (error.kind === 'rate_limit' || error.kind === 'unavailable') {
        const espera = tempoDeEspera(response.headers, body) ?? 1000 * 2 ** rateLimitRetries;
        if (rateLimitRetries >= maxRetries || espera > maxWait) throw error;
        rateLimitRetries++;
        await this.sleep(espera, request.signal);
        continue;
      }

      const recusouFormato = (response.status === 400 || response.status === 422) && this.modoDe(model) !== 'none'
        && !/json_validate_failed|schema_validation_failed/i.test(body)
        && /response_format|json_schema|json_object/i.test(body)
        && /not supported|unsupported|does not support|not available|unrecognized|unknown parameter/i.test(body);
      if (!recusouFormato) throw error;
      this.modeIndex.set(model, (this.modeIndex.get(model) ?? 0) + 1);
    }
  }

  private registrarUso(tier: LlmTier, model: string, data: unknown): void {
    const u = (data as { usage?: Record<string, unknown>; model?: unknown })?.usage;
    if (!u) return;
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    const detalhes = u.completion_tokens_details as { reasoning_tokens?: unknown } | undefined;
    this.usos.push({
      tier,
      model,
      promptTokens: n(u.prompt_tokens),
      completionTokens: n(u.completion_tokens),
      reasoningTokens: n(detalhes?.reasoning_tokens),
      totalTokens: n(u.total_tokens),
    });
  }

  private post(request: LlmRequest, model: string): Promise<Response> {
    const mode = this.modoDe(model);
    // Em json_schema o provedor já recebe o schema no response_format: repetir no
    // prompt só gasta tokens. Nos outros modos, o schema vai no prompt de sistema.
    const system =
      mode === 'json_schema'
        ? `${request.system}\n\nResponda SOMENTE com JSON no formato pedido.`
        : `${request.system}\n\nResponda SOMENTE com um objeto JSON válido que siga este JSON Schema, sem texto fora do JSON:\n${JSON.stringify(request.outputSchema)}`;
    const body: Record<string, unknown> = {
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: request.prompt },
      ],
    };
    const esforco = this.options.reasoningEffort?.[request.tier];
    if (esforco) body.reasoning_effort = esforco;
    if (mode === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: request.outputName, schema: request.outputSchema, strict: false },
      };
    } else if (mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;

    return this.fetchFn(`${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(request.signal && { signal: request.signal }),
    });
  }
}

/**
 * Lê choices[0].message.content e extrai o JSON. Tolera cercas ```json e
 * texto de raciocínio antes do objeto (comum em modelos com "thinking").
 */
export class LlmOutputError extends Error {
  constructor(readonly code: 'missing_content' | 'missing_json_object' | 'invalid_json') { super(`Saída do modelo inválida: ${code}.`); this.name = 'LlmOutputError'; }
}
export function extrairJson(data: unknown): unknown {
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new LlmOutputError('missing_content');
  }
  const semRaciocinio = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  const inicio = semRaciocinio.indexOf('{');
  const fim = semRaciocinio.lastIndexOf('}');
  if (inicio < 0 || fim < inicio) {
    throw new LlmOutputError('missing_json_object');
  }
  try {
    return JSON.parse(semRaciocinio.slice(inicio, fim + 1));
  } catch {
    throw new LlmOutputError('invalid_json');
  }
}

export interface ListarModelosOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

/** Modelo como o provedor descreve em /models (campos extras variam por provedor). */
export interface ModeloInfo {
  id: string;
  ownedBy?: string;
  contextWindow?: number;
  maxCompletionTokens?: number;
  active?: boolean;
}

export interface ConsultaModelos {
  modelos: ModeloInfo[];
  /** Cabeçalhos de limite da resposta (x-ratelimit-*, retry-after), quando o provedor envia. */
  limites: Record<string, string>;
}

/**
 * GET {baseUrl}/models: modelos em ordem alfabética, sem repetição, com os
 * campos que o provedor informar, e os cabeçalhos de limite. Aceita
 * { data: [...] } (formato OpenAI) ou lista direta. Erros não expõem a chave.
 */
export async function consultarModelos(options: ListarModelosOptions): Promise<ConsultaModelos> {
  const headers: Record<string, string> = {};
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  const response = await (options.fetch ?? fetch)(`${options.baseUrl.replace(/\/+$/, '')}/models`, { headers });
  if (!response.ok) throw new LlmHttpError(response.status, await response.text());

  const limites: Record<string, string> = {};
  response.headers.forEach((valor, nome) => {
    if (/^x-ratelimit|^retry-after$/i.test(nome)) limites[nome.toLowerCase()] = valor;
  });

  const body = (await response.json()) as unknown;
  const lista = Array.isArray(body) ? body : (body as { data?: unknown })?.data;
  if (!Array.isArray(lista)) {
    throw new Error('resposta de /models sem lista de modelos (esperado { data: [{ id }] })');
  }

  const porId = new Map<string, ModeloInfo>();
  for (const item of lista) {
    const m = item as Record<string, unknown>;
    if (typeof m?.id !== 'string' || !m.id || porId.has(m.id)) continue;
    const info: ModeloInfo = { id: m.id };
    if (typeof m.owned_by === 'string') info.ownedBy = m.owned_by;
    if (typeof m.context_window === 'number') info.contextWindow = m.context_window;
    if (typeof m.max_completion_tokens === 'number') info.maxCompletionTokens = m.max_completion_tokens;
    if (typeof m.active === 'boolean') info.active = m.active;
    porId.set(m.id, info);
  }
  return { modelos: [...porId.values()].sort((a, b) => a.id.localeCompare(b.id)), limites };
}

/** Só os ids, em ordem alfabética, para escolher AI_MODEL com o nome exato. */
export async function listarModelos(options: ListarModelosOptions): Promise<string[]> {
  return (await consultarModelos(options)).modelos.map((m) => m.id);
}
