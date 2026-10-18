import { Markup, type Context, type Telegraf } from "telegraf";

import { iris } from "../iris.js";
import * as collector from "../collector.js";

import {
  getOrganizador,
  isAguardandoEndereco,
  isAguardandoOrcamento,
  isEmProposta,
  setEmProposta,
} from "./state.js";

import {
  apresentarActions,
  mostrarResultado,
} from "../services/apresentacao.js";

export type RespostaProposta = Awaited<ReturnType<typeof iris.propor>>;

export function botoesProposta() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirmar pedido", "proposta:confirmar")],
    [Markup.button.callback("🔄 Outra opção", "proposta:outra")],
    [Markup.button.callback("💸 Orçamento menor", "proposta:orcamento")],
    [Markup.button.callback("⬅️ Voltar para a coleta", "proposta:voltar")],
    [Markup.button.callback("🚫 Cancelar pedido", "proposta:cancelar")],
  ]);
}

// Mostra a proposta e, se ela existir, os botões de decisão.
// Retorna true quando há uma proposta na tela.
export async function exibirProposta(
  ctx: Context,
  chatId: number,
  resposta: RespostaProposta,
): Promise<boolean> {
  await mostrarResultado(ctx, chatId, resposta);

  if (!resposta.proposal) {
    return false;
  }

  setEmProposta(chatId);

  await ctx.reply(
    "O que você achou dessa sugestão?",
    botoesProposta(),
  );

  return true;
}

export function registrarMontar(bot: Telegraf<Context>): void {
  bot.command(["montar", "finalizar"], async (ctx) => {
    const chatId = ctx.chat.id;
    const sessionId = String(chatId);
    const organizadorId = getOrganizador(chatId);

    if (isEmProposta(chatId)) {
      await ctx.reply(
        isAguardandoOrcamento(chatId)
          ? "Estou esperando o novo orçamento. Envie o valor (por exemplo, até R$ 40) ou use /cancelar."
          : "Já existe uma sugestão na tela. Use os botões dela ou /cancelar.",
      );
      return;
    }

    if (!collector.isActive(chatId)) {
      if (organizadorId) {
        await ctx.reply(
          isAguardandoEndereco(chatId)
            ? "Primeiro informe o endereço de entrega. Para desistir, use /cancelar."
            : "Primeiro confirme o endereço de entrega nos botões acima. Para desistir, use /cancelar.",
        );
      } else {
        await ctx.reply("Não existe pedido ativo. Use /iniciar para começar.");
      }
      return;
    }

    if (!organizadorId) {
      await ctx.reply("Não consegui identificar o organizador.");
      return;
    }

    if (String(ctx.from?.id) !== organizadorId) {
      await ctx.reply("Somente quem iniciou o pedido pode montá-lo.");
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

    // Sem texto para enviar: mantém a coleta aberta.
    if (mensagensValidas.length === 0) {
      collector.restore(chatId, messages);

      await ctx.reply(
        "Ainda não há mensagens de texto. Envie suas preferências e use /montar de novo.",
      );
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

        console.log("Resultado da mensagem:", respostaMensagem.outcome);

        await apresentarActions(ctx, chatId, respostaMensagem);
      }

      const respostaProposta = await iris.propor(sessionId, organizadorId);

      console.log("Proposta da Íris:", respostaProposta);

      const temProposta = await exibirProposta(ctx, chatId, respostaProposta);

      // Sem proposta: reabre a coleta para a pessoa tentar de novo.
      if (!temProposta) {
        collector.restore(chatId, messages);

        await ctx.reply(
          respostaProposta.outcome === "address_required"
            ? "Antes de montar o pedido, precisamos confirmar o endereço de entrega."
            : "Não consegui montar uma sugestão. A coleta foi mantida; envie mais detalhes e use /montar de novo.",
        );
      }
    } catch (error) {
      console.error("Erro ao montar o pedido:", error);

      collector.restore(chatId, messages);

      await ctx.reply(
        "Erro ao processar as mensagens. A coleta foi restaurada para uma nova tentativa.",
      );
    }
  });
}