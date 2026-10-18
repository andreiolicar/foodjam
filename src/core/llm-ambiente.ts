import { FakeLlm, responderHeuristico } from './fakes/llm-fake.js';
import type { ProvedorDaCascata, TrocaDeProvedor } from './llm-cascata.js';
import { LlmEmCascata } from './llm-cascata.js';
import type { OpenAiCompatOptions, ReasoningEffort } from './llm-openai.js';
import { ESFORCOS, OpenAiCompatLlm } from './llm-openai.js';
import type { LlmPort, LlmTier } from './ports.js';

/**
 * Variáveis lidas; recebidas como parâmetro para o core não ler process.env escondido.
 * Os provedores extras da cascata usam os mesmos nomes com o número depois de
 * AI_ (AI_2_BASE_URL, AI_2_MODEL...), por isso a assinatura de índice.
 */
export interface LlmEnv {
  readonly [nome: string]: string | undefined;
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
  /** Tempo máximo de cada provedor da cascata antes de passar ao próximo. Padrão: 10000. */
  AI_TIMEOUT_POR_PROVEDOR_MS?: string | undefined;
}

export interface OpcoesLlmAmbiente {
  /** Avisado quando a cascata pula um provedor (para o log). */
  aoTrocar?: (troca: TrocaDeProvedor) => void;
}

/** Provedores extras da cascata: AI_2_ até AI_MAX_PROVEDORES_. */
export const MAX_PROVEDORES = 9;

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

/** Prefixo das variáveis do provedor n da cascata: AI_ para o 1, AI_2_ para o 2... */
export function prefixoDoProvedor(n: number): string {
  return n <= 1 ? 'AI_' : `AI_${n}_`;
}

/**
 * Ambiente só com o provedor n da cascata, com os nomes do provedor 1 (AI_2_MODEL
 * vira AI_MODEL...). Serve para os scripts avaliarem um provedor por vez.
 */
export function ambienteDoProvedor(env: LlmEnv, n: number): LlmEnv {
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PROVEDORES) {
    throw new Error(`provedor ${n} inválido: use de 1 a ${MAX_PROVEDORES}.`);
  }
  const prefixo = prefixoDoProvedor(n);
  if (!env[`${prefixo}BASE_URL`]?.trim()) throw new Error(`${prefixo}BASE_URL não está definido.`);
  const isolado: Record<string, string | undefined> = { AI_PROVIDER: env.AI_PROVIDER };
  for (const [nome, valor] of Object.entries(env)) {
    if (nome.startsWith(prefixo) && !(n === 1 && /^AI_\d+_/.test(nome))) {
      isolado[`AI_${nome.slice(prefixo.length)}`] = valor;
    }
  }
  return isolado;
}

/** Nome do provedor para o log: o host da URL (sem a chave). */
function nomeDoProvedor(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

/** Lê as opções de um provedor openai-compat a partir do prefixo (AI_, AI_2_...). */
function lerProvedor(env: LlmEnv, prefixo: string): OpenAiCompatOptions {
  const ler = (nome: string) => env[`${prefixo}${nome}`]?.trim() || undefined;
  const baseUrl = ler('BASE_URL');
  const fast = ler('MODEL_FAST') ?? ler('MODEL');
  const capable = ler('MODEL_CAPABLE') ?? ler('MODEL');
  if (!baseUrl || !fast || !capable) {
    throw new Error(
      `openai-compat exige ${prefixo}BASE_URL e ${prefixo}MODEL (ou ${prefixo}MODEL_FAST e ${prefixo}MODEL_CAPABLE).`,
    );
  }
  const fallbacks: Partial<Record<LlmTier, string>> = {};
  const reservaFast = ler('MODEL_FAST_FALLBACK');
  const reservaCapable = ler('MODEL_CAPABLE_FALLBACK');
  if (reservaFast && reservaFast !== fast) fallbacks.fast = reservaFast;
  if (reservaCapable && reservaCapable !== capable) fallbacks.capable = reservaCapable;

  const reasoningEffort: Partial<Record<LlmTier, ReasoningEffort>> = {};
  const esforcoFast = lerEsforco(`${prefixo}REASONING_EFFORT_FAST`, ler('REASONING_EFFORT_FAST'));
  const esforcoCapable = lerEsforco(`${prefixo}REASONING_EFFORT_CAPABLE`, ler('REASONING_EFFORT_CAPABLE'));
  if (esforcoFast) reasoningEffort.fast = esforcoFast;
  if (esforcoCapable) reasoningEffort.capable = esforcoCapable;

  const apiKey = ler('API_KEY');
  return {
    baseUrl,
    models: { fast, capable },
    ...(Object.keys(fallbacks).length > 0 && { fallbacks }),
    ...(Object.keys(reasoningEffort).length > 0 && { reasoningEffort }),
    ...(apiKey && { apiKey }),
  };
}

function lerTimeout(valor: string | undefined): number | undefined {
  const v = valor?.trim();
  if (!v) return undefined;
  const ms = Number(v);
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new Error(`AI_TIMEOUT_POR_PROVEDOR_MS inválido: "${valor}". Use milissegundos (ex.: 10000).`);
  }
  return ms;
}

/**
 * Escolhe a implementação da LlmPort pelo ambiente.
 * - Sem AI_PROVIDER (ou "fake"): responder heurístico, sem rede.
 * - "openai-compat": API compatível com OpenAI em AI_BASE_URL. AI_MODEL vale
 *   para os dois níveis; AI_MODEL_FAST e AI_MODEL_CAPABLE sobrescrevem.
 *   AI_MODEL_FAST_FALLBACK e AI_MODEL_CAPABLE_FALLBACK (opcionais) são os
 *   modelos reserva usados quando o principal responde 429.
 * - Com AI_2_BASE_URL (e AI_3_, AI_4_...), monta uma cascata: o provedor 1
 *   atende e, se falhar, o próximo assume na hora (LlmEmCascata). Cada provedor
 *   extra aceita as mesmas variáveis com o número (AI_2_MODEL, AI_2_API_KEY...).
 */
export function criarLlmDoAmbiente(env: LlmEnv, opcoes: OpcoesLlmAmbiente = {}): LlmPort {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || 'fake';
  switch (provider) {
    case 'fake':
      return new FakeLlm(responderHeuristico);
    case 'openai-compat': {
      const configs = [lerProvedor(env, prefixoDoProvedor(1))];
      for (let n = 2; n <= MAX_PROVEDORES; n++) {
        const prefixo = prefixoDoProvedor(n);
        if (env[`${prefixo}BASE_URL`]?.trim()) configs.push(lerProvedor(env, prefixo));
      }
      const [unico] = configs;
      if (configs.length === 1 && unico) return new OpenAiCompatLlm(unico);

      // Na cascata, 429 e 5xx passam ao próximo provedor na hora em vez de esperar;
      // só o último da lista ainda espera e tenta de novo.
      const provedores: ProvedorDaCascata[] = configs.map((config, i) => ({
        nome: nomeDoProvedor(config.baseUrl),
        llm: new OpenAiCompatLlm(i < configs.length - 1 ? { ...config, maxRateLimitRetries: 0 } : config),
      }));
      const timeoutPorProvedorMs = lerTimeout(env.AI_TIMEOUT_POR_PROVEDOR_MS);
      return new LlmEmCascata({
        provedores,
        ...(timeoutPorProvedorMs !== undefined && { timeoutPorProvedorMs }),
        ...(opcoes.aoTrocar && { aoTrocar: opcoes.aoTrocar }),
      });
    }
    default:
      throw new Error(
        `AI_PROVIDER "${provider}" ainda não tem adaptador. Disponíveis: ${PROVEDORES_DISPONIVEIS.join(', ')}.`,
      );
  }
}
