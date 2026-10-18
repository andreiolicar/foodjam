
import {
  Telegraf,
  type Context,
} from "telegraf";

import { iris } from "./iris.js";
import * as collector from "./collector.js";

const organizadores = new Map<number, string>();

type RespostaBot = {
  outcome?: string;
  actions?: Array<{
    type?: string;
    participantId?: string;
    text?: string;
    message?: string;
  }>;
  proposal?: {
    justification?: string;
    [key: string]: unknown;
  };
};

async function apresentarActions(
  ctx: Context,
  chatId: number,
  respostaOriginal: unknown,
): Promise<void> {
  const resposta = respostaOriginal as RespostaBot;

  for (const action of resposta.actions ?? []) {
    if (action.type !== "send_message") continue;

    const texto = action.text ?? action.message;
    if (!texto) continue;

    const destino = action.participantId ?? String(chatId);

    try {
      await ctx.telegram.sendMessage(destino, texto);
    } catch (error) {
      console.error("Erro ao enviar action da Íris:", error);
    }
  }
}

async function mostrarResultado(
  ctx: Context,
  chatId: number,
  respostaOriginal: unknown,
): Promise<void> {
  const resposta = respostaOriginal as RespostaBot;

  await apresentarActions(ctx, chatId, resposta);

  if (!resposta.proposal) {
    await ctx.telegram.sendMessage(
      chatId,
      `A Íris não gerou uma proposta. Resultado: ${
        resposta.outcome ?? "desconhecido"
      }.`,
    );
    return;
  }

  const proposta = resposta.proposal;

  await ctx.telegram.sendMessage(
    chatId,
    `🍽️ Recomendação da Íris\n\n${
      proposta.justification ?? "A Íris montou uma proposta."
    }`,
  );

  // Exibição temporária dos dados completos para validar a integração.
  const detalhes = JSON.stringify(proposta, null, 2);
  const tamanhoParte = 3500;

  for (let i = 0; i < detalhes.length; i += tamanhoParte) {
    await ctx.telegram.sendMessage(
      chatId,
      `${i === 0 ? "Detalhes da proposta:\n" : ""}${
        detalhes.slice(i, i + tamanhoParte)
      }`,
    );
  }
}

export function registerHandlers(
  bot: Telegraf<Context>,
): void {
  // 1. Iniciar coleta e sessão da Íris.
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
      const inicio = await iris.iniciar(
        String(chatId),
        {
          id: participantId,
          displayName,
        },
      );

      await apresentarActions(ctx, chatId, inicio);

      if (inicio.outcome !== "started") {
        await ctx.reply(
          `Não foi possível iniciar uma nova sessão. Resultado: ${inicio.outcome}.`,
        );
        return;
      }

      collector.start(chatId);
      organizadores.set(chatId, participantId);

      await ctx.reply(
        "Coleta iniciada! Envie suas preferências neste chat. " +
        "Quando terminar, digite /finalizar.",
      );
    } catch (error) {
      console.error("Erro ao iniciar:", error);
      await ctx.reply("Não foi possível iniciar o pedido.");
    }
  });

  // 2. Finalizar coleta, processar mensagens e mostrar recomendação.
  bot.command("finalizar", async (ctx) => {
    const chatId = ctx.chat.id;
    const sessionId = String(chatId);
    const organizadorId = organizadores.get(chatId);

    if (!collector.isActive(chatId)) {
      await ctx.reply("Não existe coleta ativa.");
      return;
    }

    if (!organizadorId) {
      await ctx.reply("Não consegui identificar o organizador.");
      return;
    }

    // Interrompe a coleta e recupera as mensagens armazenadas.
    const messages = collector.finish(chatId);

    if (messages === undefined) {
      await ctx.reply("Não existe coleta ativa.");
      return;
    }

    // Sem mensagens: cancela a sessão da Íris para permitir recomeçar.
    if (messages.length === 0) {
      try {
        const cancelamento = await iris.cancelar(
          sessionId,
          organizadorId,
        );

        await apresentarActions(ctx, chatId, cancelamento);
        organizadores.delete(chatId);

        await ctx.reply(
          "Nenhuma mensagem foi coletada. Sessão encerrada; você pode usar /iniciar novamente.",
        );
      } catch (error) {
        console.error("Erro ao encerrar sessão vazia:", error);
        await ctx.reply(
          "A coleta terminou, mas não consegui encerrar a sessão da Íris.",
        );
      }

      return;
    }

    const mensagensValidas = messages.filter(
      (item) =>
        item.text.trim().length > 0 &&
        item.user_id !== null,
    );

    if (mensagensValidas.length === 0) {
      try {
        const cancelamento = await iris.cancelar(
          sessionId,
          organizadorId,
        );

        await apresentarActions(ctx, chatId, cancelamento);
        organizadores.delete(chatId);

        await ctx.reply(
          "Não encontrei mensagens de texto para analisar. Sessão encerrada.",
        );
      } catch (error) {
        console.error("Erro ao encerrar sessão sem texto:", error);
        await ctx.reply("Não consegui encerrar a sessão da Íris.");
      }

      return;
    }

    try {
      console.log(
        `Enviando ${mensagensValidas.length} mensagens para a Íris.`,
      );

      // Envia uma mensagem por vez, preservando a ordem original.
      for (const item of mensagensValidas) {
        const respostaMensagem = await iris.mensagem(
          {
            sessionId,
            participantId: String(item.user_id),
            text: item.text.trim(),
          },
          item.username ?? "Participante",
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

      // Monta a proposta uma única vez, depois de processar as mensagens.
      const respostaProposta = await iris.propor(
        sessionId,
        organizadorId,
      );

      console.log("Proposta da Íris:", respostaProposta);

      await mostrarResultado(
        ctx,
        chatId,
        respostaProposta,
      );
    } catch (error) {
      console.error("Erro ao processar a coleta:", error);

      // Restaura a coleta em caso de falha no processamento.
      collector.restore(chatId, messages);

      await ctx.reply(
        "Erro ao processar as mensagens. A coleta foi restaurada para uma nova tentativa.",
      );
      return;
    }

    // Este protótipo apenas apresenta a recomendação.
    // Cancelar encerra o estado ativo da Íris para permitir outro pedido.
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
        ["error", "not_authorized", "invalid_state"].includes(
          encerramento.outcome,
        )
      ) {
        await ctx.reply(
          "A recomendação foi exibida, mas a sessão da Íris continua ativa.",
        );
        return;
      }

      organizadores.delete(chatId);

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

  // 3. Enquanto a coleta estiver ativa, apenas armazena as mensagens.
  bot.on("message", async (ctx) => {
    const message = ctx.message;
    const chatId = ctx.chat.id;
    const usuario = ctx.from;

    if (!message || !usuario) return;
    if (!collector.isActive(chatId)) return;

    // Comandos não são preferências.
    if ("text" in message && message.text.startsWith("/")) {
      return;
    }

    let text = "";
    let fileId: string | undefined;

    if ("text" in message) {
      text = message.text;
    } else if ("caption" in message && message.caption) {
      text = message.caption;
    }

    if ("photo" in message) {
      fileId = message.photo.at(-1)?.file_id;
    } else if ("document" in message) {
      fileId = message.document.file_id;
    } else if ("audio" in message) {
      fileId = message.audio.file_id;
    } else if ("voice" in message) {
      fileId = message.voice.file_id;
    } else if ("video" in message) {
      fileId = message.video.file_id;
    }

    collector.add(chatId, {
      message_id: message.message_id,
      user_id: usuario.id,
      username: usuario.username ?? null,
      date: message.date,
      content_type: getContentType(message),
      text,
      ...(fileId ? { file_id: fileId } : {}),
    });
  });
}

function getContentType(
  message: NonNullable<Context["message"]>,
): string {
  if ("text" in message) return "text";
  if ("photo" in message) return "photo";
  if ("document" in message) return "document";
  if ("audio" in message) return "audio";
  if ("voice" in message) return "voice";
  if ("video" in message) return "video";

  return "other";
}
