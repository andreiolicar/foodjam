import { expect, it, vi } from 'vitest';
import type { Resposta } from '../../src/core/agente.js';
import { preliminaryFixture } from '../core/preliminary-fixture.js';
import { criarHarness, GRUPO } from './harness.js';

const owner = { id: 101, first_name: 'Pessoa A' }, other = { id: 102, first_name: 'Pessoa B' };
async function proposed(onAction?: () => void) {
  const f = preliminaryFixture();
  const exposed = onAction ? new Proxy(f.iris, { get(target, key) {
    const method = Reflect.get(target, key);
    if (typeof method !== 'function' || !['outraOpcao', 'reabrirColeta', 'cancelar', 'agirNaPropostaPreliminar'].includes(String(key))) return method;
    return (...args: unknown[]) => { const pending = Reflect.apply(method, target, args); onAction(); return pending; };
  } }) : f.iris;
  const execute = vi.fn();
  const h = criarHarness(exposed, { preliminaryOnly: true, aoAutorizar: execute });
  await h.texto(owner, '/iniciar'); await h.clicarBotao(owner, GRUPO, '✅ Confirmar endereço');
  await h.texto(owner, 'Hambúrguer'); await h.texto(other, 'Hambúrguer'); await h.texto(owner, '/montar');
  const old = h.enviadas(GRUPO).findLast(m => m.text.includes('Sugestão preliminar'))!;
  return { ...f, h, old, execute };
}

it.each(['outra', 'voltar', 'cancelar', 'revisar'])('rejeita %s do card substituído durante flush', async action => {
  const f = await proposed();
  f.collection('preference', { '102': ['açaí'] });
  await f.h.texto(other, 'Agora quero açaí');
  await f.h.clicar(owner, `proposta:${action}`, { chatId: GRUPO, messageId: f.old.messageId });
  const session = await f.iris.obter(String(GRUPO));
  expect(session?.preliminary?.items.map(i => [i.participantId, i.menuItemId])).toEqual([['101', 'burger-a'], ['102', 'acai-a']]);
  expect(session?.preliminary?.id).toBe(`${GRUPO}-preliminary-2`);
  expect(session?.status).toBe('collecting');
  expect(f.h.chamadasDe('answerCallbackQuery').at(-1)?.payload).toMatchObject({ show_alert: true });
  expect(f.h.enviadas(GRUPO).filter(m => m.text.includes('Sugestão preliminar'))).toHaveLength(2);
  expect(f.h.bot.isRunning()).toBe(false);
  expect(f.execute).not.toHaveBeenCalled();
  await f.h.agrupador.esvaziarTudo();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it.each(['outra', 'voltar', 'cancelar', 'revisar'])('recusa %s dentro da fila mesmo se a mensagem do card ainda não mudou', async action => {
  const called = deferred(); const entered = deferred(); const release = deferred();
  const f = await proposed(called.resolve);
  f.generate.mockImplementationOnce(async () => {
    entered.resolve(); await release.promise;
    return { resultados: [{ participantId: '102', kind: 'preference', wishes: ['açaí'], foodPreferences: [], dietaryRestrictions: [], avoids: [], budgetText: null, clarification: null }] };
  });
  let background!: Promise<Resposta>;
  vi.spyOn(f.h.agrupador, 'esvaziar').mockImplementationOnce(async () => {
    // O Core começa a processar uma mensagem concorrente; a apresentação ainda não foi atualizada.
    background = f.iris.mensagens(String(GRUPO), [{ participantId: '102', text: 'Açaí' }]);
    await entered.promise;
  });
  const click = f.h.clicar(owner, `proposta:${action}`, { chatId: GRUPO, messageId: f.old.messageId });
  await called.promise;
  release.resolve();
  await Promise.all([background, click]);
  const session = await f.iris.obter(String(GRUPO));
  expect(session?.preliminary?.items.map(i => i.menuItemId)).toEqual(['burger-a', 'acai-a']);
  expect(session?.status).toBe('collecting');
  expect(f.h.chamadasDe('answerCallbackQuery').at(-1)?.payload).toMatchObject({ show_alert: true });
  expect(f.execute).not.toHaveBeenCalled();
});

it('dois cliques concorrentes do mesmo card executam somente uma troca', async () => {
  const f = await proposed();
  await Promise.all([1, 2].map(() => f.h.clicar(owner, 'proposta:outra', { chatId: GRUPO, messageId: f.old.messageId })));
  expect((await f.iris.obter(String(GRUPO)))?.preliminary?.items.map(i => i.menuItemId)).toEqual(['burger-b', 'burger-b']);
  expect(f.h.chamadasDe('answerCallbackQuery').some(c => c.payload.show_alert === true)).toBe(true);
});

it('cancelamento duplicado não executa novamente nem aceita silenciosamente o card encerrado', async () => {
  const f = await proposed();
  await Promise.all([1, 2].map(() => f.h.clicar(owner, 'proposta:cancelar', { chatId: GRUPO, messageId: f.old.messageId })));
  expect((await f.iris.obter(String(GRUPO)))?.status).toBe('cancelled');
  expect(f.h.enviadas(GRUPO).filter(m => m.text.startsWith('Pedido cancelado.'))).toHaveLength(1);
  expect(f.h.chamadasDe('answerCallbackQuery').some(c => c.payload.show_alert === true)).toBe(true);
});

it('cancelar por texto continua independente de um card antigo ou de mensagens pendentes', async () => {
  const f = await proposed();
  f.collection('preference', { '102': ['açaí'] }); await f.h.texto(other, 'Açaí');
  await f.h.texto(owner, '/cancelar');
  expect((await f.iris.obter(String(GRUPO)))?.status).toBe('cancelled');
});

it.each(['voltar', 'cancelar', 'revisar'])('preserva permissão e ação %s válida no card atual sem autorizar compra', async action => {
  const f = await proposed(); const before = (await f.iris.obter(String(GRUPO)))?.preliminary;
  await f.h.clicar(other, `proposta:${action}`, { chatId: GRUPO, messageId: f.old.messageId });
  expect((await f.iris.obter(String(GRUPO)))?.preliminary).toEqual(before);
  await f.h.clicar(owner, `proposta:${action}`, { chatId: GRUPO, messageId: f.old.messageId });
  const session = await f.iris.obter(String(GRUPO));
  expect(session?.status).toBe(action === 'cancelar' ? 'cancelled' : 'collecting');
  if (action === 'revisar') expect(session?.preliminary).toEqual(before);
  else expect(session?.preliminary).toBeUndefined();
  expect(session).not.toHaveProperty('order');
  await f.h.clicar(owner, 'proposta:confirmar', { chatId: GRUPO, messageId: f.old.messageId });
  expect(f.execute).not.toHaveBeenCalled();
});

it('mantém troca normal de alternativas e recusa clique duplicado no card anterior', async () => {
  const f = await proposed();
  await f.h.clicar(owner, 'proposta:outra', { chatId: GRUPO, messageId: f.old.messageId });
  const alternative = (await f.iris.obter(String(GRUPO)))?.preliminary;
  expect(alternative?.items.map(i => i.menuItemId)).toEqual(['burger-b', 'burger-b']);
  await f.h.clicar(owner, 'proposta:outra', { chatId: GRUPO, messageId: f.old.messageId });
  expect((await f.iris.obter(String(GRUPO)))?.preliminary).toEqual(alternative);
  expect(f.h.chamadasDe('answerCallbackQuery').at(-1)?.payload).toMatchObject({ show_alert: true });
  await f.h.clicarBotao(owner, GRUPO, '🔄 Outra opção');
  expect((await f.iris.obter(String(GRUPO)))?.preliminary?.items.map(i => i.menuItemId)).toEqual(['burger-a', 'burger-a']);
});
