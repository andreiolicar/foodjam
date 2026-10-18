import { afterEach, expect, it, vi } from 'vitest';
import { GrammyError } from 'grammy';
import type { Resposta, DiscoveryItem } from '../../src/core/index.js';
import { exibirProposta, atualizarCard, retirarBotoesDoCard, propostaDoCard, type ApiCard } from '../../src/telegram/services/proposta-tela.js';
let sequence = 0;
const image = (id: string) => `https://static.ifood-static.com.br/${id}.jpg?signature=keep`;
function setup(chosen = ['a', 'b', 'c']) {
  const group = `photos-${++sequence}`;
  const items: DiscoveryItem[] = ['a', 'b', 'c', 'rejected'].map(id => ({ id, storeId: 'store', name: `Produto <${id}>`, itemImageUrl: image(id) }));
  const preliminary: NonNullable<Resposta['preliminary']> = { id: 'p1', sessionId: group, organizerId: 'person', address: { formatted: 'Teste' }, participants: [{ id: 'person', displayName: 'Pessoa', preferences: {} }], items: chosen.map(menuItemId => ({ participantId: 'person', storeId: 'store', menuItemId, quantity: 1 })), status: 'preliminary' as const, pending: [] };
  const response: Resposta = { outcome: 'preliminary_ready', actions: [], preliminary, items };
  let current = preliminary;
  const iris = { obter: vi.fn(async () => ({ id: group, organizerId: 'person', participants: preliminary.participants, status: 'collecting' as const, preliminary: current })), nomes: vi.fn(async () => ({ lojas: { store: 'Loja' }, itens: Object.fromEntries(items.map(i => [i.id, i.name])) })) };
  const events: string[] = [];
  let messageId = 10;
  const sendMessage = vi.fn(async () => { events.push('card'); return { message_id: ++messageId }; });
  const sendPhoto = vi.fn(async () => { events.push('photo'); return { message_id: ++messageId }; });
  const deleteMessage = vi.fn(async () => true);
  const editMessageReplyMarkup = vi.fn(async () => true);
  const api = { sendMessage, sendPhoto, deleteMessage, editMessageReplyMarkup, editMessageText: vi.fn(async () => true), editMessageCaption: vi.fn(async () => true) } as unknown as ApiCard;
  const fetchImage = vi.fn(async (_url: string, _init?: RequestInit) => { void _url; void _init; return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } }); });
  vi.stubGlobal('fetch', fetchImage);
  return { group, response, iris, api, sendMessage, sendPhoto, deleteMessage, events, fetchImage, replace() { current = { ...preliminary, id: 'p2' }; return { ...response, preliminary: current }; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('envia resumo e uma foto por produto escolhido, com callbacks somente no resumo', async () => {
  const f = setup(['b', 'a', 'c']);
  await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  expect(f.events).toEqual(['card', 'photo', 'photo', 'photo']);
  expect(f.fetchImage.mock.calls.map(args => String(args[0]))).toEqual([image('b'), image('a'), image('c')]);
  const options = (f.sendPhoto.mock.calls as unknown[][]).map(args => args[2]) as Record<string, unknown>[];
  expect(options[0]).toMatchObject({ caption: expect.stringContaining('Produto &lt;b&gt;'), parse_mode: 'HTML' });
  expect(options[0]).toHaveProperty('reply_parameters', { message_id: 11 }); expect(options[0]).not.toHaveProperty('reply_markup');
  expect(propostaDoCard(f.group, 11)).toBe('p1');
});
it('mantém produtos distintos mesmo com URL igual e não reenvia na mesma revisão', async () => {
  const f = setup(['a', 'b']); f.response.items![1]!.itemImageUrl = image('a');
  await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  await atualizarCard(f.api, f.iris, f.group, f.response);
  await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  expect(f.sendPhoto).toHaveBeenCalledTimes(2); expect(f.sendMessage).toHaveBeenCalledTimes(1);
});
it.each(['missing', 'unsafe', 'foreign'])('sem imagem utilizável (%s) entrega card sem download', async mode => {
  const f = setup(['a']);
  if (mode === 'missing') delete f.response.items![0]!.itemImageUrl;
  if (mode === 'unsafe') f.response.items![0]!.itemImageUrl = 'http://localhost/image.jpg';
  if (mode === 'foreign') f.response.items![0]!.storeId = 'other-store';
  await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  expect(f.sendMessage).toHaveBeenCalledTimes(2); expect(f.fetchImage).not.toHaveBeenCalled(); expect(f.sendPhoto).not.toHaveBeenCalled();
});
it.each(['telegram', 'download', 'redirect', 'size', 'type'])('falha pré-envio ou rejeição explícita %s mantém card e botões da revisão correta', async failure => {
  const f = setup(['a']);
  if (failure === 'telegram') f.sendPhoto.mockRejectedValueOnce(new GrammyError('Controlled rejection', { ok:false, error_code:400, description:'Controlled rejection' }, 'sendPhoto', {}));
  if (failure === 'download') f.fetchImage.mockRejectedValueOnce(new Error('PRIVATE_DOWNLOAD'));
  if (failure === 'redirect') f.fetchImage.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1' } }));
  if (failure === 'size') f.fetchImage.mockResolvedValueOnce(new Response(new Uint8Array(5_000_001), { headers: { 'content-type': 'image/jpeg' } }));
  if (failure === 'type') f.fetchImage.mockResolvedValueOnce(new Response('<html>not an image</html>', { headers: { 'content-type': 'text/html' } }));
  const errorLog = vi.spyOn(console, 'error');
  await expect(exibirProposta(f.api, f.iris, f.group, f.response, 'bot')).resolves.toBe(true);
  expect(f.sendMessage).toHaveBeenCalledTimes(2); expect(propostaDoCard(f.group, 11)).toBe('p1');
  if (failure !== 'telegram') expect(f.sendPhoto).not.toHaveBeenCalled();
  expect(f.fetchImage).toHaveBeenCalledWith(image('a'), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
  expect(errorLog).not.toHaveBeenCalled(); errorLog.mockRestore();
});
it.each(['download', 'telegram'])('mídia pendurada em %s tem prazo finito e então entrega card textual', async phase => {
  vi.useFakeTimers(); const f = setup(['a']);
  if (phase === 'download') f.fetchImage.mockImplementationOnce(() => new Promise(() => {}));
  else f.sendPhoto.mockImplementationOnce(() => new Promise(() => {}));
  const pending = exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  await vi.advanceTimersByTimeAsync(0); expect(f.sendMessage).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2500); await expect(pending).resolves.toBe(true);
  expect(propostaDoCard(f.group, 11)).toBe('p1');
});
it('resposta tardia de foto substituída é removida e não envia fotos restantes nem vincula callbacks à nova revisão', async () => {
  const f = setup(['a', 'b']);
  let resolve!: (value: { message_id: number }) => void;
  let entered!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  f.sendPhoto.mockImplementationOnce(async () => { entered(); return new Promise(done => { resolve = done; }); });
  const pending = exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  await started;
  const next = f.replace(); next.items = [];
  await exibirProposta(f.api, f.iris, f.group, next, 'bot');
  resolve({ message_id: 90 }); await pending;
  expect(f.sendPhoto).toHaveBeenCalledTimes(1);
  expect(f.deleteMessage).toHaveBeenCalledWith(f.group, 90, expect.any(AbortSignal));
  expect(propostaDoCard(f.group, 90)).toBeUndefined(); expect(propostaDoCard(f.group, 12)).toBe('p2');
});
it('retirar card remove mídia anterior e invalida callbacks', async () => {
  const f = setup(['a']); await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  await retirarBotoesDoCard(f.api, f.group);
  expect(propostaDoCard(f.group, 11)).toBeUndefined();
  expect(f.deleteMessage).toHaveBeenCalledWith(f.group, 11, expect.any(AbortSignal));
});
it('uma atualização de outra revisão não reaproveita callbacks do card antigo', async () => {
  const f = setup(['a']); await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  await atualizarCard(f.api, f.iris, f.group, f.replace());
  expect(propostaDoCard(f.group, 11)).toBe('p1');
  expect(f.api.editMessageText).not.toHaveBeenCalled();
});
it('quando a proposta muda durante download, não envia foto nem a próxima candidata', async () => {
  const f = setup(['a', 'b']);
  f.fetchImage.mockImplementationOnce(async () => { f.replace(); return new Response(new Uint8Array([255,216,255]), { headers: { 'content-type': 'image/jpeg' } }); });
  await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  expect(f.sendMessage).toHaveBeenCalledTimes(1); expect(f.sendPhoto).not.toHaveBeenCalled(); expect(f.fetchImage).toHaveBeenCalledTimes(1);
});
it('resposta depois do timeout é adotada na revisão vigente e removida ao sair dela', async () => {
  vi.useFakeTimers(); const f = setup(['a']);
  let resolve!: (value: { message_id: number }) => void;
  f.sendPhoto.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  await vi.advanceTimersByTimeAsync(2500); await pending;
  resolve({ message_id: 80 }); await vi.advanceTimersByTimeAsync(0);
  expect(f.deleteMessage.mock.calls.some(args => (args as unknown[])[1] === 80)).toBe(false);
  expect(f.sendMessage).toHaveBeenCalledTimes(1); expect(propostaDoCard(f.group, 11)).toBe('p1');
  await retirarBotoesDoCard(f.api, f.group);
  expect(f.deleteMessage).toHaveBeenCalledWith(f.group, 80, expect.any(AbortSignal));
});
it('falha na limpeza da foto velha não bloqueia entrega de um novo card', async () => {
  const f = setup(['a']); await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  f.deleteMessage.mockRejectedValueOnce(new Error('PRIVATE_DELETE'));
  const next = f.replace(); next.items = [];
  await expect(exibirProposta(f.api, f.iris, f.group, next, 'bot')).resolves.toBe(true);
  expect(f.sendMessage).toHaveBeenCalledTimes(3); expect(propostaDoCard(f.group, 13)).toBe('p2');
});
it('verificação de sessão atrasada não permite que apresentação antiga retire botões da revisão nova', async () => {
  const f = setup(['a']); await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  const session = (await f.iris.obter())!;
  const p2 = { ...f.response.preliminary!, id: 'p2' };
  const p3 = { ...f.response.preliminary!, id: 'p3' };
  const response2 = { ...f.response, items: [], preliminary: p2, session: { ...session, preliminary: p2 } };
  const response3 = { ...f.response, items: [], preliminary: p3, session: { ...session, preliminary: p3 } };
  let release!: () => void; let entered!: () => void;
  const pendingRead = new Promise<void>(done => { release = done; });
  const started = new Promise<void>(done => { entered = done; });
  f.iris.obter.mockImplementation(async () => ({ ...session, preliminary: p3 }));
  f.iris.obter.mockImplementationOnce(async () => { entered(); await pendingRead; return { ...session, preliminary: p2 }; });
  const older = exibirProposta(f.api, f.iris, f.group, response2, 'bot');
  await started;
  await exibirProposta(f.api, f.iris, f.group, response3, 'bot');
  release(); await older;
  expect(f.sendMessage).toHaveBeenCalledTimes(3);
  expect(propostaDoCard(f.group, 13)).toBe('p3');
});
it('cancelamento entre conferência e registro do card textual não ressuscita sua identidade nem botões', async () => {
  const f = setup(['a']); delete f.response.items![0]!.itemImageUrl; const session = await f.iris.obter();
  let cancelled = false;
  f.iris.obter.mockImplementation(async () => {
    if (f.sendMessage.mock.calls.length && !cancelled) {
      cancelled = true;
      queueMicrotask(() => queueMicrotask(() => { void retirarBotoesDoCard(f.api, f.group); }));
    }
    return session;
  });
  await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  expect(cancelled).toBe(true); expect(propostaDoCard(f.group, 11)).toBeUndefined();
  expect(f.api.editMessageReplyMarkup).toHaveBeenCalledWith(f.group, 11, expect.anything(), expect.any(AbortSignal));
  expect(f.sendPhoto).not.toHaveBeenCalled();
});
it('cancelamento entre conferência e registro de foto ainda remove a foto enviada', async () => {
  const f = setup(['a']); const session = await f.iris.obter();
  let cancelled = false;
  f.iris.obter.mockImplementation(async () => {
    if (f.sendPhoto.mock.calls.length && !cancelled) {
      cancelled = true;
      queueMicrotask(() => queueMicrotask(() => { void retirarBotoesDoCard(f.api, f.group); }));
    }
    return session;
  });
  await exibirProposta(f.api, f.iris, f.group, f.response, 'bot');
  expect(cancelled).toBe(true); expect(propostaDoCard(f.group, 11)).toBeUndefined();
  expect(f.deleteMessage).toHaveBeenCalledWith(f.group, 11, expect.any(AbortSignal));
});
