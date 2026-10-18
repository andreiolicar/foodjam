import { InlineKeyboard, type Bot } from 'grammy';

import type { Agente, Resposta } from '../../core/index.js';
import { apresentarActions, enviar } from '../services/apresentacao.js';
import { lerCallback, PADRAO_BOTAO_PRIVADO } from '../services/callbacks.js';
import { retirarPendentes, sessaoDa } from '../services/privado.js';
import { atualizarCard, exibirProposta, retirarBotoesDoCard } from '../services/proposta-tela.js';

// Respostas do orçamento que mudam o pedido: a proposta nova vai para o grupo.
const MUDOU_PEDIDO = new Set(['budget_item_swapped', 'budget_left_out']);

export const TEXTO_VALORES_CONFIRMADOS =
  '🎉 Boa! Todo mundo confirmou os valores. Quem organizou o pedido já pode seguir com a confirmação!';

export function registrarConversaPrivada(bot: Bot, iris: Agente): void {
  const privado = bot.chatType('private');

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
      } catch (error) {
        console.error('Não foi possível entregar mensagem pendente:', error);
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
    } catch (error) {
      console.error('Erro ao processar o endereço:', error);
      await ctx.reply(
        'Ops! 😅 Não consegui processar o endereço desta vez. Pode tentar enviá-lo novamente?',
      );
    }
  });

  // Botões do privado: endereço e orçamento. O callback_data traz o grupo.
  bot.callbackQuery(PADRAO_BOTAO_PRIVADO, async (ctx) => {
    await ctx.answerCallbackQuery();

    const botao = lerCallback(ctx.callbackQuery.data);
    if (!botao) return;

    const actorId = String(ctx.from.id);

    let resposta: Resposta;
    try {
      if (botao.tipo === 'endereco') {
        resposta =
          botao.acao === 'confirmar'
            ? await iris.confirmarEndereco(botao.sessionId, actorId)
            : await iris.pedirOutroEndereco(botao.sessionId, actorId);
      } else {
        resposta = await iris.responderOrcamento(botao.sessionId, actorId, botao.resposta);
      }
    } catch (error) {
      console.error('Erro ao tratar botão do privado:', error);
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

    // Valor aceito: tira a pessoa da lista de espera; sem ninguém faltando, o grupo é avisado.
    if (resposta.outcome === 'budget_accepted') {
      await atualizarCard(ctx.api, iris, botao.sessionId, resposta);
      if (resposta.pendingBudget?.length === 0) {
        await ctx.api.sendMessage(botao.sessionId, TEXTO_VALORES_CONFIRMADOS);
      }
    }

    // A proposta saiu da mesa: o card antigo perde os botões.
    if (resposta.session && !resposta.session.proposal) {
      await retirarBotoesDoCard(ctx.api, botao.sessionId);
    }
  });
}