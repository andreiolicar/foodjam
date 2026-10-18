import { AsyncLocalStorage } from 'node:async_hooks';
import { criarLlmDoAmbiente, temProvedorReal } from './llm-ambiente.js';
import type { LlmEnv } from './llm-ambiente.js';
import type { LlmPort, LlmTier } from './ports.js';
import { extrairJson, LlmOutputError } from './llm-openai.js';
import { rateEvidence } from './llm-http-evidence.js';

type HttpEvent = ReturnType<typeof rateEvidence> & { phase: string; tier: LlmTier; model: string; at: string; nextAttemptAt?: string;
  requestChars: number; responseMode: 'json_schema' | 'json_object' | 'none';
  jsonState?: 'valid_json' | 'missing_content' | 'missing_json_object' | 'invalid_json' | 'invalid_envelope';
  providerErrorCode?: string; promptTokens?: number; completionTokens?: number; totalTokens?: number;
};

/** Mesmo provedor do Core, com diagnóstico sanitizado e sem retry/fallback em 429. */
export function criarLlmObservado(env: LlmEnv, deps: { fetch?: typeof fetch; now?: () => number; onHttp?: (event: Readonly<HttpEvent>) => void } = {}) {
  if (!temProvedorReal(env) || env.AI_PROVIDER?.trim().toLowerCase() !== 'openai-compat') throw new Error('IA real obrigatória.');
  const http: HttpEvent[] = [];
  const now = deps.now ?? Date.now; const network = deps.fetch ?? fetch;
  const context = new AsyncLocalStorage<{ phase: string; tier: LlmTier }>();
  let retryAt = 0;
  const observed: typeof fetch = async (url, init) => {
    if (now() < retryAt) throw Object.assign(new Error('Aguarde a liberação do provedor de IA.'), { fatal: true });
    const response = await network(url, init);
    const limited = response.status === 429 || response.status >= 500;
    // Fecha o gate antes de ler o corpo: falha de leitura não libera retry.
    if (limited) retryAt = Number.POSITIVE_INFINITY;
    const body = response.ok ? '' : await response.clone().text().catch(() => '');
    const evidence = rateEvidence(response.status, response.headers, body);
    const at = now(); const current = context.getStore()!;
    let model = 'unknown'; let responseMode: HttpEvent['responseMode'] = 'none';
    try {
      const parsed = JSON.parse(String(init?.body)) as { model?: unknown; response_format?: { type?: unknown } };
      if (parsed.response_format?.type === 'json_schema' || parsed.response_format?.type === 'json_object') responseMode = parsed.response_format.type;
      if (typeof parsed.model === 'string' && /^[A-Za-z0-9_./:-]{1,120}$/.test(parsed.model)) model = parsed.model;
    } catch { /* Não registrar requisição nem prompt. */ }
    if (limited && evidence.retryAfterMs !== undefined) retryAt = at + evidence.retryAfterMs;
    const event: HttpEvent = { ...evidence, ...current, model, requestChars: String(init?.body ?? '').length, responseMode, at: new Date(at).toISOString(), ...(limited && Number.isFinite(retryAt) ? { nextAttemptAt: new Date(retryAt).toISOString() } : {}) };
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
    if (limited) throw Object.assign(new Error('Provedor de IA temporariamente indisponível.'), { fatal: true });
    return response;
  };
  // Evidência real: o schema Groq/120B retornou arrays heterogêneos mesmo
  // com HTTP 200. Usa o modo já implementado no Core, preservando Zod e modelo.
  const groq = new URL(env.AI_BASE_URL!.trim()).hostname === 'api.groq.com';
  const real = criarLlmDoAmbiente(env, { fetch: observed,
    ...(groq ? { initialResponseModes: { 'openai/gpt-oss-120b': 'json_object' as const } } : {}),
  });
  const llm: LlmPort = { generate(request) {
    const phase = ['coleta', 'coleta_lote', 'proposta_classificacao'].includes(request.outputName) ? request.outputName : 'other';
    return context.run({ phase, tier: request.tier }, () => real.generate(request));
  } };
  return { llm, http };
}
