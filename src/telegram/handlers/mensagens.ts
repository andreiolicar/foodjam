import type { Bot } from 'grammy';

import type { Agente, Agrupador } from '../../core/index.js';
import { lembrarMensagem } from '../services/lote.js';

const FINAIS = new Set(['closed', 'cancelled']);

// Mensagens do grupo vão para o core pelo agrupador. O core decide pela fase:
// na coleta registra preferências; com proposta na mesa interpreta trocas.
// O privado é tratado em conversa-privada.ts.
export function registrarMensagens(bot: Bot, iris: Agente, agrupador: Agrupador): void {
  bot.chatType(['group', 'supergroup']).on(['message:text', 'message:caption'], async (ctx, next) => {
    const text = ctx.message.text ?? ctx.message.caption ?? '';
    if (text.startsWith('/')) return next();

    const sessionId = String(ctx.chat.id);
    const sessao = await iris.obter(sessionId);
    if (!sessao || FINAIS.has(sessao.status)) return next();

    const participantId = String(ctx.from.id);
    lembrarMensagem(sessionId, participantId, ctx.message.message_id);
    agrupador.adicionar({ sessionId, participantId, text }, ctx.from.first_name);
  });
}
