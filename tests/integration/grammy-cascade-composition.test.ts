import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Update, UserFromGetMe } from 'grammy/types';
import type * as Ifood from '../../src/ifood/index.js';
const transport = vi.hoisted(() => ({ factory: vi.fn(), connect: vi.fn(), list: vi.fn(), read: vi.fn(), close: vi.fn() }));
vi.mock('../../src/ifood/index.js', async original => ({ ...await original<typeof Ifood>(), createIfoodMcpClient: transport.factory.mockImplementation(() => ({ connect: transport.connect, listTools: transport.list, callReadTool: transport.read, close: transport.close })) }));
vi.mock('../../src/core/fakes/catalogo-fake.js', () => ({ CatalogoFake: class { constructor() { throw new Error('Catálogo fake proibido'); } } }));
vi.mock('../../src/core/fakes/llm-fake.js', () => ({ FakeLlm: class { constructor() { throw new Error('Modelo fake proibido'); } }, responderHeuristico() { throw new Error('Heurística proibida'); } }));
import { criarAplicacaoReal } from '../../src/app.js';
const env = { AI_2_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', AI_2_API_KEY: 'fixture-gemini-key', AI_2_MODEL_FAST: 'gemini-fast', AI_2_MODEL_CAPABLE: 'gemini-capable', AI_3_BASE_URL: 'https://openrouter.ai/api/v1', AI_3_API_KEY: 'fixture-router-key', AI_3_MODEL_FAST: 'router-fast', AI_3_MODEL_CAPABLE: 'router-capable', AI_TIMEOUT_POR_PROVEDOR_MS: '50', TELEGRAM_BOT_TOKEN: '123:fixture-token', AI_PROVIDER: 'openai-compat', AI_BASE_URL: 'https://api.groq.com/openai/v1', AI_API_KEY: 'fixture-api', AI_MODEL_FAST: 'openai/gpt-oss-20b', AI_MODEL_CAPABLE: 'openai/gpt-oss-120b', IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret', IFOOD_MCP_CALLBACK_URL: 'http://localhost:3333/callback' };
const envelope = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], isError: false });
const group = -200500;
let merchant: string; let products: string[]; let isOpen = true;
type Failure = number | 'schema' | 'json' | 'envelope' | 'network' | 'timeout';
let failures: Record<string, Failure> = {};
const hosts = ['api.groq.com', 'generativelanguage.googleapis.com', 'openrouter.ai'];
const attempts: {host: string; tier: string; mode: string}[] = [];
const http = vi.fn(async (url: unknown, init?: RequestInit) => {
  const host = new URL(String(url)).hostname;
  const body = JSON.parse(String(init?.body));
  const tier = ['openai/gpt-oss-20b', 'gemini-fast', 'router-fast'].includes(body.model) ? 'fast' : 'capable';
  attempts.push({host, tier, mode: body.response_format?.type});
  const failure = failures[`${host}:${tier}`] ?? failures[host];
  if (typeof failure === 'number') return new Response('PRIVATE_BODY tokens per minute', {status: failure, headers: {'retry-after': '60'}});
  if (failure === 'network') throw new TypeError('PRIVATE_NETWORK');
  if (failure === 'timeout') return new Promise<Response>(() => {});
  if (failure === 'envelope') return new Response('PRIVATE_ENVELOPE');
  let output: unknown;
  if (failure === 'schema') output = {PRIVATE_FIELD: 'PRIVATE_RESULT'};
  else if (tier === 'fast') {
    const ids = body.response_format.json_schema.schema.properties.resultados.items.properties.participantId.enum as string[];
    output = { resultados: ids.map(participantId => ({ participantId, kind: 'preference', wishes: ['hambúrguer'], foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null })) };
  } else {
    const people = JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(body.messages[1].content)![1]!) as {participantId: string}[];
    output = {pessoas: people.map(p => ({participantId: p.participantId, desejos: [{atende: products, substitutos: []}]}))};
  }
  return new Response(JSON.stringify({choices: [{message: {content: failure === 'json' ? '{PRIVATE_JSON}' : JSON.stringify(output)}}]}));
});
beforeEach(() => {
  failures = {}; attempts.length = 0;
  merchant = randomUUID(); products = [randomUUID(), randomUUID()]; isOpen = true;
  transport.connect.mockResolvedValue(undefined); transport.list.mockResolvedValue([]); transport.close.mockResolvedValue(undefined);
  transport.read.mockImplementation(async (name: string, args: Record<string, unknown> = {}) => envelope(name === 'listAddresses' ? { results: [{ addressId: 'fixture-private-address', formattedAddress: 'Endereço privado de teste', coordinates: { latitude: 0, longitude: 0 } }] }
    : name === 'searchOffers' && args.resultKind !== 'ITEM' ? { resultKind: 'MERCHANT', results: [{ merchantId: merchant, merchantName: 'Restaurante do MCP', isOpen }], hasMore: false }
      : name === 'getMerchant' ? { merchantId: merchant, merchantName: 'Restaurante do MCP', isOpen }
        : { resultKind: 'ITEM', results: products.map((itemId, i) => ({ itemId, itemName: `Hambúrguer MCP ${i + 1}`, merchant: { merchantId: merchant } })), hasMore: false }));
  vi.spyOn(console, 'info').mockImplementation(() => undefined); vi.stubGlobal('fetch', http);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function setup() {
  const runtime = await criarAplicacaoReal(env);
  runtime.bot.botInfo = { id: 999, is_bot: true, first_name: 'Bot', username: 'fixture_bot', can_read_all_group_messages: true, can_join_groups: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as UserFromGetMe;
  const sent: {chat:number;text:string;id:number;buttons:{text:string;callback_data?:string}[]}[] = [];
  let sequence = 100;
  runtime.bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    if (method === 'sendMessage') { const id = ++sequence; sent.push({ chat: Number(p.chat_id), text: String(p.text), id, buttons: (p.reply_markup as {inline_keyboard?: {text:string;callback_data?:string}[][]})?.inline_keyboard?.flat() ?? [] }); return { ok: true, result: { message_id: id, date: 0, chat: { id: Number(p.chat_id) }, text: p.text } } as never; }
    return { ok: true, result: true } as never;
  });
  const from = (id: number) => ({ id, is_bot: false, first_name: `Pessoa ${id}` });
  const text = (id: number, value: string, chat = group) => runtime.bot.handleUpdate({ update_id: ++sequence, message: { message_id: sequence, date: 0, from: from(id), chat: { id: chat, type: chat === id ? 'private' : 'supergroup', title: 'Teste' }, text: value, ...(value.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: value.split(' ')[0]!.length }] } : {}) } } as Update);
  const click = (id: number, data: string, chat: number, messageId: number) => runtime.bot.handleUpdate({ update_id: ++sequence, callback_query: { id: String(sequence), from: from(id), chat_instance: 'fixture', data, message: { message_id: messageId, date: 0, chat: { id: chat, type: chat === id ? 'private' : 'supergroup', title: 'Teste' }, text: '' } } } as Update);
  const button = (label: string) => { const m = sent.findLast(m => m.buttons.some(b => b.text.includes(label)))!; return { m, data: m.buttons.find(b => b.text.includes(label))!.callback_data! }; };
  await text(71, '/iniciar'); const address = button('Confirmar endereço'); await click(71, address.data, group, address.m.id);
  return { runtime, sent, text, click, button };
}
async function propose(h: Awaited<ReturnType<typeof setup>>) {
  await h.text(71, 'PRIVATE_PREFERENCE hambúrguer'); await h.text(72, 'Hambúrguer também');
  await h.text(71, '/montar');
}
function assertProposal(h: Awaited<ReturnType<typeof setup>>, session: Awaited<ReturnType<typeof h.runtime.iris.obter>>) {
  expect(session?.preliminary?.items).toHaveLength(2);
  expect(session?.preliminary?.items.every(i => i.storeId === merchant && products.includes(i.menuItemId))).toBe(true);
  const card = h.sent.findLast(m => m.text.includes('Sugestão preliminar'))?.text;
  expect(card).toContain('2 de 2'); expect(card).toContain('disponibilidade não confirmada'); expect(card).toContain('pendentes do carrinho');
  expect(transport.factory).toHaveBeenCalledWith(expect.anything(), {allowCartMutations: false, allowPaymentConfiguration: false});
  expect(transport.read.mock.calls.every(([name]) => ['listAddresses','searchOffers','browseOffers','getMerchant'].includes(name))).toBe(true);
  expect(h.runtime.bot.isRunning()).toBe(false);
}
it('A: Groq atende fast/capable sem chamar reservas e mantém json_object no 120B', async () => {
  const h = await setup(); try { await propose(h); assertProposal(h, await h.runtime.iris.obter(String(group)));
    expect(attempts.every(a => a.host === hosts[0])).toBe(true);
    expect(attempts.filter(a => a.tier === 'capable').every(a => a.mode === 'json_object')).toBe(true);
  } finally { await h.runtime.close(); }
});
it.each<Failure>([429,500,503,401,'network','json','envelope','schema','timeout'])('B/E/F: falha %s do Groq migra para Gemini nos dois tiers', async failure => {
  failures[hosts[0]!] = failure;
  const h = await setup(); try { await propose(h); assertProposal(h, await h.runtime.iris.obter(String(group)));
    expect(attempts.some(a => a.host === hosts[1] && a.tier === 'fast')).toBe(true);
    expect(attempts.some(a => a.host === hosts[1] && a.tier === 'capable')).toBe(true);
    expect(attempts.some(a => a.host === hosts[2])).toBe(false);
  } finally { await h.runtime.close(); }
});
it('C: Groq e Gemini falham, OpenRouter assume fast e capable', async () => {
  failures[hosts[0]!] = 429; failures[hosts[1]!] = 401;
  const h = await setup(); try { await propose(h); assertProposal(h, await h.runtime.iris.obter(String(group)));
    expect(attempts.filter(a => a.tier === 'fast').map(a => a.host)).toEqual(hosts);
    expect(attempts.some(a => a.host === hosts[2] && a.tier === 'capable')).toBe(true);
  } finally { await h.runtime.close(); }
});
it('D/H: falha total da classificação preserva sessão/preferências e não inventa proposta nem vaza erro', async () => {
  const h = await setup(); try {
    await h.text(71, 'PRIVATE_PREFERENCE hambúrguer'); await h.text(72, 'Hambúrguer'); await h.runtime.agrupador.esvaziar(String(group));
    const before = await h.runtime.iris.obter(String(group));
    for (const host of hosts) failures[`${host}:capable`] = 503;
    await h.text(71, '/montar');
    const after = await h.runtime.iris.obter(String(group));
    expect(after?.participants).toEqual(before?.participants); expect(after?.preliminary).toBeUndefined();
    expect(h.sent.at(-1)?.text).toMatch(/IA real/);
    expect(attempts.filter(a => a.tier === 'capable').map(a => a.host)).toEqual(hosts);
    await h.text(71, '/montar');
    expect(attempts.filter(a => a.tier === 'capable')).toHaveLength(3);
    expect(JSON.stringify(h.runtime.diagnostico())).not.toMatch(/PRIVATE_|fixture-api|fixture-gemini-key|fixture-router-key|fixture-private-address/);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/PRIVATE_|fixture-api|fixture-gemini-key|fixture-router-key/);
  } finally { await h.runtime.close(); }
});
it('G: Groq volta depois do cooldown, sem bloquear Gemini enquanto isso', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  failures[hosts[0]!] = 429;
  const h = await setup(); try { await propose(h); assertProposal(h, await h.runtime.iris.obter(String(group)));
    delete failures[hosts[0]!]; clock.mockReturnValue(1_060_001);
    await h.text(71, 'Hambúrguer atualizado'); await h.runtime.agrupador.esvaziar(String(group));
    expect(attempts.at(-1)?.host).toBe(hosts[0]);
  } finally { await h.runtime.close(); }
});
it('cascata prioriza outro provedor após 429, sem repetir modelos na mesma credencial', async () => {
  failures[hosts[0]!] = 429;
  const previous = (env as NodeJS.ProcessEnv).AI_MODEL_FAST_FALLBACK;
  (env as NodeJS.ProcessEnv).AI_MODEL_FAST_FALLBACK = 'reserva-groq';
  const h = await setup(); try { await propose(h); assertProposal(h, await h.runtime.iris.obter(String(group)));
    expect(attempts.filter(a => a.host === hosts[0])).toHaveLength(1);
  } finally { if (previous === undefined) delete (env as NodeJS.ProcessEnv).AI_MODEL_FAST_FALLBACK; else (env as NodeJS.ProcessEnv).AI_MODEL_FAST_FALLBACK = previous; await h.runtime.close(); }
});
it.each([
  {AI_2_BASE_URL:'https://openrouter.ai/api/v1'},
  {AI_2_API_KEY:''},
  {AI_2_BASE_URL:'https://PRIVATE_USER:PRIVATE_KEY@generativelanguage.googleapis.com/v1beta/openai'},
  {AI_2_BASE_URL:'PRIVATE_INVALID_URL'},
])('configuração incompatível de reserva falha antes do MCP e sem vazar o valor', async override => {
  await expect(criarAplicacaoReal({...env, ...override})).rejects.toThrow(/Configuração da cascata/);
  expect(transport.connect).not.toHaveBeenCalled();
});
it('F: classificação capable percorre as três reservas mesmo após coleta fast válida', async () => {
  failures[`${hosts[0]}:capable`] = 429; failures[`${hosts[1]}:capable`] = 503;
  const h = await setup(); try { await propose(h); assertProposal(h, await h.runtime.iris.obter(String(group)));
    expect(attempts.filter(a=>a.tier==='fast').map(a=>a.host)).toEqual([hosts[0]]);
    expect(attempts.filter(a=>a.tier==='capable').slice(0,3).map(a=>a.host)).toEqual(hosts);
    expect(attempts.filter(a=>a.tier==='capable').slice(3).every(a=>a.host===hosts[2])).toBe(true);
  } finally {await h.runtime.close();}
});
it('D: falha total fast mantém preferências anteriores e não fabrica nova coleta/proposta', async () => {
  const h = await setup(); try {
    await h.text(71,'Hambúrguer'); await h.text(72,'Hambúrguer'); await h.runtime.agrupador.esvaziar(String(group));
    const before=await h.runtime.iris.obter(String(group));
    for(const host of hosts) failures[host]=401;
    await h.text(71,'Alterar minha preferência'); await h.text(72,'Outra preferência'); await h.text(71,'/montar');
    const after=await h.runtime.iris.obter(String(group));
    expect(after?.participants.map(p=>p.preferences)).toEqual(before?.participants.map(p=>p.preferences));
    expect(after?.preliminary).toBeUndefined(); expect(attempts.some(a=>a.tier==='capable')).toBe(false);
    expect(attempts.filter(a=>a.tier==='fast').slice(1).map(a=>a.host)).toEqual(hosts);
    expect(h.sent.some(m=>m.text.includes('Sugestão preliminar'))).toBe(false);
  } finally {await h.runtime.close();}
});
