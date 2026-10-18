import type { CoreAction, ParticipantId, Resposta, SessionId } from '../../core/index.js';
import { callbackEndereco, callbackOrcamento } from './callbacks.js';

export interface Botao {
  texto: string;
  data: string;
}

/** Uma mensagem a enviar no Telegram, já com destino e botões decididos. */
export interface Envio {
  /** Chat de destino: o grupo (sessionId) ou o privado da pessoa (participantId). */
  chatId: string;
  text: string;
  botoes?: Botao[][];
  /** Presente quando a mensagem é privada: se a DM falhar, o grupo é avisado sem o conteúdo. */
  privado?: { participantId: ParticipantId; sessionId: SessionId };
  /** Pergunta de valor (budget_question ou item_suggestion): a nova substitui os botões da anterior. */
  orcamento?: true;
}

function privado(sessionId: SessionId, participantId: ParticipantId, text: string, botoes?: Botao[][]): Envio {
  return { chatId: participantId, text, ...(botoes && { botoes }), privado: { participantId, sessionId } };
}

const comoOrcamento = (envio: Envio): Envio => ({ ...envio, orcamento: true });

export const ROTULOS = {
  sim: 'Sim',
  outroEndereco: 'Outro endereço',
  confirmar: 'Confirmar',
  corrigir: 'Corrigir',
  aceito: 'Aceito',
  queroOutro: 'Quero outro',
  aceitoSugestao: 'Aceito a sugestão',
  ficoSem: 'Fico sem',
} as const;

/** Traduz uma action do core em mensagem do Telegram. session_updated não gera mensagem. */
export function planejarEnvio(action: CoreAction): Envio | undefined {
  switch (action.type) {
    case 'send_message':
      return action.participantId !== undefined
        ? privado(action.sessionId, action.participantId, action.text)
        : { chatId: action.sessionId, text: action.text };

    case 'session_updated':
      return undefined;

    case 'request_address':
      return privado(action.sessionId, action.participantId, action.text);

    case 'confirm_address': {
      const [sim, outro] =
        action.kind === 'default' ? [ROTULOS.sim, ROTULOS.outroEndereco] : [ROTULOS.confirmar, ROTULOS.corrigir];
      return privado(action.sessionId, action.participantId, action.text, [
        [
          { texto: sim, data: callbackEndereco('confirmar', action.sessionId) },
          { texto: outro, data: callbackEndereco('outro', action.sessionId) },
        ],
      ]);
    }

    case 'budget_question':
      return comoOrcamento(privado(action.sessionId, action.participantId, action.text, [
        [
          { texto: ROTULOS.aceito, data: callbackOrcamento('aceito', action.sessionId) },
          { texto: ROTULOS.queroOutro, data: callbackOrcamento('quero_outro', action.sessionId) },
        ],
      ]));

    case 'item_suggestion': {
      const ficoSem = { texto: ROTULOS.ficoSem, data: callbackOrcamento('fico_sem', action.sessionId) };
      const linha =
        action.menuItemId !== undefined
          ? [{ texto: ROTULOS.aceitoSugestao, data: callbackOrcamento('aceito_sugestao', action.sessionId) }, ficoSem]
          : [ficoSem];
      return comoOrcamento(privado(action.sessionId, action.participantId, action.text, [linha]));
    }
  }
}

export function planejarEnvios(resposta: Resposta): Envio[] {
  return resposta.actions.flatMap((action) => planejarEnvio(action) ?? []);
}
