import { InlineKeyboard, type Api } from 'grammy';

import type { Agente, Proposal, Resposta, SessionId } from '../../core/index.js';
import { apresentarActions, teclado } from './apresentacao.js';
import { botoesCard, textoProposta } from './card.js';

export type ApiCard = Pick<Api, 'sendMessage' | 'editMessageReplyMarkup' | 'editMessageText'>;
type IrisCard = Pick<Agente, 'nomes' | 'obter'>;

// Mensagem do card com botões em cada grupo: ao desenhar outro card (ou a proposta
// sair da mesa), os botões do anterior são retirados para ninguém clicar numa sugestão velha.
const ultimoCard = new Map<SessionId, number>();

export async function retirarBotoesDoCard(api: ApiCard, sessionId: SessionId): Promise<void> {
  const messageId = ultimoCard.get(sessionId);
  if (messageId === undefined) return;
  ultimoCard.delete(sessionId);
  try {
    await api.editMessageReplyMarkup(sessionId, messageId, { reply_markup: new InlineKeyboard() });
  } catch {
    // a mensagem pode já ter sido editada ou apagada; ignora
  }
}

/** Texto e botões do card para a proposta da resposta. */
async function montarCard(iris: IrisCard, sessionId: SessionId, resposta: Resposta, proposal: Proposal) {
  const sessao = resposta.session ?? (await iris.obter(sessionId));
  const nomes = await iris.nomes(sessionId);
  const temAlternativa = sessao ? sessao.alternative !== undefined : resposta.alternative !== undefined;
  const texto = textoProposta({
    proposal,
    participantes: sessao?.participants ?? [],
    ...(nomes && { nomes }),
    ...(resposta.pendingBudget && { pendentes: resposta.pendingBudget }),
  });
  return { texto, opcoes: { parse_mode: 'HTML' as const, reply_markup: teclado(botoesCard(temAlternativa)) } };
}

/**
 * Desenha a proposta da resposta no grupo, com os botões de decisão, e envia as
 * actions (perguntas de valor no privado, avisos). Devolve false se não há proposta.
 */
export async function exibirProposta(
  api: ApiCard,
  iris: IrisCard,
  sessionId: SessionId,
  resposta: Resposta,
  botUsername: string,
): Promise<boolean> {
  const proposal = resposta.proposal;
  if (!proposal) {
    await apresentarActions(api, resposta, botUsername);
    return false;
  }

  const card = await montarCard(iris, sessionId, resposta, proposal);
  await retirarBotoesDoCard(api, sessionId);
  const enviada = await api.sendMessage(sessionId, card.texto, card.opcoes);
  ultimoCard.set(sessionId, enviada.message_id);

  await apresentarActions(api, resposta, botUsername);
  return true;
}

/**
 * Atualiza o card que já está na tela, sem mandar outro (ex.: alguém aceitou o
 * valor e saiu da lista de espera). Sem card na tela, não faz nada.
 */
export async function atualizarCard(api: ApiCard, iris: IrisCard, sessionId: SessionId, resposta: Resposta): Promise<void> {
  const messageId = ultimoCard.get(sessionId);
  if (messageId === undefined || !resposta.proposal) return;

  const card = await montarCard(iris, sessionId, resposta, resposta.proposal);
  try {
    await api.editMessageText(sessionId, messageId, card.texto, card.opcoes);
  } catch {
    // texto igual ou mensagem apagada; ignora
  }
}
