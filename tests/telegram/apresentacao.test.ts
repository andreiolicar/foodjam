import { describe, expect, it } from 'vitest';

import {
  CatalogoFake,
  ENDERECO_FAKE,
  FakeLlm,
  criarAgente,
  responderHeuristico,
  type Resposta,
} from '../../src/core/index.js';
import { apresentarActions, textoAvisoPrivado, type ApiEnvio } from '../../src/telegram/services/apresentacao.js';
import { lerCallback } from '../../src/telegram/services/callbacks.js';
import { retirarPendentes, sessaoDa } from '../../src/telegram/services/privado.js';

interface Enviada {
  chatId: string;
  text: string;
  botoes: { text: string; callback_data?: string; url?: string }[];
}

/** API falsa: grava o que foi enviado; DMs para quem está em `bloqueados` falham. */
function apiFalsa(bloqueados: string[] = []) {
  const enviadas: Enviada[] = [];
  const api = {
    sendMessage: async (chatId: string | number, text: string, other?: { reply_markup?: unknown }) => {
      if (bloqueados.includes(String(chatId))) throw new Error('403: bot can\'t initiate conversation with a user');
      const markup = other?.reply_markup as { inline_keyboard?: Enviada['botoes'][] } | undefined;
      enviadas.push({ chatId: String(chatId), text, botoes: markup?.inline_keyboard?.flat() ?? [] });
      return {};
    },
  } as unknown as ApiEnvio;
  return { api, enviadas };
}

const GRUPO = '-100777';
const ANA = { id: '42', displayName: 'Ana' };

function agente(enderecoPadrao?: string) {
  return criarAgente({
    catalog: new CatalogoFake(),
    llm: new FakeLlm(responderHeuristico),
    ...(enderecoPadrao && { enderecoPadrao }),
  });
}

describe('apresentarActions', () => {
  it('ao iniciar sem endereço padrão, pede o endereço no privado do organizador', async () => {
    const iris = agente();
    const { api, enviadas } = apiFalsa();

    await apresentarActions(api, await iris.iniciar(GRUPO, ANA), 'iris_bot');

    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toMatchObject({ chatId: ANA.id, botoes: [] });
    expect(sessaoDa(ANA.id)).toBe(GRUPO);
  });

  it('endereço padrão: [Sim] confirma a sessão do grupo a partir do privado', async () => {
    const iris = agente(ENDERECO_FAKE);
    const { api, enviadas } = apiFalsa();

    await apresentarActions(api, await iris.iniciar(GRUPO, ANA), 'iris_bot');

    const [confirmacao] = enviadas;
    expect(confirmacao?.chatId).toBe(ANA.id);
    expect(confirmacao?.botoes.map((b) => b.text)).toEqual(['Sim', 'Outro endereço']);

    const sim = lerCallback(confirmacao?.botoes[0]?.callback_data ?? '');
    expect(sim).toEqual({ tipo: 'endereco', acao: 'confirmar', sessionId: GRUPO });

    const confirmada = await iris.confirmarEndereco(GRUPO, ANA.id);
    expect(confirmada.outcome).toBe('address_confirmed');
  });

  it('endereço digitado no privado vai para a sessão do grupo e volta com [Confirmar] [Corrigir]', async () => {
    const iris = agente();
    const { api, enviadas } = apiFalsa();
    await apresentarActions(api, await iris.iniciar(GRUPO, ANA), 'iris_bot');

    const sessionId = sessaoDa(ANA.id);
    expect(sessionId).toBe(GRUPO);

    const resposta = await iris.mensagem({ sessionId: GRUPO, participantId: ANA.id, text: ENDERECO_FAKE }, ANA.displayName);
    expect(resposta.outcome).toBe('address_typed_proposed');
    await apresentarActions(api, resposta, 'iris_bot');

    expect(enviadas.at(-1)?.botoes.map((b) => b.text)).toEqual(['Confirmar', 'Corrigir']);
  });

  it('DM que falha: guarda para o /start e avisa o grupo uma vez, sem o conteúdo', async () => {
    const { api, enviadas } = apiFalsa(['99']);
    const resposta: Resposta = {
      outcome: 'proposed',
      session: { id: GRUPO, organizerId: ANA.id, status: 'reviewing', participants: [{ id: '99', displayName: 'Bia', preferences: {} }] },
      actions: [
        { type: 'budget_question', sessionId: GRUPO, participantId: '99', proposalId: 'p1', totalCents: 3850, text: 'R$ 38,50, pode ser?' },
        { type: 'send_message', sessionId: GRUPO, participantId: '99', text: 'outra privada' },
        { type: 'send_message', sessionId: GRUPO, text: 'para o grupo' },
      ],
    };

    await apresentarActions(api, resposta, 'iris_bot');

    expect(enviadas.map((e) => [e.chatId, e.text])).toEqual([
      [GRUPO, textoAvisoPrivado('Bia')],
      [GRUPO, 'para o grupo'],
    ]);
    expect(enviadas.some((e) => e.text.includes('38,50'))).toBe(false);
    expect(enviadas[0]?.botoes[0]?.url).toBe('https://t.me/iris_bot?start=pendentes');

    const pendentes = retirarPendentes('99');
    expect(pendentes.map((p) => p.text)).toEqual(['R$ 38,50, pode ser?', 'outra privada']);
    expect(pendentes[0]?.botoes?.flat().map((b) => b.texto)).toEqual(['Aceito', 'Quero outro']);
    expect(retirarPendentes('99')).toEqual([]);
  });
});

describe('pergunta de valor substituída (efeito cascata)', () => {
  it('a pergunta nova tira os botões da anterior da mesma pessoa; a de outra pessoa fica', async () => {
    const editadas: number[] = [];
    let proximo = 500;
    const api = {
      sendMessage: async () => ({ message_id: proximo++ }),
      editMessageReplyMarkup: async (_chat: string, messageId: number) => {
        editadas.push(messageId);
        return true;
      },
    } as unknown as ApiEnvio;
    const pergunta = (participantId: string, totalCents: number) => ({
      outcome: 'proposed',
      actions: [{ type: 'budget_question' as const, sessionId: '-100888', participantId, proposalId: 'p1', totalCents, text: `${totalCents}` }],
    });

    await apresentarActions(api, pergunta('bia', 3800), 'iris_bot'); // 500
    await apresentarActions(api, pergunta('caio', 3500), 'iris_bot'); // 501
    expect(editadas).toEqual([]);

    await apresentarActions(api, pergunta('bia', 4000), 'iris_bot'); // 502
    expect(editadas).toEqual([500]);
  });
});
