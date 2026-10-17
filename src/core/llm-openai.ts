import type { LlmPort, LlmRequest, LlmTier } from './ports.js';

/** Modos de saída estruturada, do mais forte para o mais simples. */
export type ResponseMode = 'json_schema' | 'json_object' | 'none';
const MODOS: readonly ResponseMode[] = ['json_schema', 'json_object', 'none'];

export interface OpenAiCompatOptions {
  /** Ex.: https://opencode.ai/inference/openai/v1 (sem /chat/completions). */
  baseUrl: string;
  apiKey?: string;
  models: Record<LlmTier, string>;
  /** Injetável para testes; padrão: fetch global. */
  fetch?: typeof fetch;
}

export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`provedor respondeu HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'LlmHttpError';
  }
}

/**
 * Adaptador para APIs compatíveis com OpenAI (/chat/completions), via fetch,
 * sem SDK. Tenta response_format json_schema; se o provedor recusar (HTTP 400
 * ou 422), cai para json_object e depois para nenhum, lembrando o modo que
 * funcionou. O schema também vai no prompt de sistema, e a validação Zod +
 * nova tentativa continua no core (gerarEstruturado).
 */
export class OpenAiCompatLlm implements LlmPort {
  private modeIndex = 0;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OpenAiCompatOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  get mode(): ResponseMode {
    return MODOS[this.modeIndex] ?? 'none';
  }

  async generate(request: LlmRequest): Promise<unknown> {
    for (;;) {
      const response = await this.post(request, this.mode);
      if (response.ok) {
        return extrairJson(await response.json());
      }
      const body = await response.text();
      const recusouFormato = (response.status === 400 || response.status === 422) && this.mode !== 'none';
      if (!recusouFormato) throw new LlmHttpError(response.status, body);
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
