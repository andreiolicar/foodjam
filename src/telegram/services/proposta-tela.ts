import { GrammyError, InlineKeyboard, type Api } from 'grammy';
import { enviarFotoProposta, removerFoto } from './fotos-proposta.js';

import type { Agente, Proposal, Resposta, SessionId } from '../../core/index.js';
import { apresentarActions, teclado } from './apresentacao.js';
import { botoesCard, textoProposta, botoesPreliminares, textoPropostaPreliminar, legendaPropostaPreliminar } from './card.js';

export type ApiCard = Pick<Api, 'sendMessage' | 'editMessageReplyMarkup' | 'editMessageText' | 'sendPhoto' | 'deleteMessage' | 'editMessageCaption'>;
type IrisCard = Pick<Agente, 'nomes' | 'obter'>;

// Mensagem do card com botões em cada grupo: ao desenhar outro card (ou a proposta
// sair da mesa), os botões do anterior são retirados para ninguém clicar numa sugestão velha.
const ultimoCard = new Map<SessionId, { messageId: number; proposalId: string; kind: 'photo' | 'text'; render: symbol; iris: IrisCard }>();
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
  const { messageId } = previous;
  ultimoCard.delete(sessionId);
  if (previous.kind === 'photo') {
    void removerFoto(api, sessionId, messageId);
    return;
  }
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
  return { texto, legenda: undefined, opcoes: { parse_mode: 'HTML' as const, reply_markup: teclado(botoesCard(temAlternativa)) } };
}

async function montarPreliminar(iris: IrisCard, sessionId: string, resposta: Resposta) {
  const proposal = resposta.preliminary!;
  const session = resposta.session ?? await iris.obter(sessionId);
  const nomes = await iris.nomes(sessionId);
  const dados = { proposal, ...(nomes ? { nomes } : {}), ...(resposta.items ? { items: resposta.items } : {}), ...(resposta.stores ? { stores: resposta.stores } : {}), ...(resposta.collection ? { collection: resposta.collection } : {}) };
  return { texto: textoPropostaPreliminar(dados), legenda: legendaPropostaPreliminar(dados),
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

  const previous = ultimoCard.get(sessionId);
  if (resposta.preliminary && previous?.iris === iris && previous.proposalId === resposta.preliminary.id) {
    await atualizarCard(api, iris, sessionId, resposta);
  } else {
    await desenharCard(api, iris, sessionId, resposta);
  }
  await apresentarActions(api, resposta, botUsername);
  return true;
}

async function desenharCard(api: ApiCard, iris: IrisCard, sessionId: SessionId, resposta: Resposta, forceText = false): Promise<void> {
  const proposalId = (resposta.preliminary ?? resposta.proposal)!.id;
  const render = Symbol(); renderizando.set(sessionId, render);
  const ativa = () => renderizando.get(sessionId) === render;
  const vigente = async () => {
    if (!ativa()) return false;
    const session = resposta.preliminary ? await iris.obter(sessionId) : undefined;
    return ativa() && (!resposta.preliminary || session?.preliminary?.id === proposalId);
  };
  const card = resposta.preliminary ? await montarPreliminar(iris, sessionId, resposta) : await montarCard(iris, sessionId, resposta, resposta.proposal!);
  if (!await vigente() || !ativa()) return;
  await limparCard(api, sessionId);
  if (!await vigente() || !ativa()) return;
  const photo = !forceText && card.legenda !== undefined
    ? await enviarFotoProposta(api, sessionId, resposta, { ...card.opcoes, caption: card.legenda }, vigente, ativa)
    : undefined;
  if (!await vigente() || !ativa()) {
    if (photo) await removerFoto(api, sessionId, photo.message_id);
    return;
  }
  const enviada = photo ?? await api.sendMessage(sessionId, card.texto, card.opcoes);
  if (!await vigente() || !ativa()) {
    if (photo) await removerFoto(api, sessionId, enviada.message_id);
    else {
      try { await api.editMessageReplyMarkup(sessionId, enviada.message_id, { reply_markup: new InlineKeyboard() }); } catch { /* Card substituído. */ }
    }
    return;
  }
  ultimoCard.set(sessionId, { messageId: enviada.message_id, proposalId, kind: photo ? 'photo' : 'text', render, iris });
}

/**
 * Atualiza o card que já está na tela, sem mandar outro (ex.: alguém aceitou o
 * valor e saiu da lista de espera). Sem card na tela, não faz nada.
 */
export async function atualizarCard(api: ApiCard, iris: IrisCard, sessionId: SessionId, resposta: Resposta): Promise<void> {
  const previous = ultimoCard.get(sessionId);
  if (!previous || previous.iris !== iris || !resposta.proposal && !resposta.preliminary) return;
  const proposalId = (resposta.preliminary ?? resposta.proposal)!.id;
  if (resposta.preliminary && previous.proposalId !== proposalId) return;
  const ativa = () => ultimoCard.get(sessionId) === previous && renderizando.get(sessionId) === previous.render;
  const vigente = async () => {
    if (!ativa()) return false;
    const session = resposta.preliminary ? await iris.obter(sessionId) : undefined;
    return ativa() && (!resposta.preliminary || session?.preliminary?.id === proposalId);
  };
  const card = resposta.preliminary ? await montarPreliminar(iris, sessionId, resposta) : await montarCard(iris, sessionId, resposta, resposta.proposal!);
  if (!await vigente() || !ativa()) return;
  if (previous.kind === 'photo' && card.legenda === undefined) {
    await desenharCard(api, iris, sessionId, resposta, true);
    return;
  }
  try {
    if (previous.kind === 'photo') {
      await api.editMessageCaption(sessionId, previous.messageId, { ...card.opcoes, caption: card.legenda! });
    } else {
      await api.editMessageText(sessionId, previous.messageId, card.texto, card.opcoes);
    }
    const displayed = ultimoCard.get(sessionId);
    // A edição em voo pode reaplicar o teclado depois da primeira limpeza.
    // Outra edição da MESMA mensagem/revisão continua válida, mesmo que tenha
    // atualizado o objeto do mapa; não pode apagar o card vigente por isso.
    if (displayed?.messageId !== previous.messageId || displayed.proposalId !== proposalId
      || renderizando.get(sessionId) !== previous.render) {
      if (previous.kind === 'photo') await removerFoto(api, sessionId, previous.messageId);
      else {
        try { await api.editMessageReplyMarkup(sessionId, previous.messageId, { reply_markup: new InlineKeyboard() }); } catch { /* Mensagem antiga. */ }
      }
      return;
    }
    if (ativa()) ultimoCard.set(sessionId, { ...previous, proposalId });
  } catch (error) {
    if (error instanceof GrammyError && error.description.includes('message is not modified')) return;
    // Uma legenda recusada não torna a proposta inacessível. O novo texto
    // recebe outra identidade de mensagem e invalida os callbacks da foto.
    if (previous.kind === 'photo' && await vigente() && ativa()) await desenharCard(api, iris, sessionId, resposta, true);
  }
}
