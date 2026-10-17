import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeLlm } from '../../src/core/fakes/llm-fake.js';
import type { LlmCallRecord } from '../../src/core/llm.js';
import { LlmSaidaInvalidaError, gerarEstruturado } from '../../src/core/llm.js';
import type { LlmPort } from '../../src/core/ports.js';

const schema = z.strictObject({ resposta: z.string() });

const opcoes = (llm: LlmPort, registros: LlmCallRecord[] = []) => ({
  llm,
  phase: 'teste',
  tier: 'fast' as const,
  system: 'sistema',
  prompt: 'prompt',
  outputName: 'saida',
  schema,
  registrar: (r: LlmCallRecord) => registros.push(r),
});

describe('gerarEstruturado', () => {
  it('devolve a saída validada e registra a chamada', async () => {
    const registros: LlmCallRecord[] = [];
    const llm = new FakeLlm([{ resposta: 'oi' }]);

    await expect(gerarEstruturado(opcoes(llm, registros))).resolves.toEqual({ resposta: 'oi' });
    expect(registros).toEqual([{ phase: 'teste', tier: 'fast', attempt: 1, durationMs: expect.any(Number), ok: true }]);
  });

  it('envia tier, sistema, prompt e o JSON Schema gerado do Zod', async () => {
    const llm = new FakeLlm([{ resposta: 'oi' }]);
    await gerarEstruturado({ ...opcoes(llm), tier: 'capable' });

    const [request] = llm.requests;
    expect(request).toMatchObject({ tier: 'capable', system: 'sistema', prompt: 'prompt', outputName: 'saida' });
    expect(request?.outputSchema).toMatchObject({ type: 'object', required: ['resposta'] });
  });

  it('saída fora do schema gera nova tentativa com o erro no prompt', async () => {
    const registros: LlmCallRecord[] = [];
    const llm = new FakeLlm([{ resposta: 42 }, { resposta: 'ok' }]);

    await expect(gerarEstruturado(opcoes(llm, registros))).resolves.toEqual({ resposta: 'ok' });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]?.prompt).toContain('não seguiu o formato');
    expect(registros.map((r) => r.ok)).toEqual([false, true]);
  });

  it('campo extra também reprova', async () => {
    const llm = new FakeLlm([{ resposta: 'a', precoCents: 1 }, { resposta: 'b' }]);
    await expect(gerarEstruturado(opcoes(llm))).resolves.toEqual({ resposta: 'b' });
  });

  it('esgotadas as tentativas lança LlmSaidaInvalidaError', async () => {
    const registros: LlmCallRecord[] = [];
    const llm = new FakeLlm([{}, { resposta: null }]);

    await expect(gerarEstruturado(opcoes(llm, registros))).rejects.toBeInstanceOf(LlmSaidaInvalidaError);
    expect(registros).toHaveLength(2);
    expect(registros.every((r) => !r.ok && r.error)).toBe(true);
  });

  it('erro do provedor conta como tentativa falha', async () => {
    const llm = new FakeLlm([new Error('503'), { resposta: 'ok' }]);
    await expect(gerarEstruturado(opcoes(llm))).resolves.toEqual({ resposta: 'ok' });
  });

  it('timeout aborta a chamada e conta como tentativa falha', async () => {
    const registros: LlmCallRecord[] = [];
    const sinais: AbortSignal[] = [];
    const lento: LlmPort = {
      generate: (request) => {
        if (request.signal) sinais.push(request.signal);
        return new Promise(() => {});
      },
    };

    await expect(gerarEstruturado({ ...opcoes(lento, registros), timeoutMs: 10 })).rejects.toBeInstanceOf(
      LlmSaidaInvalidaError,
    );
    expect(registros.map((r) => r.error)).toEqual(['timeout de 10 ms', 'timeout de 10 ms']);
    expect(sinais.every((s) => s.aborted)).toBe(true);
  });
});

describe('FakeLlm', () => {
  it('falha claramente quando acaba o roteiro', async () => {
    const llm = new FakeLlm([]);
    await expect(
      llm.generate({ tier: 'fast', system: '', prompt: '', outputName: 'x', outputSchema: {} }),
    ).rejects.toThrow(/sem resposta roteirizada/);
  });
});
