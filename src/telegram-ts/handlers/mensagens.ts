import type { Context, Telegraf } from 'telegraf';

import * as collector from '../collector.js';

export function registrarMensagens(
  bot: Telegraf<Context>,
): void {
  bot.on('message', async (ctx, next) => {
    const message = ctx.message;
    const chatId = ctx.chat.id;
    const usuario = ctx.from;

    if (!message || !usuario) {
      return next();
    }

    // Permite que /iniciar, /finalizar e outros comandos
    // sejam tratados pelos respectivos handlers.
    if ('text' in message && message.text.startsWith('/')) {
      return next();
    }

    if (!collector.isActive(chatId)) {
      return next();
    }

    let text = '';
    let fileId: string | undefined;

    if ('text' in message) {
      text = message.text;
    } else if ('caption' in message && message.caption) {
      text = message.caption;
    }

    if ('photo' in message) {
      fileId = message.photo.at(-1)?.file_id;
    } else if ('document' in message) {
      fileId = message.document.file_id;
    } else if ('audio' in message) {
      fileId = message.audio.file_id;
    } else if ('voice' in message) {
      fileId = message.voice.file_id;
    } else if ('video' in message) {
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
  message: NonNullable<Context['message']>,
): string {
  if ('text' in message) return 'text';
  if ('photo' in message) return 'photo';
  if ('document' in message) return 'document';
  if ('audio' in message) return 'audio';
  if ('voice' in message) return 'voice';
  if ('video' in message) return 'video';

  return 'other';
}