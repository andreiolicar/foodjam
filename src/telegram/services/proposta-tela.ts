import { InlineKeyboard, type Api } from 'grammy';
import { enviarFotosProposta, removerFoto } from './fotos-proposta.js';

import type { Agente, Proposal, Resposta, SessionId } from '../../core/index.js';
import { apresentarActions, teclado } from './apresentacao.js';
import { botoesCard, textoProposta, botoesPreliminares, textoPropostaPreliminar } from './card.js';

export type ApiCard = Pick<Api, 'sendMessage' | 'editMessageReplyMarkup' | 'editMessageText' | 'sendPhoto' | 'deleteMessage'>;
type IrisCard = Pick<Agente, 'nomes' | 'obter'>;

// Mensagem do card com botões em cada grupo: ao desenhar outro card (ou a proposta
// sair da mesa), os botões do anterior são retirados para ninguém clicar numa sugestão velha.
const ultimoCard = new Map<SessionId, { messageId: number; proposalId: string; photos: Set<number>; iris: IrisCard }>();
const renderizando = new Map<SessionId, symbol>();
export const cardAtual = (sessionId: string, messageId: number) => ultimoCard.get(sessionId)?.messageId === messageId;
export const propostaDoCard = (sessionId: string, messageId: number) => cardAtual(sessionId, messageId) ? ultimoCard.get(sessionId)?.proposalId : undefined;

export async function retirarBotoesDoCard(api: ApiCard, sessionId: SessionId): Promise<void> {
  renderizando.delete(sessionId);
  await limparCard(api, sessionId);
}

async function limparCard(api: ApiCard, sessionId: SessionId): Promise<void> {
  const previous = ultimoCard.get(sessionId);
  if (!previous) return;
  const { messageId, photos } = previous;
  ultimoCard.delete(sessionId);
  // Limpeza de mídia é best effort e não atrasa o próximo card.
  for (const id of photos) void removerFoto(api, sessionId, id);
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

async function montarPreliminar(iris: IrisCard, sessionId: string, resposta: Resposta) {
  const proposal = resposta.preliminary!;
  const session = resposta.session ?? await iris.obter(sessionId);
  const nomes = await iris.nomes(sessionId);
  return { texto: textoPropostaPreliminar({ proposal, ...(nomes ? { nomes } : {}), ...(resposta.items ? { items: resposta.items } : {}), ...(resposta.stores ? { stores: resposta.stores } : {}), ...(resposta.collection ? { collection: resposta.collection } : {}) }),
    opcoes: { parse_mode: 'HTML' as const, reply_markup: teclado(botoesPreliminares(Boolean(session?.preliminaryAlternative))) } };
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
  if (!proposal && !resposta.preliminary) {
    await apresentarActions(api, resposta, botUsername);
    return false;
  }

  const proposalId = (resposta.preliminary ?? proposal)!.id;
  if (resposta.preliminary && ultimoCard.get(sessionId)?.iris === iris && ultimoCard.get(sessionId)?.proposalId === proposalId) {
    await atualizarCard(api, iris, sessionId, resposta);
    await apresentarActions(api, resposta, botUsername);
    return true;
  }
  const render = Symbol(); renderizando.set(sessionId, render);
  const ativa = () => renderizando.get(sessionId) === render;
  const vigente = async () => {
    if (!ativa()) return false;
    const session = resposta.preliminary ? await iris.obter(sessionId) : undefined;
    // A própria leitura assíncrona pode atravessar uma nova apresentação.
    return ativa() && (!resposta.preliminary || session?.preliminary?.id === proposalId);
  };
  const card = resposta.preliminary ? await montarPreliminar(iris, sessionId, resposta) : await montarCard(iris, sessionId, resposta, proposal!);
  if (!await vigente() || !ativa()) return true;
  await limparCard(api, sessionId);
  if (!await vigente() || !ativa()) return true;
  const enviada = await api.sendMessage(sessionId, card.texto, card.opcoes);
  if (!await vigente() || !ativa()) {
    try { await api.editMessageReplyMarkup(sessionId, enviada.message_id, { reply_markup: new InlineKeyboard() }); } catch { /* Card substituído. */ }
    return true;
  }
  const photos = new Set<number>();
  ultimoCard.set(sessionId, { messageId: enviada.message_id, proposalId, photos, iris });
  await enviarFotosProposta(api, sessionId, resposta, enviada.message_id, vigente, photos, ativa);

  await apresentarActions(api, resposta, botUsername);
  return true;
}

/**
 * Atualiza o card que já está na tela, sem mandar outro (ex.: alguém aceitou o
 * valor e saiu da lista de espera). Sem card na tela, não faz nada.
 */
export async function atualizarCard(api: ApiCard, iris: IrisCard, sessionId: SessionId, resposta: Resposta): Promise<void> {
  const previous = ultimoCard.get(sessionId);
  const messageId = previous?.messageId;
  if (!previous || previous.iris !== iris || messageId === undefined || !resposta.proposal && !resposta.preliminary) return;
  // Uma atualização nunca reutiliza a identidade de mensagem de outra revisão.
  if (resposta.preliminary && previous.proposalId !== resposta.preliminary.id) return;

  const card = resposta.preliminary ? await montarPreliminar(iris, sessionId, resposta) : await montarCard(iris, sessionId, resposta, resposta.proposal!);
  try {
    await api.editMessageText(sessionId, messageId, card.texto, card.opcoes);
    if (ultimoCard.get(sessionId) === previous) ultimoCard.set(sessionId, { ...previous, messageId, proposalId: (resposta.preliminary ?? resposta.proposal)!.id });
  } catch {
    // texto igual ou mensagem apagada; ignora
  }
}
