import { describe, expect, it } from 'vitest';
import { gerarEstruturado } from '../../src/core/llm.js';
import { CascataEsgotadaError, LlmEmCascata } from '../../src/core/llm-cascata.js';
import type { TrocaDeProvedor } from '../../src/core/llm-cascata.js';
import { LlmHttpError, OpenAiCompatLlm } from '../../src/core/llm-openai.js';
import type { LlmPort, LlmRequest } from '../../src/core/ports.js';
import { z } from 'zod';

const request: LlmRequest = {
  tier: 'fast',
  system: 'sistema',
  prompt: '<mensagem_usuario>oi</mensagem_usuario>',
  outputName: 'coleta',
  outputSchema: { type: 'object' },
};

/** Provedor falso: responde (ou falha) na ordem dada e conta as chamadas. Nunca acessa a rede. */
function provedor(...respostas: (unknown | Error | 'trava')[]) {
  const llm = {
    chamadas: 0,
    sinais: [] as AbortSignal[],
    async generate(req: LlmRequest): Promise<unknown> {
      const r = respostas[Math.min(llm.chamadas, respostas.length - 1)];
      llm.chamadas++;
      if (req.signal) llm.sinais.push(req.signal);
      if (r === 'trava') return new Promise(() => {});
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return llm;
}

function relogio(inicio = 1_000_000) {
  const r = { agora: inicio, now: () => r.agora };
  return r;
}

const cascata = (llms: LlmPort[], extra: Partial<ConstructorParameters<typeof LlmEmCascata>[0]> = {}) => {
  const trocas: TrocaDeProvedor[] = [];
  const llm = new LlmEmCascata({
    provedores: llms.map((l, i) => ({ nome: `p${i + 1}`, llm: l })),
    aoTrocar: (t) => trocas.push(t),
    ...extra,
  });
  return { llm, trocas };
};

describe('LlmEmCascata', () => {
  it('usa o primeiro provedor quando ele responde', async () => {
    const a = provedor({ ok: 1 });
    const b = provedor({ ok: 2 });
    const { llm, trocas } = cascata([a, b]);

    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
    expect(b.chamadas).toBe(0);
    expect(trocas).toEqual([]);
  });

  it.each([
    ['429 por minuto', new LlmHttpError(429, 'Rate limit reached ... per minute'), 'rate_limit', 60_000],
    ['cota diária', new LlmHttpError(429, 'tokens per day (TPD)'), 'plan_or_quota', 3_600_000],
    ['chave inválida', new LlmHttpError(401, 'invalid api key'), 'auth', 3_600_000],
    ['provedor fora do ar', new LlmHttpError(503, 'overloaded'), 'unavailable', 30_000],
    ['erro HTTP qualquer', new LlmHttpError(500, 'boom'), 'other', 60_000],
    ['falha de rede', new TypeError('fetch failed'), 'rede', 30_000],
  ])('%s: passa ao próximo e pausa o que falhou', async (_, erro, motivo, pausaMs) => {
    const a = provedor(erro);
    const b = provedor({ ok: 2 });
    const { llm, trocas } = cascata([a, b]);

    await expect(llm.generate(request)).resolves.toEqual({ ok: 2 });
    expect(trocas).toEqual([{ tier: 'fast', de: 'p1', para: 'p2', motivo, pausaMs }]);
    expect(llm.trocas).toEqual(trocas);
  });

  it('resposta sem JSON passa ao próximo sem pausar o provedor', async () => {
    const a = provedor(new Error('resposta sem objeto JSON: oi'), { ok: 1 });
    const b = provedor({ ok: 2 });
    const { llm, trocas } = cascata([a, b]);

    await expect(llm.generate(request)).resolves.toEqual({ ok: 2 });
    expect(trocas[0]).toMatchObject({ motivo: 'resposta_invalida', pausaMs: 0 });
    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
  });

  it('pula o provedor em pausa e o traz de volta quando a pausa acaba', async () => {
    const r = relogio();
    const a = provedor(new LlmHttpError(503, 'overloaded'), { ok: 1 });
    const b = provedor({ ok: 2 });
    const { llm } = cascata([a, b], { now: r.now });

    await llm.generate(request);
    expect(llm.fila()).toEqual([1, 0]);
    await expect(llm.generate(request)).resolves.toEqual({ ok: 2 });
    expect(a.chamadas).toBe(1);

    r.agora += 30_000;
    expect(llm.fila()).toEqual([0, 1]);
    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
  });

  it('com todos em pausa, tenta mesmo assim, do que volta primeiro ao último', async () => {
    const r = relogio();
    const a = provedor(new LlmHttpError(429, 'tokens per day'), { ok: 1 });
    const b = provedor(new LlmHttpError(503, 'overloaded'), { ok: 2 });
    const { llm } = cascata([a, b], { now: r.now });

    await expect(llm.generate(request)).rejects.toBeInstanceOf(CascataEsgotadaError);
    expect(llm.fila()).toEqual([1, 0]);
    await expect(llm.generate(request)).resolves.toEqual({ ok: 2 });
  });

  it('percorre os 4 provedores até um responder', async () => {
    const falha = () => provedor(new LlmHttpError(503, 'x'));
    const d = provedor({ ok: 4 });
    const { llm, trocas } = cascata([falha(), falha(), falha(), d]);

    await expect(llm.generate(request)).resolves.toEqual({ ok: 4 });
    expect(trocas.map((t) => `${t.de}→${t.para}`)).toEqual(['p1→p2', 'p2→p3', 'p3→p4']);
  });

  it('esgotada, lança erro com o último motivo; não fatal se algum erro era passageiro', async () => {
    const { llm, trocas } = cascata([provedor(new LlmHttpError(401, 'invalid api key')), provedor(new LlmHttpError(503, 'x'))]);

    const erro = await llm.generate(request).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CascataEsgotadaError);
    expect((erro as CascataEsgotadaError).fatal).toBe(false);
    expect((erro as Error).message).toMatch(/nenhum dos 2 provedor\(es\).*HTTP 503/);
    expect(trocas[1]).toEqual({ tier: 'fast', de: 'p2', motivo: 'unavailable', pausaMs: 30_000 });
  });

  it('esgotada só com chave, plano ou cota: erro fatal, e gerarEstruturado não tenta de novo', async () => {
    const a = provedor(new LlmHttpError(401, 'invalid api key'));
    const b = provedor(new LlmHttpError(429, 'requests per day'));
    const { llm } = cascata([a, b]);

    await expect(
      gerarEstruturado({ llm, phase: 'coleta', tier: 'fast', system: 's', prompt: 'p', outputName: 'x', schema: z.object({}) }),
    ).rejects.toMatchObject({ fatal: true, attempts: 1 });
    expect(a.chamadas + b.chamadas).toBe(2);
  });

  it('provedor lento: desiste no timeout próprio, cancela a chamada e passa ao próximo', async () => {
    const lento = provedor('trava');
    const b = provedor({ ok: 2 });
    const { llm, trocas } = cascata([lento, b], { timeoutPorProvedorMs: 20 });

    await expect(llm.generate(request)).resolves.toEqual({ ok: 2 });
    expect(trocas[0]).toMatchObject({ de: 'p1', motivo: 'timeout', pausaMs: 30_000 });
    expect(lento.sinais[0]?.aborted).toBe(true);
  });

  it('o último da fila não tem timeout próprio (vale o de quem chamou)', async () => {
    const a = provedor(new LlmHttpError(503, 'x'));
    const devagar: LlmPort = { generate: () => new Promise((resolve) => setTimeout(() => resolve({ ok: 2 }), 40)) };
    const { llm } = cascata([a, devagar], { timeoutPorProvedorMs: 10 });

    await expect(llm.generate(request)).resolves.toEqual({ ok: 2 });
  });

  it('quem chamou cancelou: para a fila sem tentar os próximos', async () => {
    const controller = new AbortController();
    const a: LlmPort = {
      generate: (req) =>
        new Promise((_, reject) => {
          req.signal?.addEventListener('abort', () => reject(new Error('cancelado')));
          controller.abort();
        }),
    };
    const b = provedor({ ok: 2 });
    const { llm, trocas } = cascata([a, b]);

    await expect(llm.generate({ ...request, signal: controller.signal })).rejects.toThrow('cancelado');
    expect(b.chamadas).toBe(0);
    expect(trocas).toEqual([]);
  });

  it('junta o uso de tokens de cada provedor na ordem das respostas', async () => {
    const corpo = (modelo: string, total: number) =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { total_tokens: total }, model: modelo }));
    const groq = new OpenAiCompatLlm({
      baseUrl: 'https://a.test',
      models: { fast: 'ga', capable: 'ga' },
      maxRateLimitRetries: 0,
      fetch: (async () => new Response('overloaded', { status: 503 })) as typeof fetch,
    });
    const cerebras = new OpenAiCompatLlm({
      baseUrl: 'https://b.test',
      models: { fast: 'cb', capable: 'cb' },
      fetch: (async () => corpo('cb', 7)) as typeof fetch,
    });
    const { llm } = cascata([groq, cerebras]);

    await llm.generate(request);
    await llm.generate(request);
    expect(llm.usos.map((u) => [u.model, u.totalTokens])).toEqual([
      ['cb', 7],
      ['cb', 7],
    ]);
  });

  it('provedor que responde 200 sem JSON ("OK" de proxy) é pausado e o próximo assume', async () => {
    const proxy = new OpenAiCompatLlm({
      baseUrl: 'https://proxy.test',
      models: { fast: 'x', capable: 'x' },
      fetch: (async () => new Response('OK\n', { status: 200 })) as typeof fetch,
    });
    const b = provedor({ ok: 2 });
    const { llm, trocas } = cascata([proxy, b]);

    await expect(llm.generate(request)).resolves.toEqual({ ok: 2 });
    expect(trocas[0]).toMatchObject({ de: 'p1', motivo: 'other', pausaMs: 60_000 });
  });

  it('exige pelo menos um provedor', () => {
    expect(() => new LlmEmCascata({ provedores: [] })).toThrow(/pelo menos um/);
  });
});
