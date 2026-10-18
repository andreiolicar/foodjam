import { describe, expect, it } from 'vitest';

import type { CoreAction } from '../../src/core/index.js';
import { lerCallback } from '../../src/telegram/services/callbacks.js';
import { ROTULOS, planejarEnvio, type Envio } from '../../src/telegram/services/envios.js';

const GRUPO = '-100123';
const ANA = '42';

const rotulos = (envio: Envio | undefined) => envio?.botoes?.flat().map((b) => b.texto);
const dados = (envio: Envio | undefined) => envio?.botoes?.flat().map((b) => lerCallback(b.data));

describe('planejarEnvio: cada action do core vira uma mensagem', () => {
  it('send_message sem participantId vai para o grupo', () => {
    expect(planejarEnvio({ type: 'send_message', sessionId: GRUPO, text: 'oi' })).toEqual({ chatId: GRUPO, text: 'oi' });
  });

  it('send_message com participantId vai para o privado e lembra o grupo', () => {
    expect(planejarEnvio({ type: 'send_message', sessionId: GRUPO, participantId: ANA, text: 'só seu' })).toEqual({
      chatId: ANA,
      text: 'só seu',
      privado: { participantId: ANA, sessionId: GRUPO },
    });
  });

  it('session_updated não gera mensagem', () => {
    const action = { type: 'session_updated', session: { id: GRUPO, organizerId: ANA, status: 'collecting', participants: [] } };
    expect(planejarEnvio(action as CoreAction)).toBeUndefined();
  });

  it('request_address pede o endereço no privado, sem botões', () => {
    const envio = planejarEnvio({ type: 'request_address', sessionId: GRUPO, participantId: ANA, text: 'Qual o endereço?' });
    expect(envio).toMatchObject({ chatId: ANA, text: 'Qual o endereço?', privado: { sessionId: GRUPO } });
    expect(envio?.botoes).toBeUndefined();
  });

  it('confirm_address padrão: [Sim] [Outro endereço]; digitado: [Confirmar] [Corrigir]', () => {
    const base = { type: 'confirm_address', sessionId: GRUPO, participantId: ANA, address: { formatted: 'Rua A, 1' }, text: 't' } as const;

    const padrao = planejarEnvio({ ...base, kind: 'default' });
    expect(padrao?.chatId).toBe(ANA);
    expect(rotulos(padrao)).toEqual([ROTULOS.sim, ROTULOS.outroEndereco]);
    expect(dados(padrao)).toEqual([
      { tipo: 'endereco', acao: 'confirmar', sessionId: GRUPO },
      { tipo: 'endereco', acao: 'outro', sessionId: GRUPO },
    ]);

    const digitado = planejarEnvio({ ...base, kind: 'typed' });
    expect(rotulos(digitado)).toEqual([ROTULOS.confirmar, ROTULOS.corrigir]);
  });

  it('budget_question: [Aceito] [Quero outro] no privado da pessoa', () => {
    const envio = planejarEnvio({
      type: 'budget_question',
      sessionId: GRUPO,
      participantId: ANA,
      proposalId: `${GRUPO}-p1`,
      totalCents: 3850,
      text: 'Pode ser?',
    });
    expect(envio?.chatId).toBe(ANA);
    expect(rotulos(envio)).toEqual([ROTULOS.aceito, ROTULOS.queroOutro]);
    expect(dados(envio)?.map((d) => d?.tipo === 'orcamento' && d.resposta)).toEqual(['aceito', 'quero_outro']);
  });

  it('item_suggestion com item: [Aceito a sugestão] [Fico sem]; sem item: só [Fico sem]', () => {
    const base = { type: 'item_suggestion', sessionId: GRUPO, participantId: ANA, proposalId: `${GRUPO}-p1`, text: 't' } as const;

    expect(rotulos(planejarEnvio({ ...base, menuItemId: 'x', totalCents: 2000 }))).toEqual([
      ROTULOS.aceitoSugestao,
      ROTULOS.ficoSem,
    ]);
    expect(rotulos(planejarEnvio(base))).toEqual([ROTULOS.ficoSem]);
  });
});
