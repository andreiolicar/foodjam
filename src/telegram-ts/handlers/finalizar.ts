import type { Context, Telegraf } from "telegraf";

import { iris } from "../iris.js";
import * as collector from "../collector.js";

import {
  clearOrganizador,
  getOrganizador,
  isAguardandoEndereco,
} from "./state.js";

import {
  apresentarActions,
  mostrarResultado,
} from "../services/apresentacao.js";

export function registrarFinalizar(
  bot: Telegraf<Context>,
): void {
  bot.command("finalizar", async (ctx) => {
    const chatId = ctx.chat.id;
    const sessionId = String(chatId);
    const organizadorId = getOrganizador(chatId);

    if (!collector.isActive(chatId)) {
      if (organizadorId) {
        await ctx.reply(
          isAguardandoEndereco(chatId)
            ? "Primeiro informe o endereço de entrega. Para desistir, use /cancelar."
            : "Primeiro confirme o endereço de entrega nos botões acima. Para desistir, use /cancelar.",
        );
      } else {
        await ctx.reply("Não existe coleta ativa. Use /iniciar para começar.");
      }
      return;
    }

    if (!organizadorId) {
      await ctx.reply("Não consegui identificar o organizador.");
      return;
    }

    if (String(ctx.from?.id) !== organizadorId) {
      await ctx.reply(
        "Somente quem iniciou o pedido pode finalizá-lo.",
      );
      return;
    }

    const messages = collector.finish(chatId);

    if (messages === undefined) {
      await ctx.reply("Não existe coleta ativa.");
      return;
    }

    const mensagensValidas = messages.filter(
      (item) =>
        item.text.trim().length > 0 &&
        item.user_id !== null,
    );

    // Não há mensagens de texto: cancela a sessão da Íris.
    if (mensagensValidas.length === 0) {
      try {
        const cancelamento = await iris.cancelar(
          sessionId,
          organizadorId,
        );

        await apresentarActions(ctx, chatId, cancelamento);
        clearOrganizador(chatId);

        await ctx.reply(
          "Nenhuma mensagem de texto foi coletada. " +
          "Sessão encerrada; você pode usar /iniciar novamente.",
        );
      } catch (error) {
        collector.restore(chatId, messages);
        console.error("Erro ao encerrar sessão vazia:", error);

        await ctx.reply(
          "Não consegui encerrar a sessão. A coleta foi restaurada.",
        );
      }

      return;
    }

    try {
      await ctx.reply(
        `Coleta encerrada. Processando ${mensagensValidas.length} mensagens com a Íris...`,
      );

      // Processa em ordem, uma mensagem de cada vez.
      for (const item of mensagensValidas) {
        const respostaMensagem = await iris.mensagem(
          {
            sessionId,
            participantId: String(item.user_id),
            text: item.text.trim(),
          },
          "Participante",
        );

        console.log(
          "Resultado da mensagem:",
          respostaMensagem.outcome,
        );

        await apresentarActions(
          ctx,
          chatId,
          respostaMensagem,
        );
      }

      // Gera a recomendação apenas uma vez.
      const respostaProposta = await iris.propor(
        sessionId,
        organizadorId,
      );

      console.log("Proposta da Íris:", respostaProposta);

      await mostrarResultado(ctx, chatId, respostaProposta);

      // Se a Íris não conseguiu montar a proposta,
      // não encerre nem cancele a sessão automaticamente.
      if (!respostaProposta.proposal) {
        if (respostaProposta.outcome === "address_required") {
          await ctx.reply(
            "Antes de montar o pedido, precisamos confirmar o endereço de entrega. " +
            "A sessão permanece pendente.",
          );
        }

        collector.restore(chatId, messages);
        return;
      }
    } catch (error) {
      console.error("Erro ao processar a coleta:", error);

      collector.restore(chatId, messages);

      await ctx.reply(
        "Erro ao processar as mensagens. " +
        "A coleta foi restaurada para uma nova tentativa.",
      );

      return;
    }

    // Este protótipo encerra a sessão após exibir a recomendação.
    // Não autoriza a compra.
    try {
      const encerramento = await iris.cancelar(
        sessionId,
        organizadorId,
      );

      console.log(
        "Resultado do encerramento:",
        encerramento.outcome,
      );

      if (
        ["error", "not_authorized", "invalid_state", "no_session"]
          .includes(encerramento.outcome)
      ) {
        await ctx.reply(
          "A recomendação foi exibida, mas não consegui encerrar a sessão da Íris.",
        );
        return;
      }

      clearOrganizador(chatId);

      await ctx.reply(
        "Fluxo encerrado. Para iniciar outro pedido, use /iniciar.",
      );
    } catch (error) {
      console.error("Erro ao encerrar sessão da Íris:", error);

      await ctx.reply(
        "A recomendação foi exibida, mas não consegui encerrar a sessão da Íris.",
      );
    }
  });
}