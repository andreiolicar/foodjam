import { registrarEnderecoEnviado } from './callbacks.js';
import { InlineKeyboard, type Api } from 'grammy';

import type { ParticipantId, Resposta } from '../../core/index.js';
import { planejarEnvios, type Botao, type Envio } from './envios.js';
import { guardarPendente, lembrarSessao } from './privado.js';

/** Só o que a apresentação usa da API do Telegram (facilita testar). */
export type ApiEnvio = Pick<Api, 'sendMessage' | 'editMessageReplyMarkup'>;

// Última pergunta de valor com botões de cada pessoa em cada grupo. Quando chega
// outra (efeito cascata, outra opção, ajuste), os botões da anterior saem: assim
// ninguém aceita um valor que não é mais o atual.
const ultimaPerguntaValor = new Map<string, { chatId: string; messageId: number }>();

export function teclado(botoes: Botao[][]): InlineKeyboard {
  const kb = new InlineKeyboard();
  botoes.forEach((linha, i) => {
    if (i > 0) kb.row();
    for (const botao of linha) kb.text(botao.texto, botao.data);
  });
  return kb;
}

export function textoAvisoPrivado(nome: string): string {
  return `${nome}, tenho uma mensagem só para você. Toque no botão abaixo e depois em "Iniciar" para recebê-la.`;
}

async function tirarBotoes(api: ApiEnvio, chatId: string, messageId: number): Promise<void> {
  try {
    await api.editMessageReplyMarkup(chatId, messageId, { reply_markup: new InlineKeyboard() });
  } catch {
    // a mensagem pode já ter sido editada ou apagada; ignora
  }
}

export async function enviar(api: ApiEnvio, envio: Envio): Promise<void> {
  const chave = envio.orcamento && envio.privado ? `${envio.privado.sessionId}:${envio.privado.participantId}` : undefined;
  const anterior = chave !== undefined ? ultimaPerguntaValor.get(chave) : undefined;

  const enviada = await api.sendMessage(envio.chatId, envio.text, envio.botoes && { reply_markup: teclado(envio.botoes) });

  const binding = envio.confirmacaoEndereco ?? envio.privado;
  if (envio.endereco && binding) {
    const anteriores = registrarEnderecoEnviado(envio.chatId, enviada.message_id, binding.sessionId, binding.participantId, envio.endereco);
    for (const old of anteriores) await tirarBotoes(api, old.chatId, old.messageId);
  }
  if (chave === undefined) return;
  if (anterior) await tirarBotoes(api, anterior.chatId, anterior.messageId);
  if (typeof enviada?.message_id === 'number') {
    ultimaPerguntaValor.set(chave, { chatId: envio.chatId, messageId: enviada.message_id });
  }
}

/**
 * Envia as actions da resposta, na ordem. Mensagem privada que falha (a pessoa
 * nunca falou com o bot) fica guardada para o /start, e o grupo recebe um aviso
 * com o nome dela, sem o conteúdo (pode ter valores).
 */
export async function apresentarActions(api: ApiEnvio, resposta: Resposta, botUsername: string): Promise<void> {
  const avisados = new Set<ParticipantId>();

  for (const envio of planejarEnvios(resposta)) {
    if (envio.privado) lembrarSessao(envio.privado.participantId, envio.privado.sessionId);

    try {
      await enviar(api, envio);
    } catch {
      if (!envio.privado) {
        console.error('Não foi possível enviar mensagem ao grupo. Dados privados omitidos.');
        continue;
      }

      const { participantId, sessionId } = envio.privado;
      guardarPendente(participantId, envio);
      if (avisados.has(participantId)) continue;
      avisados.add(participantId);

      const nome = resposta.session?.participants.find((p) => p.id === participantId)?.displayName ?? 'Ei';
      try {
        await api.sendMessage(sessionId, textoAvisoPrivado(nome), {
          reply_markup: new InlineKeyboard().url('Abrir conversa', `https://t.me/${botUsername}?start=pendentes`),
        });
      } catch {
        console.error('Não foi possível avisar no grupo sobre a mensagem privada. Dados privados omitidos.');
      }
    }
  }
}

