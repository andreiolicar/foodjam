import type { Context, Telegraf } from "telegraf";

import { iris } from "../iris.js";
import * as collector from "../collector.js";
import {
  clearAguardandoEndereco,
  clearOrganizador,
  getOrganizador,
} from "./state.js";
import { apresentarActions } from "../services/apresentacao.js";

export function registrarCancelar(bot: Telegraf<Context>): void {
  bot.command("cancelar", async (ctx) => {
    const chatId = ctx.chat.id;
    const organizadorId = getOrganizador(chatId);

    if (!organizadorId) {
      await ctx.reply("Não há pedido em andamento.");
      return;
    }

    if (String(ctx.from?.id) !== organizadorId) {
      await ctx.reply("Somente quem iniciou o pedido pode cancelá-lo.");
      return;
    }

    try {
      const resposta = await iris.cancelar(String(chatId), organizadorId);

      await apresentarActions(ctx, chatId, resposta);

      console.log("Cancelamento:", resposta.outcome);

      collector.finish(chatId);
      clearAguardandoEndereco(chatId);
      clearOrganizador(chatId);

      await ctx.reply("Pedido cancelado. Para começar outro, use /iniciar.");
    } catch (error) {
      console.error("Erro ao cancelar:", error);
      await ctx.reply("Não foi possível cancelar o pedido.");
    }
  });
}