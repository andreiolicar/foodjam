import { describe, expect, it } from 'vitest';
import type { AgenteDeps } from '../../src/core/agente.js';
import { TEXTOS, criarAgente } from '../../src/core/agente.js';
import type { IncomingMessage } from '../../src/core/contracts.js';
import { CatalogoFake } from '../../src/core/fakes/catalogo-fake.js';
import { FakeLlm, responderHeuristico } from '../../src/core/fakes/llm-fake.js';
import * as publico from '../../src/core/index.js';
import type { CatalogPort, LlmPort } from '../../src/core/ports.js';
import { SessoesEmMemoria } from '../../src/core/sessoes.js';
import { AGORA } from './fixtures.js';

const CHAT = 'chat-1';
const ORG = { id: 'ana', displayName: 'Ana' };
const msg = (participantId: string, text: string): IncomingMessage => ({ sessionId: CHAT, participantId, text });

function agente(extra: Partial<AgenteDeps> = {}) {
  const sessions = new SessoesEmMemoria();
  const iris = criarAgente({
    catalog: new CatalogoFake(),
    llm: new FakeLlm(responderHeuristico),
    sessions,
    now: () => AGORA,
    ...extra,
  });
  return { iris, sessions };
}

/** Grupo com preferências e uma proposta pronta. */
async function comProposta() {
  const ctx = agente();
  await ctx.iris.iniciar(CHAT, ORG);
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
    await iris.iniciar(CHAT, ORG);
    const r = await iris.iniciar(CHAT, { id: 'bia', displayName: 'Bia' });
    expect(r.outcome).toBe('already_active');
    expect(r.session?.organizerId).toBe('ana');
  });

  it('depois de encerrada, uma nova menção começa outra sessão', async () => {
    const { iris } = agente();
    await iris.iniciar(CHAT, ORG);
    await iris.cancelar(CHAT, 'ana');
    const r = await iris.iniciar(CHAT, { id: 'bia', displayName: 'Bia' });
    expect(r.outcome).toBe('started');
    expect(r.session?.organizerId).toBe('bia');
  });
});

describe('agente: mensagens', () => {
  it('na coleta, registra preferência de quem chegou depois', async () => {
    const { iris } = agente();
    await iris.iniciar(CHAT, ORG);
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
    await iris.iniciar(CHAT, ORG);
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
    await iris.iniciar(CHAT, ORG);

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
    await iris.iniciar(CHAT, ORG);
    expect((await iris.fechar(CHAT, 'ana')).outcome).toBe('invalid_state');
  });

  it('fechamento recusado mantém a sessão aguardando confirmação e devolve os problemas', async () => {
    // Proposta montada com o catálogo normal...
    const record = await (await comProposta()).sessions.get(CHAT);
    if (!record) throw new Error('sem sessão');

    // ...e, na hora de fechar, as lojas aparecem fechadas.
    const port = new CatalogoFake();
    const lojasFechadas: CatalogPort = {
      searchStores: async (q) => (await port.searchStores(q)).map((s) => ({ ...s, isOpen: false })),
      getMenu: (id) => port.getMenu(id),
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
      searchStores: async () => {
        throw new Error('ECONNRESET');
      },
      getMenu: async () => [],
    };
    const { iris } = agente({ catalog: quebrado, onError: (e) => erros.push(e) });
    await iris.iniciar(CHAT, ORG);
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
    await iris.iniciar(CHAT, ORG);
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
    await iris.iniciar(CHAT, ORG);
    expect((await iris.outraOpcao(CHAT, 'ana')).outcome).toBe('no_alternative');
  });
});
