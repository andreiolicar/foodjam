import { InlineKeyboard, type Bot } from 'grammy';

import type { Agente, Resposta } from '../../core/index.js';
import { apresentarActions, enviar } from '../services/apresentacao.js';
import { lerCallback, PADRAO_BOTAO_PRIVADO, enderecoEnviado, consumirEnderecoEnviado } from '../services/callbacks.js';
import { retirarPendentes, sessaoDa } from '../services/privado.js';
import { atualizarCard, exibirProposta, retirarBotoesDoCard } from '../services/proposta-tela.js';
import { textoConferenciaCheckout } from '../services/checkout-card.js';

// Respostas do orçamento que mudam o pedido: a proposta nova vai para o grupo.
const MUDOU_PEDIDO = new Set(['budget_item_swapped', 'budget_left_out']);

export const TEXTO_VALORES_CONFIRMADOS =
  '🎉 Boa! Todo mundo confirmou os valores. Quem organizou o pedido já pode seguir com a confirmação!';

export function registrarConversaPrivada(bot: Bot, iris: Agente, preliminaryOnly = false): void {
  const privado = bot.chatType('private');

  privado.command('checkout', async ctx => {
    const actor = String(ctx.from.id); const id = sessaoDa(actor);
    const session = id ? await iris.obter(id) : undefined;
    if (!id || session?.organizerId !== actor || !session.preliminary || !iris.revisarCheckout) {
      await ctx.reply('Prepare o carrinho da proposta vigente no grupo. Esta consulta é exclusiva de quem organizou e não compra.'); return;
    }
    const expected = session.preliminary.id;
    const fingerprint = JSON.stringify({ proposal: session.preliminary, participants: session.participants, address: session.address });
    try {
      const response = await iris.revisarCheckout(id, actor, expected);
      const names = await iris.nomes(id);
      const latest = await iris.obter(id);
      if (sessaoDa(actor) !== id || !latest || JSON.stringify({ proposal: latest.preliminary, participants: latest.participants, address: latest.address }) !== fingerprint) return;
      await ctx.reply(textoConferenciaCheckout(response, names), { parse_mode: 'HTML' });
    } catch {
      console.error('Conferência de checkout não concluída. Dados privados omitidos.');
      await ctx.reply('Não foi possível conferir o checkout. Nenhuma compra ou configuração de pagamento foi executada.');
    }
  });

  // /start: entrega o que ficou guardado porque a pessoa ainda não tinha falado com o bot.
  privado.command('start', async (ctx) => {
    const pendentes = retirarPendentes(String(ctx.from.id));

    if (pendentes.length === 0) {
      await ctx.reply(
        'Oi! 👋 Que bom ter você por aqui!\n\n' +
        'Vou te chamar no privado quando precisar confirmar valores ou combinar o endereço de entrega. ' +
        'Já as preferências e decisões sobre o pedido ficam lá no grupo. 😊',
      );
      return;
    }

    for (const envio of pendentes) {
      try {
        await enviar(ctx.api, { ...envio, chatId: String(ctx.chat.id) });
      } catch {
        console.error('Não foi possível entregar mensagem pendente. Dados privados omitidos.');
      }
    }
  });

  // Texto no privado: só o endereço que a Íris pediu ao organizador.
  privado.on('message:text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) return next();

    const participantId = String(ctx.from.id);
    const sessionId = sessaoDa(participantId);
    const sessao = sessionId !== undefined ? await iris.obter(sessionId) : undefined;

    if (
      sessionId === undefined ||
      sessao?.address?.status !== 'awaiting_text' ||
      sessao.organizerId !== participantId
    ) {
      await ctx.reply(
        'Opa! 😊 Por aqui, você pode me enviar o endereço de entrega quando eu pedir. ' +
        'Para conversar sobre preferências e alterações no pedido, é só mandar uma mensagem lá no grupo!',
      );
      return;
    }

    try {
      const resposta = await iris.mensagem(
        { sessionId, participantId, text: ctx.message.text },
        ctx.from.first_name,
      );
      await apresentarActions(ctx.api, resposta, ctx.me.username);
    } catch {
      console.error('Erro ao processar o endereço. Dados privados omitidos.');
      await ctx.reply(
        'Ops! 😅 Não consegui processar o endereço desta vez. Pode tentar enviá-lo novamente?',
      );
    }
  });

  // Botões do privado: endereço e orçamento. O callback_data traz o grupo.
  bot.callbackQuery(PADRAO_BOTAO_PRIVADO, async (ctx) => {
    const botao = lerCallback(ctx.callbackQuery.data);
    if (!botao) return;

    if (botao.tipo === 'orcamento' && ctx.chat?.type !== 'private') { await ctx.answerCallbackQuery({ text: 'Responda sobre valores no privado.', show_alert: true }); return; }
    const actorId = String(ctx.from.id);
    const route = botao.tipo === 'endereco' && ctx.callbackQuery.message ? enderecoEnviado(String(ctx.chat?.id), ctx.callbackQuery.message.message_id) : undefined;
    if (botao.tipo === 'endereco' && (route || preliminaryOnly)) {
      if (route && (route.participantId !== actorId || route.sessionId !== botao.sessionId)) { await ctx.answerCallbackQuery({ text: 'Somente o organizador que recebeu o endereço pode confirmar.', show_alert: true }); return; }
      if (!route?.active) { await ctx.answerCallbackQuery({ text: 'Este endereço foi substituído. Use a mensagem atual no privado.', show_alert: true }); return; }
      consumirEnderecoEnviado(String(ctx.chat?.id), ctx.callbackQuery.message!.message_id);
    }
    await ctx.answerCallbackQuery();

    let resposta: Resposta;
    try {
      if (botao.tipo === 'endereco') {
        resposta =
          botao.acao === 'confirmar'
            ? await iris.confirmarEndereco(botao.sessionId, actorId, route?.candidate)
            : await iris.pedirOutroEndereco(botao.sessionId, actorId);
      } else {
        resposta = await iris.responderOrcamento(botao.sessionId, actorId, botao.resposta);
      }
    } catch {
      console.error('Erro ao tratar botão do privado. Dados privados omitidos.');
      await ctx.reply(
        'Ops! 😕 Não consegui registrar sua resposta. Tente novamente em alguns instantes.',
      );
      return;
    }

    // Respondido: tira os botões da mensagem para evitar clique repetido.
    if (resposta.outcome !== 'error') {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      } catch {
        // a mensagem pode já ter sido editada; ignora
      }
    }

    if (MUDOU_PEDIDO.has(resposta.outcome) && resposta.proposal) {
      await exibirProposta(ctx.api, iris, botao.sessionId, resposta, ctx.me.username);
      return;
    }

    await apresentarActions(ctx.api, resposta, ctx.me.username);
    if (preliminaryOnly && botao.tipo === 'endereco' && ['error', 'catalog_failed', 'address_invalid', 'address_stale'].includes(resposta.outcome)) await ctx.reply('Não foi possível confirmar este endereço. Use /endereco no grupo para apresentar novamente um registro salvo atual.');

    // Valor aceito: tira a pessoa da lista de espera; sem ninguém faltando, o grupo é avisado.
    if (resposta.outcome === 'budget_accepted') {
      await atualizarCard(ctx.api, iris, botao.sessionId, resposta);
      if (resposta.pendingBudget?.length === 0) {
        await ctx.api.sendMessage(botao.sessionId, TEXTO_VALORES_CONFIRMADOS);
      }
    }

    // A proposta saiu da mesa (endereço trocado, ninguém ficou com item): o card antigo perde os botões.
    if (resposta.session && !resposta.session.proposal && !resposta.session.preliminary) {
      await retirarBotoesDoCard(ctx.api, botao.sessionId);
    }
  });
}
