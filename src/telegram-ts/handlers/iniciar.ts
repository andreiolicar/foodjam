import type { Context, Telegraf } from "telegraf";

import { iris } from "../iris.js";
import * as collector from "../collector.js";
import { setOrganizador } from "./state.js";
import { apresentarActions } from "../services/apresentacao.js";

export function registrarIniciar(
  bot: Telegraf<Context>,
): void {
  bot.command("iniciar", async (ctx) => {
    const chatId = ctx.chat.id;
    const usuario = ctx.from;

    if (!usuario) {
      await ctx.reply("Não foi possível identificar o organizador.");
      return;
    }

    if (collector.isActive(chatId)) {
      await ctx.reply("Já existe uma coleta ativa.");
      return;
    }

    const participantId = String(usuario.id);
    const displayName = usuario.first_name ?? "Participante";

    try {
      const inicio = await iris.iniciar(String(chatId), {
        id: participantId,
        displayName,
      });

      await apresentarActions(ctx, chatId, inicio);

      if (inicio.outcome !== "started") {
        await ctx.reply(
          `Não foi possível iniciar uma nova sessão. Resultado: ${inicio.outcome}.`,
        );
        return;
      }

      collector.start(chatId);
      setOrganizador(chatId, participantId);

      await ctx.reply(
        "Coleta iniciada! Envie suas preferências neste chat. " +
        "Quando terminar, digite /finalizar.",
      );
    } catch (error) {
      console.error("Erro ao iniciar:", error);
      await ctx.reply("Não foi possível iniciar o pedido.");
    }
  });
}