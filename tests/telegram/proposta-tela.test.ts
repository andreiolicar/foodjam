import { describe, expect, it } from 'vitest';

import { CatalogoFake, ENDERECO_FAKE, FakeLlm, criarAgente, responderHeuristico } from '../../src/core/index.js';
import { exibirProposta, retirarBotoesDoCard, type ApiCard } from '../../src/telegram/services/proposta-tela.js';

interface Enviada {
  chatId: string;
  messageId: number;
  text: string;
  botoes: string[];
}

function apiFalsa() {
  const enviadas: Enviada[] = [];
  const editadas: number[] = [];
  let proximoId = 100;
  const api = {
    sendMessage: async (chatId: string | number, text: string, other?: { reply_markup?: unknown }) => {
      const markup = other?.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined;
      const messageId = proximoId++;
      enviadas.push({ chatId: String(chatId), messageId, text, botoes: markup?.inline_keyboard?.flat().map((b) => b.text) ?? [] });
      return { message_id: messageId };
    },
    editMessageReplyMarkup: async (_chatId: string | number, messageId: number) => {
      editadas.push(messageId);
      return true;
    },
  } as unknown as ApiCard;
  return { api, enviadas, editadas };
}

const ANA = { id: '1', displayName: 'Ana' };
const BIA = { id: '2', displayName: 'Bia' };

/** Grupo com endereço, duas preferências e proposta montada. */
async function comProposta(grupo: string, comAlternativa = false) {
  const iris = criarAgente({ catalog: new CatalogoFake(), llm: new FakeLlm(responderHeuristico), enderecoPadrao: ENDERECO_FAKE });
  await iris.iniciar(grupo, ANA);
  await iris.confirmarEndereco(grupo, ANA.id);
  if (comAlternativa) {
    // Mesmo cenário do teste do core que gera alternativa.
    await iris.mensagens(grupo, [
      { participantId: ANA.id, text: 'bora de hambúrguer', displayName: ANA.displayName },
      { participantId: '3', text: 'algo leve, sou vegetariano', displayName: 'Caio' },
      { participantId: BIA.id, text: 'quero um lanche e um bolo de cenoura', displayName: BIA.displayName },
    ]);
  } else {
    await iris.mensagem({ sessionId: grupo, participantId: ANA.id, text: 'quero um lanche' }, ANA.displayName);
    await iris.mensagem({ sessionId: grupo, participantId: BIA.id, text: 'bolo de cenoura' }, BIA.displayName);
  }
  const proposta = await iris.propor(grupo, ANA.id);
  expect(proposta.outcome).toBe('proposed');
  return { iris, proposta };
}

describe('exibirProposta', () => {
  it('desenha o card com nomes das lojas e itens, nomes das pessoas e botões', async () => {
    const grupo = '-1001';
    const { iris, proposta } = await comProposta(grupo);
    const { api, enviadas } = apiFalsa();

    expect(await exibirProposta(api, iris, grupo, proposta, 'iris_bot')).toBe(true);

    const card = enviadas.find((e) => e.botoes.length > 0);
    const nomes = await iris.nomes(grupo);
    expect(card?.chatId).toBe(grupo);
    for (const order of proposta.proposal?.orders ?? []) expect(card?.text).toContain(nomes?.lojas[order.storeId]);
    expect(card?.text).toContain('Ana');
    expect(card?.text).toContain('Bia');
    expect(card?.text).not.toContain('"storeId"');
    expect(card?.botoes).toContain('✅ Confirmar pedido');
    expect(card?.botoes.includes('🔄 Outra opção')).toBe(proposta.alternative !== undefined);
  });

  it('"Outra opção" troca a proposta e tira os botões do card anterior', async () => {
    const grupo = '-1002';
    const { iris, proposta } = await comProposta(grupo, true);
    expect(proposta.alternative).toBeDefined();
    const { api, enviadas, editadas } = apiFalsa();

    await exibirProposta(api, iris, grupo, proposta, 'iris_bot');
    const primeiro = enviadas.find((e) => e.botoes.length > 0)?.messageId;

    const trocada = await iris.outraOpcao(grupo, ANA.id);
    expect(trocada.outcome).toBe('switched');
    await exibirProposta(api, iris, grupo, trocada, 'iris_bot');

    expect(editadas).toEqual([primeiro]);
    const ultimo = enviadas.filter((e) => e.botoes.length > 0).at(-1);
    expect(ultimo?.botoes).toContain('🔄 Outra opção');
  });

  it('depois de um ajuste a alternativa some, e o botão também', async () => {
    const grupo = '-1003';
    const { iris } = await comProposta(grupo);
    const { api, enviadas } = apiFalsa();

    const ajuste = await iris.mensagem({ sessionId: grupo, participantId: BIA.id, text: 'troca o meu por um café' }, BIA.displayName);
    expect(ajuste.outcome).toBe('adjusted');
    await exibirProposta(api, iris, grupo, ajuste, 'iris_bot');

    expect(enviadas.find((e) => e.botoes.length > 0)?.botoes).not.toContain('🔄 Outra opção');
  });

  it('sem proposta, só envia as actions e devolve false', async () => {
    const iris = criarAgente({ catalog: new CatalogoFake(), llm: new FakeLlm(responderHeuristico) });
    const { api } = apiFalsa();
    expect(await exibirProposta(api, iris, '-1004', { outcome: 'no_candidates', actions: [] }, 'iris_bot')).toBe(false);
  });

  it('retirar botões sem card na tela não faz nada', async () => {
    const { api, editadas } = apiFalsa();
    await retirarBotoesDoCard(api, '-1005');
    expect(editadas).toEqual([]);
  });
});
