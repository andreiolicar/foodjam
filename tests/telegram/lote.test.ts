import { describe, expect, it } from 'vitest';

import {
  CatalogoFake,
  ENDERECO_FAKE,
  FakeLlm,
  criarAgente,
  criarAgrupador,
  responderHeuristico,
  type Resposta,
} from '../../src/core/index.js';
import { lembrarMensagem, loteAjustouProposta, reagirPreferencias } from '../../src/telegram/services/lote.js';

const GRUPO = '-100555';
const ANA = { id: '1', displayName: 'Ana' };
const BIA = { id: '2', displayName: 'Bia' };

/** Grupo com endereço confirmado e um agrupador que guarda as respostas dos lotes. */
async function grupo() {
  const iris = criarAgente({ catalog: new CatalogoFake(), llm: new FakeLlm(responderHeuristico), enderecoPadrao: ENDERECO_FAKE });
  await iris.iniciar(GRUPO, ANA);
  await iris.confirmarEndereco(GRUPO, ANA.id);

  const respostas: Resposta[] = [];
  const agrupador = criarAgrupador(iris, { esperaMs: 60_000, aoResponder: (_id, r) => void respostas.push(r) });
  return { iris, agrupador, respostas };
}

describe('mensagens do grupo pelo agrupador', () => {
  it('a coleta vai direto ao core com o nome real; /montar esvazia o lote antes de propor', async () => {
    const { iris, agrupador, respostas } = await grupo();

    agrupador.adicionar({ sessionId: GRUPO, participantId: ANA.id, text: 'quero um lanche' }, ANA.displayName);
    agrupador.adicionar({ sessionId: GRUPO, participantId: BIA.id, text: 'bolo de cenoura' }, BIA.displayName);
    expect(agrupador.pendentes(GRUPO)).toBe(2);

    await agrupador.esvaziar(GRUPO);
    expect(respostas).toHaveLength(1);
    expect(respostas[0]?.resultados).toEqual(
      expect.arrayContaining([
        { participantId: ANA.id, outcome: 'preference_updated' },
        { participantId: BIA.id, outcome: 'preference_updated' },
      ]),
    );

    // O core guarda as preferências extraídas (não o texto), com o nome de quem falou.
    const sessao = await iris.obter(GRUPO);
    expect(sessao?.participants.map((p) => p.displayName)).toEqual(['Ana', 'Bia']);

    const proposta = await iris.propor(GRUPO, ANA.id);
    expect(proposta.outcome).toBe('proposed');
    expect(proposta.proposal?.split.shares.map((s) => s.participantId).sort()).toEqual([ANA.id, BIA.id]);
  });

  it('com proposta na mesa, a mensagem do grupo vira ajuste e a proposta nova deve ser redesenhada', async () => {
    const { iris, agrupador, respostas } = await grupo();
    agrupador.adicionar({ sessionId: GRUPO, participantId: ANA.id, text: 'quero um lanche' }, ANA.displayName);
    agrupador.adicionar({ sessionId: GRUPO, participantId: BIA.id, text: 'bolo de cenoura' }, BIA.displayName);
    await agrupador.esvaziar(GRUPO);
    await iris.propor(GRUPO, ANA.id);

    agrupador.adicionar({ sessionId: GRUPO, participantId: BIA.id, text: 'troca o meu por um café' }, BIA.displayName);
    await agrupador.esvaziar(GRUPO);

    const ajuste = respostas.at(-1);
    expect(ajuste?.resultados).toEqual([{ participantId: BIA.id, outcome: 'adjusted' }]);
    expect(ajuste && loteAjustouProposta(ajuste)).toBe(true);
  });

  it('lote só de coleta não pede para redesenhar a proposta', () => {
    const resposta: Resposta = { outcome: 'batch', actions: [], resultados: [{ participantId: ANA.id, outcome: 'preference_updated' }] };
    expect(loteAjustouProposta(resposta)).toBe(false);
  });
});

describe('reagirPreferencias', () => {
  it('reage com 👍 à última mensagem de quem teve a preferência registrada', async () => {
    const reacoes: [string | number, number, unknown][] = [];
    const api = {
      setMessageReaction: async (chatId: string | number, messageId: number, reaction: unknown) => {
        reacoes.push([chatId, messageId, reaction]);
        return true as const;
      },
    };

    lembrarMensagem(GRUPO, ANA.id, 10);
    lembrarMensagem(GRUPO, ANA.id, 11);
    lembrarMensagem(GRUPO, BIA.id, 12);

    await reagirPreferencias(api, GRUPO, {
      outcome: 'batch',
      actions: [],
      resultados: [
        { participantId: ANA.id, outcome: 'preference_updated' },
        { participantId: BIA.id, outcome: 'irrelevant' },
      ],
    });

    expect(reacoes).toEqual([[GRUPO, 11, [{ type: 'emoji', emoji: '👍' }]]]);
  });

  it('falha ao reagir (reações desligadas) não interrompe', async () => {
    const api = {
      setMessageReaction: async () => {
        throw new Error('400: REACTION_INVALID');
      },
    };
    lembrarMensagem(GRUPO, ANA.id, 20);

    await expect(
      reagirPreferencias(api, GRUPO, { outcome: 'batch', actions: [], resultados: [{ participantId: ANA.id, outcome: 'preference_updated' }] }),
    ).resolves.toBeUndefined();
  });
});
