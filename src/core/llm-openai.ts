import type { LlmPort, LlmRequest, LlmTier } from './ports.js';

/** Modos de saída estruturada, do mais forte para o mais simples. */
export type ResponseMode = 'json_schema' | 'json_object' | 'none';
const MODOS: readonly ResponseMode[] = ['json_schema', 'json_object', 'none'];

export interface OpenAiCompatOptions {
  /** Ex.: https://generativelanguage.googleapis.com/v1beta/openai (sem /chat/completions). */
  baseUrl: string;
  apiKey?: string;
  models: Record<LlmTier, string>;
  /** Injetável para testes; padrão: fetch global. */
  fetch?: typeof fetch;
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

  const tryAgain = /(?:try again|retry) in (?:(\d+)m)?(\d+(?:\.\d+)?)(ms|s)\b/i.exec(body);
  if (tryAgain?.[2]) {
    const minutos = Number(tryAgain[1] ?? 0);
    const valor = Number(tryAgain[2]);
    return Math.ceil(minutos * 60_000 + (tryAgain[3] === 'ms' ? valor : valor * 1000));
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
 *
 * O schema também vai no prompt de sistema; a validação Zod fica no core.
 */
export class OpenAiCompatLlm implements LlmPort {
  private modeIndex = 0;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: OpenAiCompatOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? dormir;
  }

  get mode(): ResponseMode {
    return MODOS[this.modeIndex] ?? 'none';
  }

  async generate(request: LlmRequest): Promise<unknown> {
    const maxRetries = this.options.maxRateLimitRetries ?? 3;
    const maxWait = this.options.maxRateLimitWaitMs ?? 10_000;
    let rateLimitRetries = 0;

    for (;;) {
      const response = await this.post(request, this.mode);
      if (response.ok) {
        return extrairJson(await response.json());
      }
      const body = await response.text();
      const error = new LlmHttpError(response.status, body);
      if (error.fatal) throw error;

      if (error.kind === 'rate_limit' || error.kind === 'unavailable') {
        const espera = tempoDeEspera(response.headers, body) ?? 1000 * 2 ** rateLimitRetries;
        if (rateLimitRetries >= maxRetries || espera > maxWait) throw error;
        rateLimitRetries++;
        await this.sleep(espera, request.signal);
        continue;
      }

      const recusouFormato = (response.status === 400 || response.status === 422) && this.mode !== 'none';
      if (!recusouFormato) throw error;
      this.modeIndex++;
    }
  }

  private post(request: LlmRequest, mode: ResponseMode): Promise<Response> {
    const system = `${request.system}\n\nResponda SOMENTE com um objeto JSON válido que siga este JSON Schema, sem texto fora do JSON:\n${JSON.stringify(request.outputSchema)}`;
    const body: Record<string, unknown> = {
      model: this.options.models[request.tier],
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: request.prompt },
      ],
    };
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
export function extrairJson(data: unknown): unknown {
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('resposta do provedor sem choices[0].message.content em texto');
  }
  const semRaciocinio = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  const inicio = semRaciocinio.indexOf('{');
  const fim = semRaciocinio.lastIndexOf('}');
  if (inicio < 0 || fim < inicio) {
    throw new Error(`resposta sem objeto JSON: ${semRaciocinio.slice(0, 200)}`);
  }
  try {
    return JSON.parse(semRaciocinio.slice(inicio, fim + 1));
  } catch {
    throw new Error(`JSON inválido na resposta: ${semRaciocinio.slice(inicio, inicio + 200)}`);
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
