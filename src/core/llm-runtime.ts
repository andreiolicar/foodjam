import { AsyncLocalStorage } from 'node:async_hooks';
import { criarLlmDoAmbiente, temProvedorReal } from './llm-ambiente.js';
import type { LlmEnv } from './llm-ambiente.js';
import type { LlmPort, LlmTier } from './ports.js';
import { extrairJson, LlmOutputError, LlmHttpError, tempoDeEspera } from './llm-openai.js';
import { rateEvidence } from './llm-http-evidence.js';

type HttpEvent = ReturnType<typeof rateEvidence> & { phase: string; tier: LlmTier; model: string; at: string; provider: 'groq' | 'gemini' | 'openrouter' | 'other'; nextAttemptAt?: string;
  requestChars: number; responseMode: 'json_schema' | 'json_object' | 'none';
  jsonState?: 'valid_json' | 'missing_content' | 'missing_json_object' | 'invalid_json' | 'invalid_envelope';
  providerErrorCode?: string; promptTokens?: number; completionTokens?: number; totalTokens?: number;
};

/** Corpo de erro limitado em bytes e tempo; cancelamento não aguarda rede. */
async function corpoDeErro(response: Response, signal: AbortSignal | null | undefined, limiteMs: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelar = () => {};
  const limite = new Promise<string>((resolve, reject) => {
    cancelar = () => reject(signal?.reason ?? new Error('requisição cancelada'));
    if (signal?.aborted) { cancelar(); return; }
    signal?.addEventListener('abort', cancelar, {once:true});
    timer = setTimeout(() => resolve(''), limiteMs);
  });
  const leitura = async () => {
    let text = ''; let bytes = 0;
    while (bytes < 8192) {
      const {value, done} = await reader.read();
      if (done) break;
      const parte = value.subarray(0, 8192 - bytes); bytes += parte.length;
      text += decoder.decode(parte, {stream:true});
    }
    return text + decoder.decode();
  };
  try { return await Promise.race([leitura(), limite]); }
  catch (error) { if (signal?.aborted) throw error; return ''; }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancelar);
    void reader.cancel().catch(() => undefined);
  }
}

/** Observa a fábrica/cascata do Core; não bloqueia reservas independentes. */
export function criarLlmObservado(env: LlmEnv, deps: { fetch?: typeof fetch; now?: () => number; onHttp?: (event: Readonly<HttpEvent>) => void } = {}) {
  if (!temProvedorReal(env) || env.AI_PROVIDER?.trim().toLowerCase() !== 'openai-compat') throw new Error('IA real obrigatória.');
  const expectedHosts = ['api.groq.com', 'generativelanguage.googleapis.com', 'openrouter.ai'];
  const providers: string[] = [];
  for (let i = 0; i < expectedHosts.length; i++) {
    const prefix = i === 0 ? 'AI_' : `AI_${i + 1}_`;
    if (i > 0 && !env[`${prefix}BASE_URL`]?.trim()) {
      if (Object.entries(env).some(([key, value]) => key.startsWith(prefix) && value?.trim())) throw new Error('Configuração da cascata incompleta.');
      continue;
    }
    try {
      const url = new URL(env[`${prefix}BASE_URL`]!);
      if (url.hostname !== expectedHosts[i] || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || !env[`${prefix}API_KEY`]?.trim() || (i === 2 && !env.AI_2_BASE_URL?.trim())) throw new Error();
    } catch { throw new Error('Configuração da cascata inválida: use Groq → Gemini → OpenRouter com credenciais próprias.'); }
    providers.push(['groq', 'gemini', 'openrouter'][i]!);
  }
  if (Object.entries(env).some(([key, value]) => /^AI_[4-9]_BASE_URL$/.test(key) && value?.trim())) throw new Error('Configuração da cascata: provedores extras não aprovados nesta composição.');
  const http: HttpEvent[] = [];
  const now = deps.now ?? Date.now; const network = deps.fetch ?? fetch;
  const context = new AsyncLocalStorage<{ phase: string; tier: LlmTier; starts: Map<string, number> }>();
  const observed: typeof fetch = async (url, init) => {
    const current = context.getStore()!;
    const host = new URL(String(url)).hostname;
    const started = current.starts.get(host) ?? performance.now(); current.starts.set(host, started);
    const response = await network(url, init);
    const limited = response.status === 429 || response.status >= 500;
    const remaining = Number(env.AI_TIMEOUT_POR_PROVEDOR_MS ?? 8000) - (performance.now() - started);
    const body = response.ok || remaining <= 4 ? '' : await corpoDeErro(response, init?.signal, Math.min(1000, remaining / 2));
    if (!response.ok && remaining <= 4) void response.body?.cancel().catch(() => undefined);
    const evidence = rateEvidence(response.status, response.headers, body, now());
    const at = now();
    let model = 'unknown'; let responseMode: HttpEvent['responseMode'] = 'none';
    try {
      const parsed = JSON.parse(String(init?.body)) as { model?: unknown; response_format?: { type?: unknown } };
      if (parsed.response_format?.type === 'json_schema' || parsed.response_format?.type === 'json_object') responseMode = parsed.response_format.type;
      if (typeof parsed.model === 'string' && /^[A-Za-z0-9_./:-]{1,120}$/.test(parsed.model)) model = parsed.model;
    } catch { /* Não registrar requisição nem prompt. */ }
    const retryAt = limited && evidence.retryAfterMs !== undefined ? at + evidence.retryAfterMs : undefined;
    const provider = host === 'api.groq.com' ? 'groq' : host === 'generativelanguage.googleapis.com' ? 'gemini' : host === 'openrouter.ai' ? 'openrouter' : 'other';
    const event: HttpEvent = { ...evidence, phase: current.phase, tier: current.tier, provider, model, requestChars: String(init?.body ?? '').length, responseMode, at: new Date(at).toISOString(), ...(retryAt !== undefined && Number.isFinite(retryAt) ? { nextAttemptAt: new Date(retryAt).toISOString() } : {}) };
    if (response.ok) {
      try {
        const data = await response.clone().json() as { usage?: Record<string, unknown> };
        const n = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
        for (const [source, target] of [['prompt_tokens', 'promptTokens'], ['completion_tokens', 'completionTokens'], ['total_tokens', 'totalTokens']] as const) {
          const value = n(data?.usage?.[source]); if (value !== undefined) event[target] = value;
        }
        try { extrairJson(data); event.jsonState = 'valid_json'; }
        catch (error) { event.jsonState = error instanceof LlmOutputError ? error.code : 'invalid_envelope'; }
      } catch { event.jsonState = 'invalid_envelope'; }
    } else {
      try {
        const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
        event.providerErrorCode = ['json_validate_failed', 'schema_validation_failed', 'unsupported_response_format', 'invalid_request_error', 'rate_limit_exceeded', 'invalid_api_key'].includes(String(code)) ? String(code) : 'other';
      } catch { event.providerErrorCode = 'other'; }
    }
    http.push(event);
    try { deps.onHttp?.(Object.freeze({ ...event })); } catch { /* Logging não interfere no modelo. */ }
    if (limited) {
      const error = new LlmHttpError(response.status, body);
      const wait = tempoDeEspera(response.headers, body, now());
      if (wait !== undefined && Number.isFinite(wait)) error.retryAfterMs = wait;
      throw error;
    }
    return response.ok ? response : new Response(body, {status:response.status, headers:response.headers});
  };
  // Evidência real: o schema Groq/120B retornou arrays heterogêneos mesmo
  // com HTTP 200. Usa o modo já implementado no Core, preservando Zod e modelo.
  const groq = new URL(env.AI_BASE_URL!.trim()).hostname === 'api.groq.com';
  const switches: { tier: LlmTier; from: string; to?: string; reason: string; cooldownMs: number }[] = [];
  const label = (host: string) => host === 'api.groq.com' ? 'groq' : host === 'generativelanguage.googleapis.com' ? 'gemini' : host === 'openrouter.ai' ? 'openrouter' : 'other';
  let real: LlmPort;
  try { real = criarLlmDoAmbiente(env, { fetch: observed, now, sempreUsarCascata: true,
    aoTrocar: troca => { switches.push({ tier: troca.tier, from: label(troca.de), ...(troca.para ? { to: label(troca.para) } : {}), reason: troca.motivo, cooldownMs: troca.pausaMs }); },
    ...(groq ? { initialResponseModes: { 'openai/gpt-oss-120b': 'json_object' as const } } : {}),
  }); } catch { throw new Error('Configuração da cascata inválida: confira modelos, esforços e prazo.'); }
  const llm: LlmPort = { generate(request) {
    const phase = ['coleta', 'coleta_lote', 'proposta_classificacao'].includes(request.outputName) ? request.outputName : 'other';
    return context.run({ phase, tier: request.tier, starts: new Map() }, () => real.generate(request));
  } };
  return { llm, http, switches, providers };
}
