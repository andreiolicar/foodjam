import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Update, UserFromGetMe } from 'grammy/types';
import type * as Ifood from '../../src/ifood/index.js';
const transport = vi.hoisted(() => ({ factory: vi.fn(), connect: vi.fn(), list: vi.fn(), read: vi.fn(), close: vi.fn() }));
vi.mock('../../src/ifood/index.js', async original => ({ ...await original<typeof Ifood>(), createIfoodMcpClient: transport.factory.mockImplementation(() => ({ connect: transport.connect, listTools: transport.list, callReadTool: transport.read, close: transport.close })) }));
vi.mock('../../src/core/fakes/catalogo-fake.js', () => ({ CatalogoFake: class { constructor() { throw new Error('Catálogo fake proibido'); } } }));
vi.mock('../../src/core/fakes/llm-fake.js', () => ({ FakeLlm: class { constructor() { throw new Error('Modelo fake proibido'); } }, responderHeuristico() { throw new Error('Heurística proibida'); } }));
import { criarAplicacaoReal } from '../../src/app.js';
const env = { TELEGRAM_BOT_TOKEN: '123:fixture-token', AI_PROVIDER: 'openai-compat', AI_BASE_URL: 'https://api.groq.com/openai/v1', AI_API_KEY: 'fixture-api', AI_MODEL_FAST: 'openai/gpt-oss-20b', AI_MODEL_CAPABLE: 'openai/gpt-oss-120b', IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret', IFOOD_MCP_CALLBACK_URL: 'http://localhost:3333/callback' };
const envelope = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], isError: false });
const group = -200500;
let merchant: string; let products: string[]; let isOpen = true;
const http = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  let output: unknown;
  if (body.response_format?.json_schema?.name === 'coleta_lote') {
    const ids: string[] = body.response_format.json_schema.schema.properties.resultados.items.properties.participantId.enum;
    output = { resultados: ids.map(participantId => ({ participantId, kind: 'preference', wishes: ['hambúrguer'], foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null })) };
  } else {
    expect(body.model).toBe('openai/gpt-oss-120b');
    const people = JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(body.messages[1].content)![1]!);
    expect(people).toHaveLength(1);
    output = { pessoas: people.map((p: {participantId:string}) => ({ participantId: p.participantId, desejos: [{ atende: products, substitutos: [] }] })) };
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
});
beforeEach(() => {
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
it('entrada real conecta grammY/Core/adaptador MCP, preserva revisão/alternativa/ajuste e bloqueia compra', async () => {
  const h = await setup();
  try {
    await h.text(71, 'Quero hambúrguer'); await h.text(72, 'Hambúrguer também');
    await h.text(71, '/montar');
    const publicText = h.sent.filter(m => m.chat === group).map(m => m.text).join('\n');
    expect(publicText).toContain('Restaurante do MCP'); expect(publicText).toContain('Hambúrguer MCP');
    const proposal = (await h.runtime.iris.obter(String(group)))?.preliminary;
    expect(proposal?.items).toHaveLength(2);
    expect(proposal?.items.every(i => i.storeId === merchant && products.includes(i.menuItemId))).toBe(true);
    expect(publicText).toContain('2 de 2'); expect(publicText).toContain('preço a confirmar'); expect(publicText).toContain('disponibilidade não confirmada');
    expect(publicText).not.toMatch(new RegExp(`${merchant}|${products.join('|')}|loja-burger|burger-x-salada|R\\$ 0,00`));
    const confirm = vi.spyOn(h.runtime.iris, 'fechar'); const readCount = transport.read.mock.calls.length;
    const review = h.button('Revisar proposta preliminar');
    await h.click(72, review.data, group, review.m.id); await h.click(71, 'proposta:confirmar', group, review.m.id);
    expect(confirm).not.toHaveBeenCalled(); expect(transport.read).toHaveBeenCalledTimes(readCount);
    await h.click(71, review.data, group, review.m.id); expect(h.sent.at(-1)?.text).toContain('Nenhuma compra');
    const before = http.mock.calls.length; const alternative = h.button('Outra opção'); await h.click(71, alternative.data, group, alternative.m.id);
    expect(http.mock.calls.length).toBe(before);
    const afterSwitch = h.sent.length; await h.click(71, alternative.data, group, alternative.m.id); expect(h.sent.length).toBe(afterSwitch);
    await h.click(71, 'proposta:cancelar', group, alternative.m.id);
    expect((await h.runtime.iris.obter(String(group)))?.status).toBe('collecting');
    await h.text(72, 'Quero outro hambúrguer'); await h.runtime.agrupador.esvaziar(String(group));
    expect(h.sent.filter(m => m.chat === group && m.text.includes('Sugestão preliminar')).length).toBeGreaterThanOrEqual(3);
    await h.click(72, `oa:${group}`, 72, 300);
    expect(h.sent.at(-1)?.text).toContain('Nenhum aceite financeiro');
    expect((await h.runtime.iris.obter(String(group)))?.status).not.toBe('closed');
    const back = h.button('Voltar para a coleta'); await h.click(71, back.data, group, back.m.id);
    expect((await h.runtime.iris.obter(String(group)))?.preliminary).toBeUndefined();
    await h.text(72, '/cancelar'); expect((await h.runtime.iris.obter(String(group)))?.status).toBe('collecting');
    await h.text(71, '/cancelar'); expect((await h.runtime.iris.obter(String(group)))?.status).toBe('cancelled');
    expect(transport.factory).toHaveBeenCalledTimes(1); expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.factory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ allowCartMutations: false, allowPaymentConfiguration: false }));
    expect(transport.read.mock.calls.every(([name]) => ['listAddresses', 'searchOffers', 'getMerchant', 'browseOffers'].includes(name))).toBe(true);
    expect(h.runtime.bot.isRunning()).toBe(false);
  } finally { await h.runtime.close(); }
});
it('loja fechada não produz card nem classificação; configuração fake não chega ao MCP', async () => {
  isOpen = false; const h = await setup();
  try { await h.text(71, 'Hambúrguer'); await h.text(71, '/montar'); expect(h.sent.some(m => m.text.includes('está fechado'))).toBe(true); expect(h.sent.some(m => m.text.includes('Sugestão preliminar'))).toBe(false); expect(http).toHaveBeenCalledTimes(1); } finally { await h.runtime.close(); }
  transport.factory.mockClear();
  await expect(criarAplicacaoReal({ ...env, AI_PROVIDER: 'fake' })).rejects.toThrow(); expect(transport.factory).not.toHaveBeenCalled();
});
it('composição de produção procura hambúrguer e açaí em duas lojas e mostra preço unitário comprovado', async () => {
  const second = randomUUID(); const addressRead = transport.read.getMockImplementation()!;
  const rows = [
    { itemId: products[0]!, itemName: 'Hambúrguer do MCP', unitPrice: 25.9, promotionalUnitPrice: 25.9, merchant: { merchantId: merchant } },
    { itemId: products[1]!, itemName: 'Açaí 500ml do MCP', unitPrice: 32.5, promotionalUnitPrice: 32.5, merchant: { merchantId: second } },
  ];
  transport.read.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'listAddresses') return addressRead(name, args);
    const id = name === 'getMerchant' ? args.merchantId : (args.refinements as { merchantId?: string } | undefined)?.merchantId;
    if (name === 'getMerchant') return envelope({ merchantId: id, merchantName: id === second ? 'Açaí do MCP' : 'Burger do MCP', isOpen: true });
    if (name === 'searchOffers' && args.resultKind === 'MERCHANT') return envelope({ resultKind: 'MERCHANT', hasMore: false, results: [{ merchantId: args.query === 'açaí' ? second : merchant, merchantName: args.query === 'açaí' ? 'Açaí do MCP' : 'Burger do MCP', isOpen: true }] });
    return envelope({ resultKind: 'ITEM', hasMore: false, results: rows.filter(r => name === 'browseOffers' ? r.merchant.merchantId === id : args.query === 'açaí' ? r.merchant.merchantId === second : r.merchant.merchantId === merchant) });
  });
  http.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const shape = body.response_format?.json_schema?.schema;
    const collection = body.response_format?.json_schema?.name === 'coleta_lote';
    const ids: string[] = collection ? shape.properties.resultados.items.properties.participantId.enum : JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(body.messages[1].content)![1]!).map((p: { participantId: string }) => p.participantId);
    const output = collection ? { resultados: ids.map(participantId => ({ participantId, kind: 'preference', wishes: [participantId === '72' ? 'açaí' : 'hambúrguer'], foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null })) }
      : { pessoas: ids.map(participantId => ({ participantId, desejos: [{ atende: [products[participantId === '72' ? 1 : 0]], substitutos: [] }] })) };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
  });
  const h = await setup();
  try {
    await h.text(71, 'Hambúrguer até 50'); await h.text(72, 'Açaí até 40'); await h.text(71, '/montar');
    const proposal = (await h.runtime.iris.obter(String(group)))?.preliminary;
    expect(proposal?.items).toEqual([
      { participantId: '71', storeId: merchant, menuItemId: products[0], quantity: 1 },
      { participantId: '72', storeId: second, menuItemId: products[1], quantity: 1 },
    ]);
    const card = h.sent.findLast(m => m.text.includes('Sugestão preliminar'))!.text;
    expect(card).toContain('2 de 2'); expect(card).toContain('R$ 25,90 por unidade'); expect(card).toContain('R$ 32,50 por unidade');
    expect(card).toContain('disponibilidade não confirmada'); expect(card).toContain('pendentes do carrinho');
    expect(transport.read.mock.calls.every(([name]) => ['listAddresses', 'searchOffers', 'getMerchant', 'browseOffers'].includes(name))).toBe(true);
    await h.text(72, '/endereco'); expect((await h.runtime.iris.obter(String(group)))?.preliminary).toBeDefined();
    await h.text(71, '/endereco'); expect((await h.runtime.iris.obter(String(group)))?.preliminary).toBeUndefined();
    expect((await h.runtime.iris.obter(String(group)))?.address?.status).toBe('pending_confirmation');
  } finally { await h.runtime.close(); }
});
