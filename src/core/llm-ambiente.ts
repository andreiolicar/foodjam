import { FakeLlm, responderHeuristico } from './fakes/llm-fake.js';
import type { ReasoningEffort, ResponseMode } from './llm-openai.js';
import { ESFORCOS, OpenAiCompatLlm } from './llm-openai.js';
import type { LlmPort, LlmTier } from './ports.js';

/** Variáveis lidas; recebidas como parâmetro para o core não ler process.env escondido. */
export interface LlmEnv {
  AI_PROVIDER?: string | undefined;
  AI_BASE_URL?: string | undefined;
  AI_MODEL?: string | undefined;
  AI_MODEL_FAST?: string | undefined;
  AI_MODEL_CAPABLE?: string | undefined;
  AI_MODEL_FAST_FALLBACK?: string | undefined;
  AI_MODEL_CAPABLE_FALLBACK?: string | undefined;
  /** low | medium | high; ausente = padrão do provedor (não envia). */
  AI_REASONING_EFFORT_FAST?: string | undefined;
  AI_REASONING_EFFORT_CAPABLE?: string | undefined;
  AI_API_KEY?: string | undefined;
}

function lerEsforco(nome: string, valor: string | undefined): ReasoningEffort | undefined {
  const v = valor?.trim().toLowerCase();
  if (!v) return undefined;
  if (!(ESFORCOS as readonly string[]).includes(v)) {
    throw new Error(`${nome} inválido: "${valor}". Use ${ESFORCOS.join(', ')} ou deixe vazio.`);
  }
  return v as ReasoningEffort;
}

export const PROVEDORES_DISPONIVEIS = ['fake', 'openai-compat'] as const;

/** Há configuração para um provedor real (não o fake)? */
export function temProvedorReal(env: LlmEnv): boolean {
  const provider = env.AI_PROVIDER?.trim().toLowerCase();
  return Boolean(provider && provider !== 'fake' && env.AI_API_KEY?.trim());
}

/**
 * Escolhe a implementação da LlmPort pelo ambiente.
 * - Sem AI_PROVIDER (ou "fake"): responder heurístico, sem rede.
 * - "openai-compat": API compatível com OpenAI em AI_BASE_URL. AI_MODEL vale
 *   para os dois níveis; AI_MODEL_FAST e AI_MODEL_CAPABLE sobrescrevem.
 *   AI_MODEL_FAST_FALLBACK e AI_MODEL_CAPABLE_FALLBACK (opcionais) são os
 *   modelos reserva usados quando o principal responde 429.
 */
export function criarLlmDoAmbiente(env: LlmEnv, dependencies: { fetch?: typeof fetch; initialResponseModes?: Readonly<Partial<Record<string, ResponseMode>>> } = {}): LlmPort {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || 'fake';
  switch (provider) {
    case 'fake':
      return new FakeLlm(responderHeuristico);
    case 'openai-compat': {
      const baseUrl = env.AI_BASE_URL?.trim();
      const fast = env.AI_MODEL_FAST?.trim() || env.AI_MODEL?.trim();
      const capable = env.AI_MODEL_CAPABLE?.trim() || env.AI_MODEL?.trim();
      if (!baseUrl || !fast || !capable) {
        throw new Error('openai-compat exige AI_BASE_URL e AI_MODEL (ou AI_MODEL_FAST e AI_MODEL_CAPABLE).');
      }
      const fallbacks: Partial<Record<LlmTier, string>> = {};
      const reservaFast = env.AI_MODEL_FAST_FALLBACK?.trim();
      const reservaCapable = env.AI_MODEL_CAPABLE_FALLBACK?.trim();
      if (reservaFast && reservaFast !== fast) fallbacks.fast = reservaFast;
      if (reservaCapable && reservaCapable !== capable) fallbacks.capable = reservaCapable;

      const reasoningEffort: Partial<Record<LlmTier, ReasoningEffort>> = {};
      const esforcoFast = lerEsforco('AI_REASONING_EFFORT_FAST', env.AI_REASONING_EFFORT_FAST);
      const esforcoCapable = lerEsforco('AI_REASONING_EFFORT_CAPABLE', env.AI_REASONING_EFFORT_CAPABLE);
      if (esforcoFast) reasoningEffort.fast = esforcoFast;
      if (esforcoCapable) reasoningEffort.capable = esforcoCapable;

      const apiKey = env.AI_API_KEY?.trim();
      return new OpenAiCompatLlm({
        baseUrl,
        models: { fast, capable },
        ...(Object.keys(fallbacks).length > 0 && { fallbacks }),
        ...(Object.keys(reasoningEffort).length > 0 && { reasoningEffort }),
        ...(apiKey && { apiKey }),
        ...(dependencies.fetch && { fetch: dependencies.fetch }),
        ...(dependencies.initialResponseModes && { initialResponseModes: dependencies.initialResponseModes }),
      });
    }
    default:
      throw new Error(
        `AI_PROVIDER "${provider}" ainda não tem adaptador. Disponíveis: ${PROVEDORES_DISPONIVEIS.join(', ')}.`,
      );
  }
}
