import { expect, it, vi } from 'vitest';
import { criarLlmObservado } from '../../src/core/llm-runtime.js';
const env={ AI_PROVIDER:'openai-compat', AI_API_KEY:'private-api', AI_BASE_URL:'https://api.groq.com/openai/v1', AI_MODEL_FAST:'qwen/qwen3.8-27b', AI_MODEL_CAPABLE:'openai/gpt-oss-120b', AI_MODEL_FAST_FALLBACK:'openai/gpt-oss-20b' };
it('preserva fase/modelo/TPM/espera sem prompt, erro bruto ou cabeçalhos privados; não repete 429', async () => {
  const fetch=vi.fn(async()=>new Response('PRIVATE_ORGANIZATION: tokens per minute (TPM). Try again in 3s.',{status:429,headers:{'retry-after':'60','x-ratelimit-remaining-tokens':'0','x-ratelimit-remaining-requests':'800','x-sensitive':'private-header'}}));
  const observed=criarLlmObservado(env,{fetch,now:()=>10000});
  const request={tier:'fast' as const,outputName:'coleta_lote',system:'PRIVATE_SYSTEM',prompt:'PRIVATE_PROMPT',outputSchema:{type:'object'}};
  await expect(observed.llm.generate(request)).rejects.toThrow();
  await expect(observed.llm.generate(request)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(observed.http).toEqual([expect.objectContaining({phase:'coleta_lote',tier:'fast',model:'qwen/qwen3.8-27b',status:429,dimension:'tokens_per_minute',retryAfterMs:60000,nextAttemptAt:new Date(70000).toISOString(),remainingTokensPerMinute:0,remainingRequestsPerDay:800})]);
  expect(JSON.stringify(observed.http)).not.toMatch(/PRIVATE_|private-api|private-header|x-sensitive/);
});
it('429 sem espera comprovada bloqueia novas chamadas, sem presumir minuto nem acionar reserva', async () => {
  const fetch=vi.fn(async()=>new Response('{}',{status:429}));
  const observed=criarLlmObservado(env,{fetch});
  const request={tier:'fast' as const,outputName:'coleta_lote',system:'',prompt:'',outputSchema:{}};
  await expect(observed.llm.generate(request)).rejects.toThrow();
  await expect(observed.llm.generate(request)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(observed.http[0]).toMatchObject({dimension:'unknown'});
  expect(observed.http[0]?.nextAttemptAt).toBeUndefined();
});
it('diagnóstico diferencia JSON inválido em HTTP 200 e registra contagens sem resposta privada', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{PRIVATE_INVALID}' } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }), { status: 200 }));
  const onHttp = vi.fn(); const observed = criarLlmObservado(env, { fetch, onHttp });
  await expect(observed.llm.generate({ tier: 'capable', outputName: 'proposta_classificacao', system: 'PRIVATE_SYSTEM', prompt: 'PRIVATE_PROMPT', outputSchema: {} })).rejects.toThrow();
  expect(observed.http[0]).toMatchObject({ status: 200, jsonState: 'invalid_json', promptTokens: 100, completionTokens: 30 });
  expect(onHttp).toHaveBeenCalledTimes(1); expect(JSON.stringify(observed.http)).not.toMatch(/PRIVATE_|private-api/);
});
