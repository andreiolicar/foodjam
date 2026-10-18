import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmEmCascata } from '../../src/core/llm-cascata.js';
import { gerarEstruturado } from '../../src/core/llm.js';
import { criarLlmObservado } from '../../src/core/llm-runtime.js';
const request = { tier: 'fast' as const, system: 'PRIVATE_SYSTEM', prompt: 'PRIVATE_PROMPT', outputName: 'coleta', outputSchema: {} };
it('último provedor também tem prazo, mesmo se o transporte ignorar abort', async () => {
  const llm = new LlmEmCascata({provedores: [{nome: 'a', llm: {generate: () => new Promise(() => {})}}], timeoutPorProvedorMs: 10});
  await expect(llm.generate(request)).rejects.toThrow(/nenhum/);
}, 200);
it('cancelamento de transporte que ignora abort não inicia reserva', async () => {
  const controller = new AbortController(); const backup = vi.fn(async () => ({}));
  const llm = new LlmEmCascata({provedores: [{nome: 'a', llm: {generate: () => new Promise(() => {})}}, {nome: 'b', llm: {generate: backup}}], timeoutPorProvedorMs: 100});
  const pending = llm.generate({...request, signal: controller.signal}); controller.abort(new Error('cancelado'));
  await expect(pending).rejects.toThrow('cancelado'); expect(backup).not.toHaveBeenCalled();
});
it('esgotamento não duplica o ciclo via gerarEstruturado, nem inclui corpo do erro', async () => {
  const call = vi.fn(async () => { throw new TypeError('PRIVATE_NETWORK_BODY'); });
  const llm = new LlmEmCascata({provedores: [{nome: 'a', llm: {generate: call}}]});
  await expect(gerarEstruturado({llm, ...request, phase:'coleta', schema: z.object({ok: z.boolean()})})).rejects.not.toThrow(/PRIVATE/);
  expect(call).toHaveBeenCalledTimes(1);
  await expect(llm.generate(request)).rejects.toThrow(/nenhum/); expect(call).toHaveBeenCalledTimes(1);
});
it('Retry-After pausa só o provedor correspondente até o prazo comprovado', async () => {
  let at = 1000;
  const network = vi.fn(async () => new Response('PRIVATE_BODY per minute', {status: 429, headers: {'retry-after':'120'}}));
  const observed = criarLlmObservado({AI_PROVIDER:'openai-compat', AI_BASE_URL:'https://api.groq.com/openai/v1', AI_MODEL:'modelo', AI_API_KEY:'PRIVATE_KEY'}, {fetch:network, now:()=>at});
  await expect(observed.llm.generate(request)).rejects.toThrow(); at += 60001;
  await expect(observed.llm.generate(request)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(1);
  at += 60000; await expect(observed.llm.generate(request)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(2);
});
it('sessão concorrente não chama reserva que entrou em cooldown durante sua espera', async () => {
  let release!: () => void;
  const primary = {generate: vi.fn(async (req: typeof request) => { if (req.prompt === 'second') await new Promise<void>(resolve => {release = resolve;}); throw new TypeError('offline'); })};
  const backup = {generate: vi.fn(async () => {throw new TypeError('offline');})};
  const last = {generate: vi.fn(async () => ({}))};
  const llm = new LlmEmCascata({provedores:[{nome:'a',llm:primary},{nome:'b',llm:backup},{nome:'c',llm:last}]});
  const second = llm.generate({...request,prompt:'second'});
  await llm.generate({...request,prompt:'first'}); release(); await second;
  expect(backup.generate).toHaveBeenCalledTimes(1);
});
it('corpo 429 travado não perde Retry-After nem prende a cascata', async () => {
  let at = 1000;
  const network = vi.fn(async () => new Response(new ReadableStream({start() { /* sem conteúdo nem fechamento */ }}), {status:429,headers:{'retry-after':'120'}}));
  const observed = criarLlmObservado({AI_PROVIDER:'openai-compat',AI_BASE_URL:'https://api.groq.com/openai/v1',AI_API_KEY:'PRIVATE_KEY',AI_MODEL:'modelo',AI_TIMEOUT_POR_PROVEDOR_MS:'40'}, {fetch:network,now:()=>at});
  await expect(observed.llm.generate(request)).rejects.toThrow();
  expect(observed.http[0]).toMatchObject({status:429,retryAfterMs:120000});
  at += 60001; await expect(observed.llm.generate(request)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(1);
});
it('sucesso tardio não apaga cooldown publicado por outra chamada', async () => {
  let release!:()=>void; let at=1000;
  const primary = {generate:vi.fn(async (req:typeof request) => {if(req.prompt==='late') {await new Promise<void>(resolve=>{release=resolve;}); return {};} throw new TypeError('offline');})};
  const llm = new LlmEmCascata({now:()=>at,provedores:[{nome:'a',llm:primary},{nome:'b',llm:{generate:async()=>({})}}]});
  const late=llm.generate({...request,prompt:'late'}); await llm.generate(request); at+=100; release(); await late;
  expect(llm.fila()).toEqual([1]);
});
it('Retry-After HTTP-date também impede nova chamada antes do instante do servidor', async () => {
  let at = Date.parse('2026-10-18T08:00:00Z');
  const network=vi.fn(async()=>new Response('',{status:429,headers:{'retry-after':new Date(Date.parse('2026-10-18T08:02:00Z')).toUTCString()}}));
  const observed=criarLlmObservado({AI_PROVIDER:'openai-compat',AI_BASE_URL:'https://api.groq.com/openai/v1',AI_API_KEY:'PRIVATE_KEY',AI_MODEL:'modelo'}, {fetch:network,now:()=>at});
  await expect(observed.llm.generate(request)).rejects.toThrow(); at += 60001;
  await expect(observed.llm.generate(request)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(1);
  expect(observed.http[0]?.retryAfterMs).toBe(120000);
});
it('headers tardios mantêm Retry-After dentro do prazo restante da requisição', async () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
  try {
    const network=vi.fn(async()=> {await new Promise(resolve=>setTimeout(resolve,30)); return new Response(new ReadableStream({start(){}}),{status:429,headers:{'retry-after':'120'}});});
    const observed=criarLlmObservado({AI_PROVIDER:'openai-compat',AI_BASE_URL:'https://api.groq.com/openai/v1',AI_API_KEY:'PRIVATE_KEY',AI_MODEL:'modelo',AI_TIMEOUT_POR_PROVEDOR_MS:'40'}, {fetch:network,now:()=>1000});
    const pending=expect(observed.llm.generate(request)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(45); await pending;
    expect(observed.http[0]).toMatchObject({status:429,retryAfterMs:120000});
  } finally { vi.useRealTimers(); }
});
it('configuração inválida não expõe valores privados nos erros de inicialização', () => {
  expect(() => criarLlmObservado({AI_PROVIDER:'openai-compat',AI_BASE_URL:'https://api.groq.com/openai/v1',AI_API_KEY:'PRIVATE_KEY',AI_MODEL:'modelo',AI_TIMEOUT_POR_PROVEDOR_MS:'PRIVATE_VALUE'})).toThrow(/Configuração da cascata/);
  expect(() => criarLlmObservado({AI_PROVIDER:'openai-compat',AI_BASE_URL:'https://api.groq.com/openai/v1',AI_API_KEY:'PRIVATE_KEY',AI_MODEL:'modelo',AI_TIMEOUT_POR_PROVEDOR_MS:'PRIVATE_VALUE'})).not.toThrow(/PRIVATE_/);
});
