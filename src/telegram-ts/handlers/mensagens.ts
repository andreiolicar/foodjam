import { Markup, type Context, type Telegraf } from "telegraf";

import * as collector from "../collector.js";
import { iris } from "../iris.js";
import {
  getOrganizador,
  isAguardandoEndereco,
  clearAguardandoEndereco,
} from "./state.js";
import { apresentarActions } from "../services/apresentacao.js";

const FALHAS_ENDERECO: string[] = [
  "error",
  "not_authorized",
  "invalid_state",
  "no_session",
  "session_finished",
  "address_invalid",
];

export function registrarMensagens(
  bot: Telegraf<Context>,
): void {
  bot.on("message", async (ctx, next) => {
    const message = ctx.message;
    const chatId = ctx.chat.id;
    const usuario = ctx.from;

    if (!message || !usuario) {
      return next();
    }

    // Durante a etapa do endereço, a próxima mensagem de texto é o endereço.
    if (isAguardandoEndereco(chatId)) {
      if (!("text" in message) || message.text.startsWith("/")) {
        return next();
      }

      const organizadorId = getOrganizador(chatId);

      if (String(usuario.id) !== organizadorId) {
        await ctx.reply("Aguarde o organizador informar o endereço.");
        return;
      }

      try {
        const resposta = await iris.mensagem(
          {
            sessionId: String(chatId),
            participantId: String(usuario.id),
            text: message.text,
          },
          usuario.first_name ?? "Participante",
        );

        await apresentarActions(ctx, chatId, resposta);

        console.log("Resposta ao novo endereço:", resposta);

        // Endereço recusado: continua aguardando um novo endereço.
        // A Íris já pediu para digitar de novo via apresentarActions.
        if (FALHAS_ENDERECO.includes(resposta.outcome)) {
          return;
        }

        clearAguardandoEndereco(chatId);

        await ctx.reply(
          "O endereço foi enviado à Íris. Confirme-o ou informe outro endereço.",
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "✅ Confirmar endereço",
                "endereco:confirmar",
              ),
            ],
            [
              Markup.button.callback(
                "✏️ Corrigir / informar outro",
                "endereco:outro",
              ),
            ],
          ]),
        );
      } catch (error) {
        console.error("Erro ao processar o novo endereço:", error);
        await ctx.reply("Não foi possível processar esse endereço.");
      }

      return;
    }

    // Permite que /iniciar, /finalizar e outros comandos
    // sejam tratados pelos respectivos handlers.
    if ("text" in message && message.text.startsWith("/")) {
      return next();
    }

    if (!collector.isActive(chatId)) {
      return next();
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