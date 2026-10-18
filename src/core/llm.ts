import { z } from 'zod';
import type { LlmPort, LlmTier } from './ports.js';

/** Registro de cada chamada ao modelo, para métricas e para o documento técnico. */
export interface LlmCallRecord {
  phase: string;
  tier: LlmTier;
  attempt: number;
  durationMs: number;
  ok: boolean;
  error?: string;
  /** Erro que não melhora com nova tentativa (chave, plano, cota diária). */
  fatal?: boolean;
  failureKind?: 'validation' | 'generation';
  /** Somente códigos/caminhos do schema; sem valores retornados pelo modelo. */
  validationIssues?: { code: string; path: (string | number)[] }[];
}

/** O erro se declara fatal (ex.: LlmHttpError de chave, plano ou cota)? */
export function erroFatal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { fatal?: unknown }).fatal === true;
}

export interface GerarEstruturadoOptions<T> {
  llm: LlmPort;
  /** Fase do agente (coleta, proposta...), só para o registro. */
  phase: string;
  tier: LlmTier;
  system: string;
  prompt: string;
  outputName: string;
  schema: z.ZodType<T>;
  /** Padrão: 30 s por tentativa (inclui eventual espera de 429 no adaptador). */
  timeoutMs?: number;
  /** Padrão: 2 (uma tentativa e uma nova tentativa). */
  maxAttempts?: number;
  registrar?: (record: LlmCallRecord) => void;
}

export class LlmSaidaInvalidaError extends Error {
  constructor(
    readonly phase: string,
    readonly attempts: number,
    readonly lastError: string,
    /** Parou por erro fatal do provedor (chave, plano, cota), sem nova tentativa. */
    readonly fatal = false,
  ) {
    super(`modelo falhou na fase ${phase} após ${attempts} tentativa(s): ${lastError}`);
    this.name = 'LlmSaidaInvalidaError';
  }
}

/**
 * Chama o modelo e valida a saída com Zod. Saída fora do schema, erro ou
 * timeout geram nova tentativa; esgotadas as tentativas, lança
 * LlmSaidaInvalidaError para quem chamou aplicar o fallback. Erro fatal do
 * provedor (chave, plano, cota diária) não tem nova tentativa.
 */
export async function gerarEstruturado<T>(options: GerarEstruturadoOptions<T>): Promise<T> {
  const { llm, phase, tier, system, outputName, schema, registrar } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 2;
  const outputSchema = z.toJSONSchema(schema) as Record<string, unknown>;

  let prompt = options.prompt;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = performance.now();
    let validationIssues: LlmCallRecord['validationIssues'];
    try {
      const raw = await comTimeout(
        (signal) => llm.generate({ tier, system, prompt, outputName, outputSchema, signal, validateOutput: value => schema.safeParse(value).success }),
        timeoutMs,
      );
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        registrar?.({ phase, tier, attempt, durationMs: performance.now() - started, ok: true });
        return parsed.data;
      }
      validationIssues = parsed.error.issues.map(issue => ({ code: issue.code, path: issue.path.map(key => typeof key === 'symbol' ? 'other' : key) }));
      lastError = z.prettifyError(parsed.error);
      prompt = `${options.prompt}\n\nSua resposta anterior não seguiu o formato exigido:\n${lastError}\nResponda de novo seguindo exatamente o schema.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (erroFatal(error) || (typeof error === 'object' && error !== null && (error as { retryable?: unknown }).retryable === false)) {
        registrar?.({ phase, tier, attempt, durationMs: performance.now() - started, ok: false, error: lastError, fatal: true, failureKind: 'generation' });
        throw new LlmSaidaInvalidaError(phase, attempt, lastError, true);
      }
    }
    registrar?.({ phase, tier, attempt, durationMs: performance.now() - started, ok: false, error: lastError, failureKind: validationIssues ? 'validation' : 'generation', ...(validationIssues ? { validationIssues } : {}) });
  }

  throw new LlmSaidaInvalidaError(phase, maxAttempts, lastError);
}

async function comTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout de ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
