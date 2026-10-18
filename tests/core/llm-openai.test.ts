import { describe, expect, it } from 'vitest';
import { LlmHttpError, OpenAiCompatLlm, classificarErro, consultarModelos, extrairJson, listarModelos, tempoDeEspera } from '../../src/core/llm-openai.js';
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
    // Em json_schema o schema vai só no response_format, não repetido no prompt.
    expect((chamada?.body.messages as { content: string }[])[0]?.content).not.toContain('JSON Schema');
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
      { status: 400, body: 'json_schema not supported' },
      { status: 400, body: 'json_object not supported' },
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

describe('classificarErro', () => {
  it.each([
    [401, 'unauthorized', 'auth'],
    [400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', 'auth'],
    [403, 'permission denied', 'auth'],
    [403, '{"error":{"type":"FreeTierError"}}', 'plan_or_quota'],
    [402, 'payment required', 'plan_or_quota'],
    [429, '{"error":{"code":"insufficient_quota"}}', 'plan_or_quota'],
    [429, 'quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier', 'plan_or_quota'],
    [429, 'Rate limit reached on tokens per day (TPD)', 'plan_or_quota'],
    [429, 'quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier, "retryDelay": "7s"', 'rate_limit'],
    [429, 'Rate limit reached on requests per minute (RPM). Please try again in 1.2s', 'rate_limit'],
    [400, 'response_format json_schema not supported', 'other'],
    [500, 'internal', 'other'],
  ] as const)('HTTP %i %j → %s', (status, body, kind) => {
    expect(classificarErro(status, body)).toBe(kind);
  });
});

describe('tempoDeEspera', () => {
  it.each([
    [{ 'retry-after': '3' }, '', 3000],
    [{}, '{"details":[{"retryDelay": "23s"}]}', 23_000],
    [{}, 'Please try again in 1.5s.', 1500],
    [{}, 'Please try again in 2m3s.', 123_000],
    [{}, 'Please try again in 450ms.', 450],
    [{}, 'Please try again in 3h2m.', 10_920_000],
    [{}, 'Please try again in 7h12m0.5s.', 25_920_500],
    [{}, 'Please retry in 1h32m46.3s.', 5_566_300],
    [{}, 'slow down', undefined],
  ])('%j %j → %s', (headers, body, ms) => {
    expect(tempoDeEspera(new Headers(headers), body)).toBe(ms);
  });
});

describe('OpenAiCompatLlm: erros do provedor', () => {
  const comEspera = (fn: typeof fetch, extra: Partial<ConstructorParameters<typeof OpenAiCompatLlm>[0]> = {}) => {
    const esperas: number[] = [];
    const llm = new OpenAiCompatLlm({
      baseUrl: 'https://exemplo.test/v1',
      models: { fast: 'f', capable: 'c' },
      fetch: fn,
      sleep: async (ms) => {
        esperas.push(ms);
      },
      ...extra,
    });
    return { llm, esperas };
  };

  it('429 por minuto: espera o que o provedor pediu e tenta de novo', async () => {
    const { fn, chamadas } = fetchFalso([
      { status: 429, body: 'Rate limit reached (RPM). Please try again in 1.5s' },
      { status: 429, body: '{"retryDelay": "2s"}' },
      { status: 200, body: resposta('{"ok":1}') },
    ]);
    const { llm, esperas } = comEspera(fn);
    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
    expect(esperas).toEqual([1500, 2000]);
    expect(chamadas).toHaveLength(3);
  });

  it('429 sem tempo informado: backoff 1 s, 2 s, 4 s e desiste', async () => {
    const { fn, chamadas } = fetchFalso(Array.from({ length: 4 }, () => ({ status: 429, body: 'too many requests' })));
    const { llm, esperas } = comEspera(fn);
    const erro = await llm.generate(request).catch((e: unknown) => e);
    expect(esperas).toEqual([1000, 2000, 4000]);
    expect(chamadas).toHaveLength(4);
    expect(erro).toMatchObject({ kind: 'rate_limit', fatal: false });
  });

  it('429 pedindo espera longa demais: desiste sem esperar', async () => {
    const { fn } = fetchFalso([{ status: 429, body: '{"retryDelay": "45s"}' }]);
    const { llm, esperas } = comEspera(fn, { maxRateLimitWaitMs: 10_000 });
    await expect(llm.generate(request)).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(esperas).toEqual([]);
  });

  it.each([
    [401, 'invalid api key'],
    [402, 'payment required'],
    [403, '{"error":{"type":"FreeTierError","message":"free tier only inside OpenCode"}}'],
    [429, 'You exceeded your current quota. quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier'],
    [400, 'API key not valid. Please pass a valid API key.'],
  ])('HTTP %i fatal: uma chamada só, sem trocar de formato, com a mensagem do provedor', async (status, body) => {
    const { fn, chamadas } = fetchFalso([{ status, body }]);
    const { llm, esperas } = comEspera(fn);
    const erro = (await llm.generate(request).catch((e: unknown) => e)) as LlmHttpError;
    expect(erro.fatal).toBe(true);
    expect(erro.providerMessage).toContain(body.slice(0, 20));
    expect(chamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
    expect(llm.mode).toBe('json_schema');
  });
});

describe('Gemini: respostas reais da camada gratuita', () => {
  const geminiPorMinuto =
    '[{ "error": { "code": 429, "message": "You exceeded your current quota, please check your plan and billing details. ' +
    '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash\n' +
    'Please retry in 55.741306574s.", "status": "RESOURCE_EXHAUSTED", "details": [{ "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "quotaValue": "5" }] } }]';

  it('429 por minuto que cita "plan and billing" continua sendo rate_limit, não fatal', () => {
    expect(classificarErro(429, geminiPorMinuto)).toBe('rate_limit');
    expect(new LlmHttpError(429, geminiPorMinuto).fatal).toBe(false);
  });

  it('lê "Please retry in 55.7s"', () => {
    expect(tempoDeEspera(new Headers(), geminiPorMinuto)).toBe(55_742);
  });

  it('503 "high demand" é unavailable: espera e tenta de novo', async () => {
    const alta = '[{ "error": { "code": 503, "message": "This model is currently experiencing high demand.", "status": "UNAVAILABLE" } }]';
    expect(classificarErro(503, alta)).toBe('unavailable');

    const { fn, chamadas } = fetchFalso([
      { status: 503, body: alta },
      { status: 503, body: alta },
      { status: 200, body: resposta('{"ok":1}') },
    ]);
    const esperas: number[] = [];
    const llm = new OpenAiCompatLlm({
      baseUrl: 'https://exemplo.test/v1',
      models: { fast: 'f', capable: 'c' },
      fetch: fn,
      sleep: async (ms) => {
        esperas.push(ms);
      },
    });
    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
    expect(esperas).toEqual([1000, 2000]);
    expect(chamadas).toHaveLength(3);
  });
});

describe('consultarModelos', () => {
  it('devolve campos do provedor (formato Groq) e os cabeçalhos de limite', async () => {
    const fn = (async () =>
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'modelo-b', owned_by: 'Meta', context_window: 131072, max_completion_tokens: 32768, active: true },
            { id: 'modelo-a', owned_by: 'Google', active: false },
          ],
        }),
        { headers: { 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '999', 'content-type': 'application/json' } },
      )) as typeof fetch;

    const r = await consultarModelos({ baseUrl: 'https://exemplo.test', fetch: fn });
    expect(r.modelos).toEqual([
      { id: 'modelo-a', ownedBy: 'Google', active: false },
      { id: 'modelo-b', ownedBy: 'Meta', contextWindow: 131072, maxCompletionTokens: 32768, active: true },
    ]);
    expect(r.limites).toEqual({ 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '999' });
  });
});

describe('OpenAiCompatLlm: modelo reserva', () => {
  function criarComReserva(respostas: { status: number; body: unknown }[]) {
    const { fn, chamadas } = fetchFalso(respostas);
    const esperas: number[] = [];
    let agora = 1_000_000;
    const llm = new OpenAiCompatLlm({
      baseUrl: 'https://exemplo.test/v1',
      models: { fast: 'principal', capable: 'forte' },
      fallbacks: { fast: 'reserva' },
      fetch: fn,
      now: () => agora,
      sleep: async (ms) => {
        esperas.push(ms);
      },
    });
    const avancar = (ms: number) => {
      agora += ms;
    };
    return { llm, chamadas, esperas, avancar };
  }
  const modelos = (chamadas: { body: Record<string, unknown> }[]) => chamadas.map((c) => c.body.model);
  const porMinuto = 'Rate limit reached on requests per minute (RPM). Please try again in 7s';
  const porDia = 'Rate limit reached on tokens per day (TPD). Please try again in 3h2m';

  it('429 por minuto no principal: troca na hora, sem esperar, e registra a troca', async () => {
    const { llm, chamadas, esperas } = criarComReserva([
      { status: 429, body: porMinuto },
      { status: 200, body: { ...resposta('{"ok":1}'), usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } } },
    ]);
    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
    expect(modelos(chamadas)).toEqual(['principal', 'reserva']);
    expect(esperas).toEqual([]);
    expect(llm.usos[0]).toMatchObject({ model: 'reserva', totalTokens: 12 });
    expect(llm.trocas).toEqual([{ tier: 'fast', de: 'principal', para: 'reserva', motivo: 'rate_limit', esperaMs: 7000 }]);
  });

  it('enquanto o principal está de lado, vai direto ao reserva; depois volta ao principal', async () => {
    const { llm, chamadas, avancar } = criarComReserva([
      { status: 429, body: porMinuto },
      { status: 200, body: resposta('{}') },
      { status: 200, body: resposta('{}') },
      { status: 200, body: resposta('{}') },
    ]);
    await llm.generate(request);
    await llm.generate(request);
    expect(llm.modeloAtual('fast')).toBe('reserva');
    avancar(7001);
    expect(llm.modeloAtual('fast')).toBe('principal');
    await llm.generate(request);
    expect(modelos(chamadas)).toEqual(['principal', 'reserva', 'reserva', 'principal']);
  });

  it('cota diária (429) no principal não é fatal quando há reserva', async () => {
    const { llm, chamadas } = criarComReserva([
      { status: 429, body: porDia },
      { status: 200, body: resposta('{"ok":1}') },
    ]);
    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
    expect(modelos(chamadas)).toEqual(['principal', 'reserva']);
    expect(llm.trocas[0]).toMatchObject({ motivo: 'plan_or_quota', esperaMs: 10_920_000 });
  });

  it('cota diária sem tempo informado deixa o principal de lado por 1 h', async () => {
    const { llm, avancar } = criarComReserva([
      { status: 429, body: 'insufficient_quota' },
      { status: 200, body: resposta('{}') },
    ]);
    await llm.generate(request);
    avancar(3_599_000);
    expect(llm.modeloAtual('fast')).toBe('reserva');
    avancar(2_000);
    expect(llm.modeloAtual('fast')).toBe('principal');
  });

  it('reserva também em 429 por minuto: espera e tenta de novo no reserva', async () => {
    const { llm, chamadas, esperas } = criarComReserva([
      { status: 429, body: porMinuto },
      { status: 429, body: 'Please try again in 1.5s' },
      { status: 200, body: resposta('{"ok":1}') },
    ]);
    await expect(llm.generate(request)).resolves.toEqual({ ok: 1 });
    expect(modelos(chamadas)).toEqual(['principal', 'reserva', 'reserva']);
    expect(esperas).toEqual([1500]);
  });

  it('erro de chave (401) não usa o reserva: continua fatal', async () => {
    const { llm, chamadas } = criarComReserva([{ status: 401, body: 'invalid api key' }]);
    await expect(llm.generate(request)).rejects.toMatchObject({ fatal: true });
    expect(modelos(chamadas)).toEqual(['principal']);
  });

  it('nível sem reserva mantém o comportamento antigo', async () => {
    const { llm, chamadas, esperas } = criarComReserva([
      { status: 429, body: porMinuto },
      { status: 200, body: resposta('{}') },
    ]);
    await llm.generate({ ...request, tier: 'capable' });
    expect(modelos(chamadas)).toEqual(['forte', 'forte']);
    expect(esperas).toEqual([7000]);
  });

  it('o formato aceito é guardado por modelo: o reserva recusar json_schema não muda o principal', async () => {
    const { llm, chamadas } = criarComReserva([
      { status: 429, body: porMinuto },
      { status: 400, body: 'response_format json_schema not supported' },
      { status: 200, body: resposta('{}') },
    ]);
    await llm.generate(request);
    expect(chamadas.map((c) => [c.body.model, (c.body.response_format as { type?: string } | undefined)?.type])).toEqual([
      ['principal', 'json_schema'],
      ['reserva', 'json_schema'],
      ['reserva', 'json_object'],
    ]);
    expect(llm.modoDe('principal')).toBe('json_schema');
    expect(llm.modoDe('reserva')).toBe('json_object');
  });
});

describe('OpenAiCompatLlm: prompt enxuto e reasoning_effort', () => {
  it('fora do json_schema, o schema volta para o prompt de sistema', async () => {
    const { fn, chamadas } = fetchFalso([
      { status: 400, body: 'response_format json_schema not supported' },
      { status: 200, body: resposta('{}') },
    ]);
    await criar(fn).generate(request);
    const sistema = (i: number) => (chamadas[i]?.body.messages as { content: string }[])[0]?.content ?? '';
    expect(sistema(0)).not.toContain('JSON Schema');
    expect(sistema(1)).toContain('JSON Schema');
    expect(sistema(1)).toContain('{"type":"object"}');
  });

  it('envia reasoning_effort só no nível configurado', async () => {
    const { fn, chamadas } = fetchFalso([
      { status: 200, body: resposta('{}') },
      { status: 200, body: resposta('{}') },
    ]);
    const llm = new OpenAiCompatLlm({
      baseUrl: 'https://exemplo.test/v1',
      models: { fast: 'f', capable: 'c' },
      reasoningEffort: { capable: 'low' },
      fetch: fn,
    });
    await llm.generate(request);
    await llm.generate({ ...request, tier: 'capable' });
    expect(chamadas[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(chamadas[1]?.body.reasoning_effort).toBe('low');
  });
});


it('permite iniciar um modelo em JSON object sem alterar o formato dos outros modelos', async () => {
  const { fn, chamadas } = fetchFalso([{ status: 200, body: resposta('{}') }, { status: 200, body: resposta('{}') }]);
  const llm = new OpenAiCompatLlm({ baseUrl: 'https://exemplo.test', models: { fast: 'modelo-rapido', capable: 'modelo-forte' }, initialResponseModes: { 'modelo-forte': 'json_object' }, fetch: fn });
  await llm.generate({ ...request, tier: 'capable' });
  await llm.generate(request);
  expect(chamadas[0]?.body.response_format).toEqual({ type: 'json_object' });
  expect((chamadas[0]?.body.messages as {content:string}[])[0]?.content).toContain('JSON Schema');
  expect(chamadas[1]?.body.response_format).toMatchObject({ type: 'json_schema' });
});
it('400 de geração ou requisição não abandona JSON nem dispara uma negociação de formato', async () => {
  const { fn, chamadas } = fetchFalso([{ status: 400, body: { error: { code: 'json_validate_failed', message: 'Failed to generate JSON. PRIVATE_RESPONSE' } } }, { status: 200, body: resposta('{}') }]);
  const llm = new OpenAiCompatLlm({ baseUrl: 'https://example.invalid', models: { fast: 'f', capable: 'c' }, initialResponseModes: { c: 'json_object' }, fetch: fn });
  await expect(llm.generate({ ...request, tier: 'capable' })).rejects.toMatchObject({ status: 400 });
  expect(chamadas).toHaveLength(1); expect(llm.modoDe('c')).toBe('json_object');
});
