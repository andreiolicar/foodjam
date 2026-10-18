import { InlineKeyboard, type Api } from 'grammy';
import { enviarFotoItem, enviarTextoItem, editarMensagemItem, editarResumoProposta, removerFoto } from './fotos-proposta.js';
import type { Agente, Proposal, Resposta, SessionId } from '../../core/index.js';
import { apresentarActions, teclado } from './apresentacao.js';
import { botoesCard, textoProposta, botoesPreliminares, textoPropostaPreliminar, textosItensPropostaPreliminar, type ItemPropostaPreliminar } from './card.js';

export type ApiCard = Pick<Api, 'sendMessage' | 'editMessageReplyMarkup' | 'editMessageText' | 'sendPhoto' | 'deleteMessage' | 'editMessageCaption'>;
type IrisCard = Pick<Agente, 'nomes' | 'obter'>;
interface ItemEnviado { messageId: number; kind: 'photo' | 'text'; texto: string }
interface CardEnviado {
  messageId: number; proposalId: string; render: symbol; iris: IrisCard; preliminary: boolean;
  items: Map<string, ItemEnviado>; retired: Set<number>; pending: Set<string>; desired: Map<string, ItemPropostaPreliminar>; keys: string; updates: Promise<void>;
}
const ultimoCard = new Map<SessionId, CardEnviado>();
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
  ultimoCard.delete(sessionId);
  if (previous.preliminary) {
    // Invalida sincronamente; limpeza remota limitada não segura o próximo resumo.
    for (const messageId of [previous.messageId, ...[...previous.items.values()].map(i => i.messageId), ...previous.retired]) void removerFoto(api, sessionId, messageId);
  } else {
    try { await api.editMessageReplyMarkup(sessionId, previous.messageId, { reply_markup: new InlineKeyboard() }); } catch { /* Card antigo. */ }
  }
}
async function montarCard(iris: IrisCard, sessionId: SessionId, resposta: Resposta, proposal: Proposal) {
  const sessao = resposta.session ?? await iris.obter(sessionId);
  const nomes = await iris.nomes(sessionId);
  const temAlternativa = sessao ? sessao.alternative !== undefined : resposta.alternative !== undefined;
  return { texto: textoProposta({ proposal, participantes: sessao?.participants ?? [], ...(nomes && { nomes }), ...(resposta.pendingBudget && { pendentes: resposta.pendingBudget }) }),
    items: [] as ItemPropostaPreliminar[], opcoes: { parse_mode: 'HTML' as const, reply_markup: teclado(botoesCard(temAlternativa)) } };
}
async function montarPreliminar(iris: IrisCard, sessionId: string, resposta: Resposta) {
  const session = resposta.session ?? await iris.obter(sessionId);
  const nomes = await iris.nomes(sessionId);
  const dados = { proposal: resposta.preliminary!, ...(nomes ? { nomes } : {}), ...(resposta.items ? { items: resposta.items } : {}), ...(resposta.stores ? { stores: resposta.stores } : {}), ...(resposta.collection ? { collection: resposta.collection } : {}) };
  return { texto: textoPropostaPreliminar(dados), items: textosItensPropostaPreliminar(dados),
    opcoes: { parse_mode: 'HTML' as const, reply_markup: teclado(botoesPreliminares(Boolean(session?.preliminaryAlternative))) } };
}

export async function exibirProposta(api: ApiCard, iris: IrisCard, sessionId: SessionId, resposta: Resposta, botUsername: string): Promise<boolean> {
  if (!resposta.proposal && !resposta.preliminary) { await apresentarActions(api, resposta, botUsername); return false; }
  const previous = ultimoCard.get(sessionId);
  if (resposta.preliminary && previous?.iris === iris && previous.proposalId === resposta.preliminary.id) await atualizarCard(api, iris, sessionId, resposta);
  else await desenharCard(api, iris, sessionId, resposta);
  await apresentarActions(api, resposta, botUsername);
  return true;
}

async function enviarItem(api: ApiCard, sessionId: string, item: ItemPropostaPreliminar, cardId: number,
  vigente: () => Promise<boolean>, ativa: () => boolean): Promise<ItemEnviado | undefined> {
  const photo = await enviarFotoItem(api, sessionId, item.itemImageUrl, item.texto, cardId, vigente, ativa);
  if (!await vigente() || !ativa()) { if (photo) await removerFoto(api, sessionId, photo.message_id); return; }
  const message = photo ?? await enviarTextoItem(api, sessionId, item.texto, cardId, vigente, ativa);
  if (!message) return;
  if (!await vigente() || !ativa()) { await removerFoto(api, sessionId, message.message_id); return; }
  return { messageId: message.message_id, kind: photo ? 'photo' : 'text', texto: item.texto };
}

/** Reserva a chave antes de enviar: reapresentações não duplicam itens em voo. */
async function registrarItem(api: ApiCard, sessionId: string, state: CardEnviado, item: ItemPropostaPreliminar,
  vigente: () => Promise<boolean>, ativa: () => boolean): Promise<void> {
  if (state.items.has(item.key) || state.pending.has(item.key) || !ativa()) return;
  state.pending.add(item.key);
  try {
    const sent = await enviarItem(api, sessionId, item, state.messageId, vigente, ativa);
    if (!ativa()) { if (sent) void removerFoto(api, sessionId, sent.messageId); return; }
    if (sent) state.items.set(item.key, sent);
  } finally { state.pending.delete(item.key); }
}

async function desenharCard(api: ApiCard, iris: IrisCard, sessionId: SessionId, resposta: Resposta): Promise<void> {
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
  // O resumo e seus botões ficam disponíveis antes de qualquer mídia opcional.
  const message = await api.sendMessage(sessionId, card.texto, card.opcoes);
  if (!await vigente() || !ativa()) { await removerFoto(api, sessionId, message.message_id); return; }
  const state: CardEnviado = { messageId: message.message_id, proposalId, render, iris, preliminary: Boolean(resposta.preliminary), items: new Map(), retired: new Set(), pending: new Set(), desired: new Map(card.items.map(i => [i.key, i])), keys: JSON.stringify(card.items.map(i => i.key)), updates: Promise.resolve() };
  ultimoCard.set(sessionId, state);
  for (const item of card.items) {
    if (!await vigente() || !ativa()) break;
    await registrarItem(api, sessionId, state, state.desired.get(item.key) ?? item, vigente, ativa);
    if (!ativa()) break;
    if (state.items.has(item.key)) {
      // Uma atualização da mesma revisão pode ter chegado durante o download.
      const catchup = state.updates.catch(() => undefined).then(() => atualizarItem(api, sessionId, state, state.desired.get(item.key) ?? item, vigente, ativa));
      state.updates = catchup;
      await catchup;
    }
  }
}

async function atualizarItem(api: ApiCard, sessionId: string, state: CardEnviado, item: ItemPropostaPreliminar,
  vigente: () => Promise<boolean>, ativa: () => boolean): Promise<void> {
  const previous = state.items.get(item.key);
  if (!previous || previous.texto === item.texto || !await vigente() || !ativa()) return;
  if (previous.kind !== 'photo' || item.texto.length <= 1024) {
    const edited = await editarMensagemItem(api, sessionId, previous.messageId, previous.kind, item.texto, ativa);
    if (!await vigente() || !ativa()) { await removerFoto(api, sessionId, previous.messageId); return; }
    if (edited) { previous.texto = item.texto; return; }
  }
  // Falha, timeout ou legenda longa afetam só este item, nunca o próximo.
  // Retira o ID antes do fallback: se o texto também falhar, a próxima tentativa
  // cria outra mensagem. Uma edição antiga nunca pode apagar um ID reutilizado.
  state.items.delete(item.key);
  state.retired.add(previous.messageId);
  void removerFoto(api, sessionId, previous.messageId);
  const message = await enviarTextoItem(api, sessionId, item.texto, state.messageId, vigente, ativa);
  if (!message) return;
  if (!await vigente() || !ativa()) { await removerFoto(api, sessionId, message.message_id); return; }
  state.items.set(item.key, { messageId: message.message_id, kind: 'text', texto: item.texto });
}

/** Serializa edições da mesma revisão; uma substituição invalida a fila antiga. */
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
  const update = previous.updates.catch(() => undefined).then(async () => {
    const card = resposta.preliminary ? await montarPreliminar(iris, sessionId, resposta) : await montarCard(iris, sessionId, resposta, resposta.proposal!);
    if (!await vigente() || !ativa()) return;
    if (JSON.stringify(card.items.map(i => i.key)) !== previous.keys) { await desenharCard(api, iris, sessionId, resposta); return; }
    previous.desired = new Map(card.items.map(i => [i.key, i]));
    await editarResumoProposta(api, sessionId, previous.messageId, card.texto, card.opcoes, ativa);
    if (!await vigente() || !ativa()) {
      // Uma edição em voo pode restaurar o teclado depois da primeira limpeza.
      await removerFoto(api, sessionId, previous.messageId);
      return;
    }
    previous.proposalId = proposalId;
    for (const item of card.items) {
      if (!previous.items.has(item.key)) await registrarItem(api, sessionId, previous, item, vigente, ativa);
      else await atualizarItem(api, sessionId, previous, item, vigente, ativa);
    }
  });
  previous.updates = update;
  await update;
}
