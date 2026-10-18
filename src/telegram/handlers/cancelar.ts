import type { Bot, Context } from 'grammy';

import type { Agente, Agrupador } from '../../core/index.js';
import { apresentarActions } from '../services/apresentacao.js';
import { retirarBotoesDoCard } from '../services/proposta-tela.js';

// Usado pelo /cancelar e pelo botão do card. Quem pode cancelar é o core que
// decide (só o organizador); a recusa vai no privado.
export async function cancelarPedido(ctx: Context, iris: Agente, agrupador: Agrupador): Promise<void> {
  const chat = ctx.chat;
  if (!chat) return;

  if (chat.type === 'private') {
    await ctx.reply('Use /cancelar no grupo do pedido.');
    return;
  }

  const sessionId = String(chat.id);

  try {
    await agrupador.esvaziar(sessionId);

    const resposta = await iris.cancelar(sessionId, String(ctx.from?.id));

    await apresentarActions(ctx.api, resposta, ctx.me.username);

    console.log('Cancelamento:', resposta.outcome);

    if (resposta.outcome === 'cancelled') {
      await retirarBotoesDoCard(ctx.api, sessionId);
      await ctx.reply('Pedido cancelado. Para começar outro, me mencione ou use /iniciar.');
    } else if (resposta.outcome === 'no_session' || resposta.outcome === 'session_finished') {
      await ctx.reply('Não há pedido em andamento.');
    }
  } catch {
    console.error('Erro ao cancelar. Dados privados omitidos.');
    await ctx.reply('Não foi possível cancelar o pedido.');
  }
}

export function registrarCancelar(bot: Bot, iris: Agente, agrupador: Agrupador): void {
  bot.command('cancelar', (ctx) => cancelarPedido(ctx, iris, agrupador));
}
