import { describe, expect, it } from 'vitest';
import type { AgenteDeps } from '../../src/core/agente.js';
import { TEXTOS, criarAgente } from '../../src/core/agente.js';
import type { IncomingMessage } from '../../src/core/contracts.js';
import { CatalogoFake, ENDERECO_FAKE } from '../../src/core/fakes/catalogo-fake.js';
import { FakeLlm, responderHeuristico } from '../../src/core/fakes/llm-fake.js';
import * as publico from '../../src/core/index.js';
import type { CatalogPort, LlmPort } from '../../src/core/ports.js';
import { SessoesEmMemoria } from '../../src/core/sessoes.js';
import { AGORA } from './fixtures.js';

const CHAT = 'chat-1';
const ORG = { id: 'ana', displayName: 'Ana' };
const msg = (participantId: string, text: string): IncomingMessage => ({ sessionId: CHAT, participantId, text });

/** Inicia a sessão do CHAT e confirma o endereço padrão (propor e fechar exigem). */
async function abrir(iris: ReturnType<typeof criarAgente>) {
  await iris.iniciar(CHAT, ORG);
  await iris.confirmarEndereco(CHAT, ORG.id);
}

function agente(extra: Partial<AgenteDeps> = {}) {
  const sessions = new SessoesEmMemoria();
  const iris = criarAgente({
    catalog: new CatalogoFake(),
    llm: new FakeLlm(responderHeuristico),
    sessions,
    now: () => AGORA,
    enderecoPadrao: ENDERECO_FAKE,
    ...extra,
  });
  return { iris, sessions };
}

/** Grupo com preferências e uma proposta pronta. */
async function comProposta() {
  const ctx = agente();
  await abrir(ctx.iris);
  await ctx.iris.mensagem(msg('ana', 'quero um lanche'));
  await ctx.iris.mensagem(msg('bia', 'bolo de cenoura'), 'Bia');
  const proposta = await ctx.iris.propor(CHAT, 'ana');
  expect(proposta.outcome).toBe('proposed');
  return ctx;
}

describe('agente: ciclo completo', () => {
  it('iniciar → coleta → propor → ajustar → fechar → mesmo pedido de novo', async () => {
    const { iris } = await comProposta();

    const ajuste = await iris.mensagem(msg('bia', 'troca o meu por um café'));
    expect(ajuste.outcome).toBe('adjusted');
    expect(ajuste.proposal?.orders.flatMap((o) => o.items).find((i) => i.participantId === 'bia')?.menuItemId).toBe('pad-cafe');

    const fechado = await iris.fechar(CHAT, 'ana');
    expect(fechado.outcome).toBe('closed');
    expect(fechado.order).toMatchObject({ sessionId: CHAT, authorization: { authorizedBy: 'ana', authorizedAt: AGORA } });
    expect(fechado.order?.split.shares.reduce((s, p) => s + p.totalCents, 0)).toBe(fechado.order?.split.totalCents);

    const denovo = await iris.fechar(CHAT, 'ana');
    expect(denovo.outcome).toBe('already_closed');
    expect(denovo.order).toEqual(fechado.order);
  });
});

describe('agente: iniciar', () => {
  it('abre a sessão com o organizador como participante', async () => {
    const { iris } = agente();
    const r = await iris.iniciar(CHAT, ORG);
    expect(r.outcome).toBe('started');
    expect(r.session).toMatchObject({ id: CHAT, organizerId: 'ana', status: 'collecting' });
  });

  it('não reabre por cima de uma sessão ativa', async () => {
    const { iris } = agente();
    await abrir(iris);
    const r = await iris.iniciar(CHAT, { id: 'bia', displayName: 'Bia' });
    expect(r.outcome).toBe('already_active');
    expect(r.session?.organizerId).toBe('ana');
  });

  it('depois de encerrada, uma nova menção começa outra sessão', async () => {
    const { iris } = agente();
    await abrir(iris);
    await iris.cancelar(CHAT, 'ana');
    const r = await iris.iniciar(CHAT, { id: 'bia', displayName: 'Bia' });
    expect(r.outcome).toBe('started');
    expect(r.session?.organizerId).toBe('bia');
  });
});

describe('agente: mensagens', () => {
  it('na coleta, registra preferência de quem chegou depois', async () => {
    const { iris } = agente();
    await abrir(iris);
    const r = await iris.mensagem(msg('pedro', 'bora de hambúrguer'), 'Pedro');
    expect(r.outcome).toBe('preference_updated');
    expect(r.session?.participants.map((p) => p.displayName)).toEqual(['Ana', 'Pedro']);
  });

  it('sem sessão, não chama o modelo', async () => {
    const llm = new FakeLlm([]);
    const { iris } = agente({ llm });
    const r = await iris.mensagem(msg('bia', 'quero pizza'));
    expect(r).toEqual({ outcome: 'no_session', actions: [] });
    expect(llm.requests).toHaveLength(0);
  });

  it('sessão encerrada não aceita mensagens', async () => {
    const { iris } = agente();
    await abrir(iris);
    await iris.cancelar(CHAT, 'ana');
    expect((await iris.mensagem(msg('bia', 'quero pizza'))).outcome).toBe('session_finished');
  });

  it('mensagens simultâneas do mesmo chat são processadas em fila (ninguém sobrescreve ninguém)', async () => {
    const lento: LlmPort = {
      generate: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return responderHeuristico(request);
      },
    };
    const { iris } = agente({ llm: lento });
    await abrir(iris);

    await Promise.all([
      iris.mensagem(msg('bia', 'quero pizza'), 'Bia'),
      iris.mensagem(msg('caio', 'sou vegetariano'), 'Caio'),
      iris.mensagem(msg('davi', 'bolo de cenoura'), 'Davi'),
    ]);

    const session = await iris.obter(CHAT);
    expect(session?.participants.map((p) => p.id).sort()).toEqual(['ana', 'bia', 'caio', 'davi']);
  });

  it('chats diferentes não esperam um pelo outro', async () => {
    let emAndamento = 0;
    let maximo = 0;
    const lento: LlmPort = {
      generate: async (request) => {
        maximo = Math.max(maximo, ++emAndamento);
        await new Promise((resolve) => setTimeout(resolve, 20));
        emAndamento--;
        return responderHeuristico(request);
      },
    };
    const { iris } = agente({ llm: lento });
    await iris.iniciar('chat-a', ORG);
    await iris.iniciar('chat-b', ORG);
    await Promise.all([
      iris.mensagem({ sessionId: 'chat-a', participantId: 'bia', text: 'pizza' }),
      iris.mensagem({ sessionId: 'chat-b', participantId: 'bia', text: 'pizza' }),
    ]);
    expect(maximo).toBe(2);
  });
});

describe('agente: só o organizador', () => {
  it.each(['propor', 'reabrirColeta', 'fechar', 'cancelar'] as const)('%s por outra pessoa → not_authorized', async (acao) => {
    const { iris } = await comProposta();
    const r = await iris[acao](CHAT, 'bia');
    expect(r.outcome).toBe('not_authorized');
    expect(r.actions).toEqual([{ type: 'send_message', sessionId: CHAT, participantId: 'bia', text: TEXTOS.soOrganizador }]);
  });
});

describe('agente: proposta e fechamento', () => {
  it('propor guarda o catálogo usado e gera ids previsíveis por chat', async () => {
    const { iris, sessions } = await comProposta();
    const record = await sessions.get(CHAT);
    expect(record?.catalog?.fetchedAt).toBe(AGORA);
    expect(record?.session.proposal?.id).toBe(`${CHAT}-p1`);

    const segunda = await iris.propor(CHAT, 'ana');
    expect(segunda.proposal?.id).toBe(`${CHAT}-p2`);
  });

  it('reabrir coleta descarta a proposta e volta a aceitar preferências', async () => {
    const { iris } = await comProposta();
    const r = await iris.reabrirColeta(CHAT, 'ana');
    expect(r.session?.status).toBe('collecting');
    expect(r.session?.proposal).toBeUndefined();
    expect((await iris.mensagem(msg('caio', 'quero pizza'), 'Caio')).outcome).toBe('preference_updated');
  });

  it('fechar sem proposta → invalid_state', async () => {
    const { iris } = agente();
    await abrir(iris);
    expect((await iris.fechar(CHAT, 'ana')).outcome).toBe('invalid_state');
  });

  it('fechamento recusado mantém a sessão aguardando confirmação e devolve os problemas', async () => {
    // Proposta montada com o catálogo normal...
    const record = await (await comProposta()).sessions.get(CHAT);
    if (!record) throw new Error('sem sessão');

    // ...e, na hora de fechar, as lojas aparecem fechadas.
    const port = new CatalogoFake();
    const lojasFechadas: CatalogPort = {
      validateAddress: (t) => port.validateAddress(t),
      searchStores: async (q) => (await port.searchStores(q)).map((s) => ({ ...s, isOpen: false })),
      getMenu: (id) => port.getMenu(id),
      quoteOrder: (id, itens, end) => port.quoteOrder(id, itens, end),
    };
    const { iris, sessions } = agente({ catalog: lojasFechadas });
    await sessions.set(record);

    const r = await iris.fechar(CHAT, 'ana');
    expect(r.outcome).toBe('close_rejected');
    expect(r.problems?.some((p) => p.code === 'item_rejected')).toBe(true);
    expect((await iris.obter(CHAT))?.status).toBe('awaiting_confirmation');
  });

  it('erro inesperado (rede do catálogo) vira outcome "error" e é reportado', async () => {
    const erros: unknown[] = [];
    const quebrado: CatalogPort = {
      validateAddress: (t) => new CatalogoFake().validateAddress(t),
      searchStores: async () => {
        throw new Error('ECONNRESET');
      },
      getMenu: async () => [],
      quoteOrder: async () => ({ serviceFeeCents: 0 }),
    };
    const { iris } = agente({ catalog: quebrado, onError: (e) => erros.push(e) });
    await abrir(iris);
    await iris.mensagem(msg('ana', 'quero lanche'));

    const r = await iris.propor(CHAT, 'ana');
    expect(r.outcome).toBe('error');
    expect(r.actions[0]).toMatchObject({ participantId: 'ana', text: TEXTOS.erroInterno });
    expect(String(erros[0])).toContain('ECONNRESET');
  });
});

describe('API pública (src/core/index.ts)', () => {
  it('exporta a fachada, o armazenamento e os fakes', () => {
    expect(typeof publico.criarAgente).toBe('function');
    expect(typeof publico.SessoesEmMemoria).toBe('function');
    expect(typeof publico.CatalogoFake).toBe('function');
    expect(typeof publico.criarLlmDoAmbiente).toBe('function');
  });
});

describe('agente: outra opção', () => {
  it('propor devolve a alternativa; outraOpcao troca e troca de volta; só o organizador', async () => {
    const { iris } = agente();
    await abrir(iris);
    await iris.mensagens(CHAT, [
      { participantId: 'ana', text: 'bora de hambúrguer' },
      { participantId: 'caio', text: 'algo leve, sou vegetariano' },
      { participantId: 'bia', text: 'quero um lanche e um bolo de cenoura' },
    ]);
    const proposta = await iris.propor(CHAT, 'ana');
    if (!proposta.alternative) throw new Error('o cenário deveria ter alternativa');

    expect((await iris.outraOpcao(CHAT, 'bia')).outcome).toBe('not_authorized');
    const trocada = await iris.outraOpcao(CHAT, 'ana');
    expect(trocada.outcome).toBe('switched');
    expect(trocada.proposal?.id).toBe(proposta.alternative.id);
    expect(trocada.alternative?.id).toBe(proposta.proposal?.id);
    expect((await iris.outraOpcao(CHAT, 'ana')).proposal?.id).toBe(proposta.proposal?.id);
  });

  it('sem alternativa: no_alternative com aviso privado', async () => {
    const { iris } = agente();
    await abrir(iris);
    expect((await iris.outraOpcao(CHAT, 'ana')).outcome).toBe('no_alternative');
  });
});

describe('agente: ids de proposta únicos por chat', () => {
  it('o segundo pedido do mesmo grupo não repete o proposalId do primeiro', async () => {
    const { iris } = agente();
    await abrir(iris);
    await iris.mensagem(msg('ana', 'quero um lanche'));
    const primeiro = await iris.propor(CHAT, 'ana');
    await iris.fechar(CHAT, 'ana');

    await abrir(iris);
    await iris.mensagem(msg('ana', 'quero um lanche'));
    const segundo = await iris.propor(CHAT, 'ana');

    expect(primeiro.proposal?.id).toBe(`${CHAT}-p1`);
    expect(segundo.proposal?.id).toBe(`${CHAT}-p2`);
    expect((await iris.fechar(CHAT, 'ana')).order?.proposalId).toBe(`${CHAT}-p2`);
  });
});

describe('agente: endereço de entrega', () => {
  const tiposDe = (r: { actions: { type: string }[] }) => r.actions.map((a) => a.type);
  const confirmacaoDe = (r: { actions: { type: string }[] }) =>
    r.actions.find((a) => a.type === 'confirm_address') as { kind: string; address: { formatted: string }; participantId: string } | undefined;

  it('endereço padrão: ao iniciar pergunta [Sim] [Outro endereço]; o organizador confirma; o pedido leva o endereço', async () => {
    const { iris } = agente();
    const inicio = await iris.iniciar(CHAT, ORG);
    expect(confirmacaoDe(inicio)).toMatchObject({ kind: 'default', participantId: 'ana', address: { formatted: ENDERECO_FAKE } });

    const confirmado = await iris.confirmarEndereco(CHAT, 'ana');
    expect(confirmado.outcome).toBe('address_confirmed');
    expect(confirmado.session?.address).toMatchObject({ status: 'confirmed', confirmed: { formatted: ENDERECO_FAKE } });

    await iris.mensagem(msg('ana', 'quero um lanche'));
    expect((await iris.propor(CHAT, 'ana')).outcome).toBe('proposed');
    expect((await iris.fechar(CHAT, 'ana')).order?.deliveryAddress.formatted).toBe(ENDERECO_FAKE);
  });

  it('sem endereço padrão, pede para o organizador digitar (no privado)', async () => {
    const sessions = new SessoesEmMemoria();
    const iris = criarAgente({ catalog: new CatalogoFake(), llm: new FakeLlm([]), sessions, now: () => AGORA });
    const inicio = await iris.iniciar(CHAT, ORG);
    expect(inicio.actions[0]).toMatchObject({ type: 'request_address', participantId: 'ana' });
    expect(inicio.session?.address?.status).toBe('awaiting_text');
  });

  it('endereço digitado: [Outro endereço] → organizador digita → validado → [Confirmar] → confirmado', async () => {
    const llm = new FakeLlm([]);
    const { iris } = agente({ llm });
    await iris.iniciar(CHAT, ORG);

    const pedido = await iris.pedirOutroEndereco(CHAT, 'ana');
    expect(tiposDe(pedido)).toEqual(['request_address']);

    const digitado = await iris.mensagem(msg('ana', 'av   paulista, 1000 - bela vista, são paulo'));
    expect(digitado.outcome).toBe('address_typed_proposed');
    expect(confirmacaoDe(digitado)).toMatchObject({ kind: 'typed', address: { formatted: 'Av Paulista, 1000 - Bela Vista, São Paulo' } });

    const confirmado = await iris.confirmarEndereco(CHAT, 'ana');
    expect(confirmado.session?.address?.confirmed?.formatted).toBe('Av Paulista, 1000 - Bela Vista, São Paulo');
    expect(llm.requests).toHaveLength(0); // o modelo não participa
  });

  it('erro de validação: avisa o motivo no privado e aceita nova tentativa', async () => {
    const { iris } = agente();
    await iris.iniciar(CHAT, ORG);
    await iris.pedirOutroEndereco(CHAT, 'ana');

    const incompleto = await iris.mensagem(msg('ana', 'rua das flores'));
    expect(incompleto.outcome).toBe('address_invalid');
    expect(incompleto.actions).toEqual([
      {
        type: 'send_message',
        sessionId: CHAT,
        participantId: 'ana',
        text: 'O endereço está incompleto: informe rua, número, bairro e cidade. Pode digitar de novo?',
      },
    ]);
    expect((await iris.mensagem(msg('ana', 'Rua A, 10 - Centro, Manaus'))).outcome).toBe('address_invalid');
    expect((await iris.mensagem(msg('ana', 'Rua Inexistente, 1 - Lugar Nenhum'))).outcome).toBe('address_invalid');

    const valido = await iris.mensagem(msg('ana', 'Rua das Flores, 123 - Centro, São Paulo'));
    expect(valido.outcome).toBe('address_typed_proposed');
  });

  it('mensagem de endereço do organizador não entra na coleta; a dos outros entra', async () => {
    const { iris } = agente();
    await iris.iniciar(CHAT, ORG);
    await iris.pedirOutroEndereco(CHAT, 'ana');

    const endereco = await iris.mensagem(msg('ana', 'Rua das Flores, 123 - Centro, São Paulo'));
    expect(endereco.outcome).toBe('address_typed_proposed');
    expect(endereco.session?.participants.find((p) => p.id === 'ana')?.preferences).toEqual({});

    expect((await iris.mensagem(msg('bia', 'quero pizza'), 'Bia')).outcome).toBe('preference_updated');
  });

  it('no lote, a mensagem do organizador vai para o endereço e as dos outros para a coleta (1 chamada ao modelo)', async () => {
    const llm = new FakeLlm(responderHeuristico);
    const { iris } = agente({ llm });
    await iris.iniciar(CHAT, ORG);
    await iris.pedirOutroEndereco(CHAT, 'ana');

    const r = await iris.mensagens(CHAT, [
      { participantId: 'bia', text: 'quero pizza' },
      { participantId: 'ana', text: 'Rua das Flores, 123 - Centro, São Paulo' },
      { participantId: 'caio', text: 'sou vegetariano' },
    ]);
    expect(r.resultados).toEqual(
      expect.arrayContaining([
        { participantId: 'ana', outcome: 'address_typed_proposed' },
        { participantId: 'bia', outcome: 'preference_updated' },
        { participantId: 'caio', outcome: 'preference_updated' },
      ]),
    );
    expect(llm.requests).toHaveLength(1);
    expect(r.session?.participants.find((p) => p.id === 'ana')?.preferences).toEqual({});
  });

  it('propor exige endereço confirmado; o core lembra o passo pendente', async () => {
    const { iris } = agente();
    await iris.iniciar(CHAT, ORG);
    await iris.mensagem(msg('ana', 'quero um lanche'));

    const semEndereco = await iris.propor(CHAT, 'ana');
    expect(semEndereco.outcome).toBe('address_required');
    expect(tiposDe(semEndereco)).toEqual(['send_message', 'confirm_address']);
  });

  it('só o organizador confirma ou troca o endereço', async () => {
    const { iris } = agente();
    await iris.iniciar(CHAT, ORG);
    expect((await iris.confirmarEndereco(CHAT, 'bia')).outcome).toBe('not_authorized');
    expect((await iris.pedirOutroEndereco(CHAT, 'bia')).outcome).toBe('not_authorized');
    expect((await iris.obter(CHAT))?.address?.status).toBe('pending_confirmation');
  });

  it('trocar o endereço depois da proposta descarta a proposta; a nova busca usa o endereço novo', async () => {
    const catalog = new CatalogoFake();
    const { iris } = agente({ catalog });
    await abrir(iris);
    await iris.mensagem(msg('ana', 'quero um lanche'));
    expect((await iris.propor(CHAT, 'ana')).outcome).toBe('proposed');

    await iris.pedirOutroEndereco(CHAT, 'ana');
    // Durante a troca, não dá para fechar com o endereço antigo.
    expect((await iris.fechar(CHAT, 'ana')).outcome).toBe('address_required');

    await iris.mensagem(msg('ana', 'Av Paulista, 1000 - Bela Vista, São Paulo'));
    const confirmado = await iris.confirmarEndereco(CHAT, 'ana');
    expect(confirmado.session?.status).toBe('collecting');
    expect(confirmado.session?.proposal).toBeUndefined();
    expect(confirmado.actions).toContainEqual({
      type: 'send_message',
      sessionId: CHAT,
      text: 'O endereço de entrega mudou; a proposta anterior foi descartada. Monte uma nova quando quiser.',
    });

    catalog.calls.length = 0;
    expect((await iris.propor(CHAT, 'ana')).outcome).toBe('proposed');
    expect(catalog.calls.every((c) => c.address === 'Av Paulista, 1000 - Bela Vista, São Paulo')).toBe(true);
  });

  it('confirmar o mesmo endereço de novo não descarta a proposta', async () => {
    const { iris } = agente();
    await abrir(iris);
    await iris.mensagem(msg('ana', 'quero um lanche'));
    await iris.propor(CHAT, 'ana');
    await iris.pedirOutroEndereco(CHAT, 'ana');
    await iris.mensagem(msg('ana', ENDERECO_FAKE));
    const r = await iris.confirmarEndereco(CHAT, 'ana');
    expect(r.session?.proposal).toBeDefined();
    expect(r.session?.status).toBe('reviewing');
  });
});

describe('agente: orçamento com entrega e taxa de serviço', () => {
  /** Ana quer lanche; Bia quer bolo "até 10 reais": o bolo cabe, mas com entrega e taxa passa. */
  async function biaAcima(extra: Partial<AgenteDeps> = {}) {
    const ctx = agente(extra);
    await abrir(ctx.iris);
    await ctx.iris.mensagem(msg('ana', 'quero um lanche'));
    await ctx.iris.mensagem(msg('bia', 'bolo de cenoura, até 10 reais'), 'Bia');
    const proposta = await ctx.iris.propor(CHAT, 'ana');
    expect(proposta.outcome).toBe('proposed');
    return { ...ctx, proposta };
  }
  const shareDe = (r: { proposal?: { split: { shares: { participantId: string; totalCents: number }[] } } }, id: string) =>
    r.proposal?.split.shares.find((s) => s.participantId === id);

  it('propor cota a taxa de serviço e pergunta no privado a quem passou', async () => {
    const { proposta } = await biaAcima();
    expect(proposta.proposal?.orders.every((o) => o.serviceFeeCents !== undefined)).toBe(true);
    expect(proposta.pendingBudget).toEqual(['bia']);
    const pergunta = proposta.actions.find((a) => a.type === 'budget_question');
    expect(pergunta).toMatchObject({ participantId: 'bia', totalCents: shareDe(proposta, 'bia')?.totalCents });
    // O valor da Bia só aparece em ação privada.
    const total = String(shareDe(proposta, 'bia')?.totalCents);
    const grupo = proposta.actions.filter((a) => a.type === 'send_message' && a.participantId === undefined);
    expect(JSON.stringify(grupo)).not.toContain(total);
  });

  it('fechar fica bloqueado até a pessoa responder; depois de aceitar, fecha com a taxa', async () => {
    const { iris } = await biaAcima();

    const bloqueado = await iris.fechar(CHAT, 'ana');
    expect(bloqueado.outcome).toBe('budget_pending');
    expect(bloqueado.problems).toEqual([{ code: 'budget_pending', participantIds: ['bia'] }]);
    expect(bloqueado.actions).toEqual([{ type: 'send_message', sessionId: CHAT, text: publico.TEXTOS_ORCAMENTO.aguardando(['Bia']) }]);

    const aceite = await iris.responderOrcamento(CHAT, 'bia', 'aceito');
    expect(aceite.outcome).toBe('budget_accepted');
    expect(aceite.pendingBudget).toEqual([]);

    const fechado = await iris.fechar(CHAT, 'ana');
    expect(fechado.outcome).toBe('closed');
    expect(fechado.order?.orders.every((o) => o.serviceFeeCents !== undefined)).toBe(true);
    expect(fechado.order?.split.shares.reduce((s, p) => s + p.totalCents, 0)).toBe(fechado.order?.split.totalCents);
  });

  it('só a própria pessoa responde a pergunta dela', async () => {
    const { iris } = await biaAcima();
    expect((await iris.responderOrcamento(CHAT, 'ana', 'aceito')).outcome).toBe('budget_nothing_pending');
    expect((await iris.fechar(CHAT, 'ana')).outcome).toBe('budget_pending');
  });

  it('"fico sem" tira a pessoa, recota a taxa e libera o fechamento', async () => {
    const catalog = new CatalogoFake();
    const { iris } = await biaAcima({ catalog });
    const antes = catalog.calls.filter((c) => c.operation === 'quoteOrder').length;

    const r = await iris.responderOrcamento(CHAT, 'bia', 'fico_sem');
    expect(r.outcome).toBe('budget_left_out');
    expect(r.proposal?.orders.flatMap((o) => o.items).some((i) => i.participantId === 'bia')).toBe(false);
    expect(catalog.calls.filter((c) => c.operation === 'quoteOrder').length).toBeGreaterThan(antes);
    expect(r.actions.some((a) => a.type === 'session_updated')).toBe(true);
    expect((await iris.fechar(CHAT, 'ana')).outcome).toBe('closed');
  });

  it('ajuste do grupo zera as respostas: quem aceitou e continua acima é perguntado de novo', async () => {
    const { iris } = await biaAcima();
    await iris.responderOrcamento(CHAT, 'bia', 'aceito');
    const ajuste = await iris.mensagem(msg('ana', 'troca o meu por um café'));
    expect(ajuste.outcome).toBe('adjusted');
    expect(ajuste.actions.some((a) => a.type === 'budget_question' && a.participantId === 'bia')).toBe(true);
    expect((await iris.fechar(CHAT, 'ana')).outcome).toBe('budget_pending');
  });

  it('taxa de serviço mudou no fechamento: recusa, atualiza a proposta e fecha na segunda vez', async () => {
    const fake = new CatalogoFake();
    let acrescimo = 0;
    const catalog: CatalogPort = {
      validateAddress: (t) => fake.validateAddress(t),
      searchStores: (q, a) => fake.searchStores(q, a),
      getMenu: (id, a) => fake.getMenu(id, a),
      quoteOrder: async (id, itens, a) => {
        const { serviceFeeCents } = await fake.quoteOrder(id, itens, a);
        return { serviceFeeCents: serviceFeeCents + acrescimo };
      },
    };
    const { iris, proposta } = await biaAcima({ catalog });
    await iris.responderOrcamento(CHAT, 'bia', 'aceito');

    acrescimo = 50;
    const recusado = await iris.fechar(CHAT, 'ana');
    expect(recusado.outcome).toBe('close_rejected');
    expect(recusado.problems?.[0]).toMatchObject({ code: 'service_fee_changed' });
    expect(recusado.proposal?.id).toBe(`${proposta.proposal?.id}-r1`);
    expect(recusado.actions[0]).toEqual({ type: 'send_message', sessionId: CHAT, text: TEXTOS.taxaMudou });
    // A Bia aceitou um valor menor: é perguntada de novo pelo valor novo.
    expect(recusado.pendingBudget).toEqual(['bia']);

    await iris.responderOrcamento(CHAT, 'bia', 'aceito');
    expect((await iris.fechar(CHAT, 'ana')).outcome).toBe('closed');
  });

  it('cotação indisponível no propor: a proposta sai sem a taxa e o grupo é avisado', async () => {
    const fake = new CatalogoFake();
    const catalog: CatalogPort = {
      validateAddress: (t) => fake.validateAddress(t),
      searchStores: (q, a) => fake.searchStores(q, a),
      getMenu: (id, a) => fake.getMenu(id, a),
      quoteOrder: async () => {
        throw new Error('timeout');
      },
    };
    const { iris } = agente({ catalog });
    await abrir(iris);
    await iris.mensagem(msg('ana', 'quero um lanche'));
    const r = await iris.propor(CHAT, 'ana');
    expect(r.outcome).toBe('proposed');
    expect(r.proposal?.orders[0]?.serviceFeeCents).toBeUndefined();
    expect(r.actions).toContainEqual({ type: 'send_message', sessionId: CHAT, text: publico.TEXTOS_ORCAMENTO.taxaIndisponivel });
    // No fechamento, sem conseguir cotar, não fecha.
    const fechar = await iris.fechar(CHAT, 'ana');
    expect(fechar.outcome).toBe('close_rejected');
    expect(fechar.problems).toEqual([{ code: 'service_fee_unavailable', storeId: r.proposal?.orders[0]?.storeId }]);
  });
});
