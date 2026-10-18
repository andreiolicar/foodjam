import { Markup, type Context, type Telegraf } from "telegraf";

import { iris } from "../iris.js";
import * as collector from "../collector.js";
import {
  getOrganizador,
  setAguardandoEndereco,
  isAguardandoEndereco,
  clearAguardandoEndereco,
} from "./state.js";

import { apresentarActions } from "../services/apresentacao.js";

const FALHAS = [
  "error",
  "not_authorized",
  "invalid_state",
  "no_session",
  "session_finished",
];

export function registrarEndereco(bot: Telegraf<Context>): void {
  // Confirma o endereço atual.
  bot.action("endereco:confirmar", async (ctx) => {
    const chatId = ctx.chat?.id;
    const actorId = ctx.from?.id;

    await ctx.answerCbQuery();

    if (chatId == null || actorId == null) return;

    const organizadorId = getOrganizador(chatId);

    if (String(actorId) !== organizadorId) {
      await ctx.reply("Somente o organizador pode confirmar o endereço.");
      return;
    }

    try {
      const resposta = await iris.confirmarEndereco(
        String(chatId),
        String(actorId),
      );

      await apresentarActions(ctx, chatId, resposta);

      console.log("Confirmação do endereço:", resposta);

      if (FALHAS.includes(resposta.outcome)) {
        await ctx.reply(
          `Não foi possível confirmar o endereço. Resultado: ${resposta.outcome}.`,
        );
        return;
      }

      clearAguardandoEndereco(chatId);

      if (!collector.isActive(chatId)) {
        collector.start(chatId);
      }

      await ctx.reply(
        "Endereço confirmado! Agora envie suas preferências para o pedido. Quando terminar, digite /finalizar.",
      );
    } catch (error) {
      console.error("Erro ao confirmar endereço:", error);
      await ctx.reply("Não foi possível confirmar o endereço.");
    }
  });

  // Solicita um endereço diferente.
  bot.action("endereco:outro", async (ctx) => {
    const chatId = ctx.chat?.id;
    const actorId = ctx.from?.id;

    await ctx.answerCbQuery();

    if (chatId == null || actorId == null) return;

    const organizadorId = getOrganizador(chatId);

    if (String(actorId) !== organizadorId) {
      await ctx.reply("Somente o organizador pode alterar o endereço.");
      return;
    }

    try {
      const resposta = await iris.pedirOutroEndereco(
        String(chatId),
        String(actorId),
      );

      await apresentarActions(ctx, chatId, resposta);

      console.log("Solicitação de outro endereço:", resposta);

      if (FALHAS.includes(resposta.outcome)) {
        await ctx.reply(
          `Não foi possível alterar o endereço. Resultado: ${resposta.outcome}.`,
        );
        return;
      }

      setAguardandoEndereco(chatId);

      await ctx.reply(
        "Envie o endereço de entrega completo, incluindo rua, número, bairro e cidade.",
      );
    } catch (error) {
      console.error("Erro ao solicitar outro endereço:", error);
      await ctx.reply("Não foi possível solicitar outro endereço.");
    }
  });

  // Registra que a pessoa ainda está na etapa do endereço.
  // A mensagem em si será tratada em mensagens.ts.
}