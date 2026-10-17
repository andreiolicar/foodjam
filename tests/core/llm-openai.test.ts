import { describe, expect, it } from 'vitest';
import { LlmHttpError, OpenAiCompatLlm, extrairJson, listarModelos } from '../../src/core/llm-openai.js';
import type { LlmRequest } from '../../src/core/ports.js';

const request: LlmRequest = {
  tier: 'fast',
  system: 'sistema',
  prompt: '<mensagem_usuario>oi</mensagem_usuario>',
  outputName: 'coleta',
  outputSchema: { type: 'object' },
};

const resposta = (content: string) => ({ choices: [{ message: { content } }] });

/** fetch falso: devolve as respostas na ordem e guarda as chamadas. Nunca acessa a rede. */
function fetchFalso(respostas: { status: number; body: unknown }[]) {
  const chamadas: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) });
    const r = respostas[chamadas.length - 1];
    if (!r) throw new Error('fetchFalso sem resposta');
    const texto = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(texto, { status: r.status });
  };
  return { fn: fn as typeof fetch, chamadas };
}

const criar = (fetchFn: typeof fetch, apiKey?: string) =>
  new OpenAiCompatLlm({
    baseUrl: 'https://exemplo.test/v1/',
    models: { fast: 'modelo-rapido', capable: 'modelo-forte' },
    fetch: fetchFn,
    ...(apiKey && { apiKey }),
  });

describe('OpenAiCompatLlm', () => {
  it('chama /chat/completions com json_schema, modelo do nível e chave no header', async () => {
    const { fn, chamadas } = fetchFalso([{ status: 200, body: resposta('{"ok":true}') }]);
    const llm = criar(fn, 'chave-teste');

    await expect(llm.generate(request)).resolves.toEqual({ ok: true });
    const [chamada] = chamadas;
    expect(chamada?.url).toBe('https://exemplo.test/v1/chat/completions');
    expect(chamada?.body).toMatchObject({
      model: 'modelo-rapido',
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'coleta', schema: { type: 'object' } } },
    });
    expect((chamada?.init.headers as Record<string, string>).authorization).toBe('Bearer chave-teste');
    expect((chamada?.body.messages as { content: string }[])[0]?.content).toContain('JSON Schema');
  });

  it('usa o modelo capable no nível capable e não manda header sem chave', async () => {
    const { fn, chamadas } = fetchFalso([{ status: 200, body: resposta('{}') }]);
    await criar(fn).generate({ ...request, tier: 'capable' });
    expect(chamadas[0]?.body.model).toBe('modelo-forte');
    expect((chamadas[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('se recusar json_schema, cai para json_object e depois para nenhum, e lembra o modo', async () => {
    const { fn, chamadas } = fetchFalso([
      { status: 400, body: 'response_format json_schema not supported' },
      { status: 422, body: 'json_object not supported' },
      { status: 200, body: resposta('{"a":1}') },
      { status: 200, body: resposta('{"b":2}') },
    ]);
    const llm = criar(fn);

    await expect(llm.generate(request)).resolves.toEqual({ a: 1 });
    expect(chamadas.map((c) => (c.body.response_format as { type?: string } | undefined)?.type)).toEqual([
      'json_schema',
      'json_object',
      undefined,
    ]);
    expect(llm.mode).toBe('none');

    await llm.generate(request);
    expect(chamadas[3]?.body.response_format).toBeUndefined();
  });

  it('erro que não é de formato vira LlmHttpError, sem expor a chave', async () => {
    const { fn } = fetchFalso([{ status: 500, body: 'instável' }]);
    const erro = await criar(fn, 'segredo-123').generate(request).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(LlmHttpError);
    expect(String(erro)).not.toContain('segredo-123');
  });

  it('400 no modo sem response_format não entra em laço', async () => {
    const { fn } = fetchFalso([
      { status: 400, body: 'x' },
      { status: 400, body: 'x' },
      { status: 400, body: 'pedido inválido' },
    ]);
    await expect(criar(fn).generate(request)).rejects.toThrow(/HTTP 400: pedido inválido/);
  });
});

describe('extrairJson', () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['<think>vou pensar {não é json}</think>\n{"a":1}', { a: 1 }],
    ['Claro! Aqui está: {"a":{"b":2}} Espero ter ajudado.', { a: { b: 2 } }],
  ])('%j', (content, esperado) => {
    expect(extrairJson(resposta(content))).toEqual(esperado);
  });

  it.each([[{}], [resposta('sem json aqui')], [resposta('{quebrado')], [{ choices: [{ message: { content: null } }] }]])(
    'falha com mensagem clara para %j',
    (data) => {
      expect(() => extrairJson(data)).toThrow();
    },
  );
});

describe('listarModelos', () => {
  it('faz GET em {base}/models com a chave e devolve ids ordenados e sem repetição', async () => {
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), ...(init && { init }) });
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'modelo-b' }, { id: 'modelo-a' }, { id: 'modelo-b' }, {}] }));
    }) as typeof fetch;

    await expect(listarModelos({ baseUrl: 'https://exemplo.test/v1/', apiKey: 'k', fetch: fn })).resolves.toEqual([
      'modelo-a',
      'modelo-b',
    ]);
    expect(chamadas[0]?.url).toBe('https://exemplo.test/v1/models');
    expect((chamadas[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('aceita lista direta', async () => {
    const fn = (async () => new Response(JSON.stringify([{ id: 'x' }]))) as typeof fetch;
    await expect(listarModelos({ baseUrl: 'https://exemplo.test', fetch: fn })).resolves.toEqual(['x']);
  });

  it('erro HTTP vira LlmHttpError sem expor a chave; formato inesperado falha com mensagem clara', async () => {
    const negado = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    const erro = await listarModelos({ baseUrl: 'https://exemplo.test', apiKey: 'segredo', fetch: negado }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(LlmHttpError);
    expect(String(erro)).not.toContain('segredo');

    const estranho = (async () => new Response(JSON.stringify({ models: 'x' }))) as typeof fetch;
    await expect(listarModelos({ baseUrl: 'https://exemplo.test', fetch: estranho })).rejects.toThrow(/sem lista de modelos/);
  });
});
