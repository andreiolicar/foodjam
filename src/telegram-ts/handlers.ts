
import {
  Telegraf,
  type Context,
} from "telegraf";

import * as collector from "./collector.js";

export function registerHandlers(bot: Telegraf<Context>): void {
  bot.command("iniciar", async (ctx) => {
    const chatId = ctx.chat.id;

    if (!collector.start(chatId)) {
      await ctx.reply("Já existe uma coleta ativa.");
      return;
    }

    await ctx.reply(
      "Coleta iniciada! As próximas mensagens serão registradas.",
    );
  });

  bot.command("finalizar", async (ctx) => {
    const chatId = ctx.chat.id;
    const messages = collector.finish(chatId);

    if (messages === undefined) {
      await ctx.reply("Não existe coleta ativa.");
      return;
    }

    if (messages.length === 0) {
      await ctx.reply("Nenhuma mensagem foi coletada.");
      return;
    }

    try {
      // Futuramente, os dados podem ser enviados ao core/API.
      console.log("Chat:", chatId);
      console.log("Mensagens:", messages);

      await ctx.reply("Mensagens enviadas para processamento!");
    } catch (error) {
      collector.restore(chatId, messages);

      console.error("Erro ao processar mensagens:", error);

      await ctx.reply(
        "Erro ao enviar os dados. A coleta foi restaurada.",
      );
    }
  });

  bot.on("message", async (ctx) => {
    const message = ctx.message;
    const chatId = ctx.chat.id;

    if (!message) {
      return;
    }

    if (!collector.isActive(chatId)) {
      return;
    }

    // Os comandos são tratados pelos handlers próprios.
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

    const item = {
      message_id: message.message_id,
      user_id: ctx.from?.id ?? null,
      username: ctx.from?.username ?? null,
      date: message.date,
      content_type: getContentType(message),
      text,
      ...(fileId ? { file_id: fileId } : {}),
    };

    collector.add(chatId, item);
  });
}

function getContentType(message: NonNullable<Context["message"]>): string {
  if ("text" in message) return "text";
  if ("photo" in message) return "photo";
  if ("document" in message) return "document";
  if ("audio" in message) return "audio";
  if ("voice" in message) return "voice";
  if ("video" in message) return "video";

  return "other";
}
