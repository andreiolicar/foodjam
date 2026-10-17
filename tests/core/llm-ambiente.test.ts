import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../../src/core/fakes/llm-fake.js';
import { criarLlmDoAmbiente, temProvedorReal } from '../../src/core/llm-ambiente.js';

describe('criarLlmDoAmbiente', () => {
  it.each([{}, { AI_PROVIDER: '' }, { AI_PROVIDER: ' FAKE ' }])('usa o fake sem rede para %j', (env) => {
    expect(criarLlmDoAmbiente(env)).toBeInstanceOf(FakeLlm);
  });

  it('provedor sem adaptador gera erro claro, sem expor a chave', () => {
    const tentar = () => criarLlmDoAmbiente({ AI_PROVIDER: 'outro', AI_API_KEY: 'segredo-123' });
    expect(tentar).toThrow(/"outro" ainda não tem adaptador/);
    expect(tentar).not.toThrow(/segredo-123/);
  });
});

describe('criarLlmDoAmbiente: openai-compat', () => {
  it('cria o adaptador com base URL e modelo', async () => {
    const { OpenAiCompatLlm } = await import('../../src/core/llm-openai.js');
    const llm = criarLlmDoAmbiente({
      AI_PROVIDER: 'openai-compat',
      AI_BASE_URL: 'https://opencode.ai/zen/v1',
      AI_MODEL: 'modelo-exemplo',
    });
    expect(llm).toBeInstanceOf(OpenAiCompatLlm);
  });

  it('exige base URL e modelo', () => {
    expect(() => criarLlmDoAmbiente({ AI_PROVIDER: 'openai-compat', AI_MODEL: 'x' })).toThrow(/AI_BASE_URL/);
    expect(() => criarLlmDoAmbiente({ AI_PROVIDER: 'openai-compat', AI_BASE_URL: 'https://x.test' })).toThrow(/AI_MODEL/);
  });

  it('temProvedorReal exige provedor diferente de fake e chave', () => {
    expect(temProvedorReal({ AI_PROVIDER: 'openai-compat', AI_API_KEY: 'k' })).toBe(true);
    expect(temProvedorReal({ AI_PROVIDER: 'openai-compat', AI_API_KEY: ' ' })).toBe(false);
    expect(temProvedorReal({ AI_PROVIDER: 'fake', AI_API_KEY: 'k' })).toBe(false);
    expect(temProvedorReal({ AI_API_KEY: 'k' })).toBe(false);
  });
});

describe('criarLlmDoAmbiente: modelo reserva', () => {
  it('lê AI_MODEL_FAST_FALLBACK e AI_MODEL_CAPABLE_FALLBACK; ignora reserva igual ao principal', async () => {
    const { OpenAiCompatLlm } = await import('../../src/core/llm-openai.js');
    const base = { AI_PROVIDER: 'openai-compat', AI_BASE_URL: 'https://x.test', AI_MODEL_FAST: 'a', AI_MODEL_CAPABLE: 'b' };

    const com = criarLlmDoAmbiente({ ...base, AI_MODEL_FAST_FALLBACK: 'c', AI_MODEL_CAPABLE_FALLBACK: 'b' });
    expect(com).toBeInstanceOf(OpenAiCompatLlm);
    expect((com as InstanceType<typeof OpenAiCompatLlm>).modeloAtual('fast')).toBe('a');

    const sem = criarLlmDoAmbiente(base) as InstanceType<typeof OpenAiCompatLlm>;
    expect(sem.modeloAtual('capable')).toBe('b');
  });
});
