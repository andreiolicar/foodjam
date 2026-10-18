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

describe('criarLlmDoAmbiente: reasoning_effort', () => {
  const base = { AI_PROVIDER: 'openai-compat', AI_BASE_URL: 'https://x.test', AI_MODEL: 'm' };

  it('aceita low/medium/high (qualquer caixa) e vazio', () => {
    expect(() => criarLlmDoAmbiente({ ...base, AI_REASONING_EFFORT_CAPABLE: 'LOW', AI_REASONING_EFFORT_FAST: '' })).not.toThrow();
  });

  it('recusa valor inválido com mensagem clara', () => {
    expect(() => criarLlmDoAmbiente({ ...base, AI_REASONING_EFFORT_CAPABLE: 'mínimo' })).toThrow(/AI_REASONING_EFFORT_CAPABLE inválido/);
  });
});

describe('criarLlmDoAmbiente: cascata de provedores', () => {
  const base = { AI_PROVIDER: 'openai-compat', AI_BASE_URL: 'https://api.groq.com/openai/v1', AI_MODEL: 'm1', AI_API_KEY: 'k1' };

  it('só o provedor 1: continua o adaptador simples', async () => {
    const { OpenAiCompatLlm } = await import('../../src/core/llm-openai.js');
    expect(criarLlmDoAmbiente(base)).toBeInstanceOf(OpenAiCompatLlm);
  });

  it('com AI_2_ e AI_4_: cascata na ordem, pulando o número vazio, nomeada pelo host', async () => {
    const { LlmEmCascata } = await import('../../src/core/llm-cascata.js');
    const llm = criarLlmDoAmbiente({
      ...base,
      AI_2_BASE_URL: 'https://api.cerebras.ai/v1',
      AI_2_MODEL: 'm2',
      AI_3_BASE_URL: ' ',
      AI_4_BASE_URL: 'https://openrouter.ai/api/v1',
      AI_4_MODEL_FAST: 'f4',
      AI_4_MODEL_CAPABLE: 'c4',
    });
    expect(llm).toBeInstanceOf(LlmEmCascata);
    expect((llm as InstanceType<typeof LlmEmCascata>).nomes).toEqual(['api.groq.com', 'api.cerebras.ai', 'openrouter.ai']);
  });

  it('provedor extra incompleto: erro claro com o nome da variável', () => {
    expect(() => criarLlmDoAmbiente({ ...base, AI_2_BASE_URL: 'https://x.test' })).toThrow(/AI_2_BASE_URL e AI_2_MODEL/);
    expect(() =>
      criarLlmDoAmbiente({ ...base, AI_2_BASE_URL: 'https://x.test', AI_2_MODEL: 'm', AI_2_REASONING_EFFORT_FAST: 'max' }),
    ).toThrow(/AI_2_REASONING_EFFORT_FAST inválido/);
  });

  it('valida AI_TIMEOUT_POR_PROVEDOR_MS', () => {
    const dois = { ...base, AI_2_BASE_URL: 'https://x.test', AI_2_MODEL: 'm' };
    expect(() => criarLlmDoAmbiente({ ...dois, AI_TIMEOUT_POR_PROVEDOR_MS: '8000' })).not.toThrow();
    expect(() => criarLlmDoAmbiente({ ...dois, AI_TIMEOUT_POR_PROVEDOR_MS: '8s' })).toThrow(/AI_TIMEOUT_POR_PROVEDOR_MS inválido/);
  });

  it('cada provedor usa a própria URL, chave e modelo; 503 no primeiro passa ao segundo na hora', async () => {
    const urls: string[] = [];
    const chaves: string[] = [];
    const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      chaves.push(String((init?.headers as Record<string, string>).authorization));
      const modelo = (JSON.parse(String(init?.body)) as { model: string }).model;
      if (String(url).includes('groq')) return new Response('overloaded', { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: `{"modelo":"${modelo}"}` } }] }));
    }) as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchFalso;
    try {
      const llm = criarLlmDoAmbiente({ ...base, AI_2_BASE_URL: 'https://api.cerebras.ai/v1', AI_2_MODEL: 'm2', AI_2_API_KEY: 'k2' });
      await expect(
        llm.generate({ tier: 'fast', system: 's', prompt: 'p', outputName: 'x', outputSchema: {} }),
      ).resolves.toEqual({ modelo: 'm2' });
    } finally {
      globalThis.fetch = original;
    }
    expect(urls).toEqual(['https://api.groq.com/openai/v1/chat/completions', 'https://api.cerebras.ai/v1/chat/completions']);
    expect(chaves).toEqual(['Bearer k1', 'Bearer k2']);
  });

  it('ambienteDoProvedor isola um provedor com os nomes do provedor 1', async () => {
    const { ambienteDoProvedor } = await import('../../src/core/llm-ambiente.js');
    const env = { ...base, AI_2_BASE_URL: 'https://b.test', AI_2_MODEL: 'm2', AI_2_API_KEY: 'k2' };

    expect(ambienteDoProvedor(env, 2)).toEqual({ AI_PROVIDER: 'openai-compat', AI_BASE_URL: 'https://b.test', AI_MODEL: 'm2', AI_API_KEY: 'k2' });
    expect(ambienteDoProvedor(env, 1)).toEqual(base);
    expect(() => ambienteDoProvedor(env, 3)).toThrow(/AI_3_BASE_URL não está definido/);
  });
});
