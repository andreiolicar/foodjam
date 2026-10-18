import { GrammyError, InlineKeyboard } from 'grammy';
import type { Agente, Resposta } from '../../core/agente.js';
import type { ApiCard } from './proposta-tela.js';
import { propostaDoCard, registrarRevisaoCarrinho } from './proposta-tela.js';
import { editarResumoProposta, removerFoto } from './fotos-proposta.js';
import { textoRevisaoCarrinho } from './cart-card.js';
const screens = new Map<string, { iris: Agente; origin: number; proposalId: string; messageId?: number; pending: boolean; desired: string }>();

/** Mensagem comercial responde ao resumo vigente; nunca é dona de autorização de compra. */
export async function exibirRevisaoCarrinho(api: ApiCard, iris: Agente, id: string, origin: number, expected: string, response: Resposta) {
  const current = async () => propostaDoCard(id, origin) === expected && (await iris.obter(id))?.preliminary?.id === expected;
  if (!await current()) return;
  const text = textoRevisaoCarrinho(response, await iris.nomes(id));
  if (!await current()) return;
  let state = screens.get(id);
  if (state?.proposalId !== expected || state.iris !== iris || state.origin !== origin) { state = { iris, origin, proposalId: expected, pending: false, desired: text }; screens.set(id, state); }
  state.desired = text;
  const options = { parse_mode: 'HTML' as const, reply_markup: new InlineKeyboard().text('🧾 Atualizar revisão do carrinho', `carrinho:revisar:${origin}`) };
  const active = () => screens.get(id) === state && propostaDoCard(id, origin) === expected;
  if (state.messageId) { await editarResumoProposta(api, id, state.messageId, text, options, active); return; }
  if (state.pending) return;
  state.pending = true;
  const signal = AbortSignal.timeout(5000) as unknown as NonNullable<Parameters<ApiCard['sendMessage']>[3]>;
  const sending = api.sendMessage(id, text, { ...options, reply_parameters: { message_id: origin } }, signal).then(async message => {
    if (!await current() || !active() || !registrarRevisaoCarrinho(id, expected, message.message_id)) { await removerFoto(api, id, message.message_id); return; }
    state.messageId = message.message_id; state.pending = false;
    if (state.desired !== text) await editarResumoProposta(api, id, message.message_id, state.desired, options, active);
  }).catch(error => {
    // Só rejeição explícita permite nova tentativa de apresentação pelo usuário.
    // Erros de rede/5xx continuam incertos e nunca liberam uma cópia.
    if (error instanceof GrammyError && error.error_code >= 400 && error.error_code < 500) state.pending = false;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([sending, new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]); }
  finally { clearTimeout(timer); }
}
