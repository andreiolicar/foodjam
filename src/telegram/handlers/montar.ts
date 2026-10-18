import type { Bot } from 'grammy';

import type { Agente, Agrupador } from '../../core/index.js';
import { exibirProposta } from '../services/proposta-tela.js';

// Sem proposta: o core já mandou o motivo no privado do organizador; o grupo recebe uma dica.
const DICAS_SEM_PROPOSTA: Record<string, string> = {
  address_required: 'Antes de montar o pedido, quem organizou precisa confirmar o endereço de entrega no privado.',
  no_candidates: 'Ainda não sei o que vocês querem. Mandem aqui o que querem comer e usem /montar de novo.',
  no_valid_option: 'Não encontrei uma combinação que atenda o grupo. Mandem mais detalhes e usem /montar de novo.',
  model_failed: 'Não consegui montar a sugestão agora. Tentem /montar de novo em instantes.',
  no_session: 'Não existe pedido ativo. Me mencione ou use /iniciar para começar.',
  session_finished: 'Não existe pedido ativo. Me mencione ou use /iniciar para começar.',
};

export function registrarMontar(bot: Bot, iris: Agente, agrupador: Agrupador): void {
  bot.command(['montar', 'finalizar'], async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('Use /montar no grupo do pedido.');
      return;
    }

    const sessionId = String(ctx.chat.id);
    const actorId = String(ctx.from?.id);

    try {
      // As mensagens que ainda estão no lote entram antes da proposta.
      await agrupador.esvaziar(sessionId);

      await ctx.reply('Montando a sugestão com o que vocês mandaram...');

      const resposta = await iris.propor(sessionId, actorId);

      console.log('Proposta da Íris:', resposta.outcome);

      if (await exibirProposta(ctx.api, iris, sessionId, resposta, ctx.me.username)) return;

      const dica = DICAS_SEM_PROPOSTA[resposta.outcome];
      if (dica) await ctx.reply(dica);
    } catch (error) {
      console.error('Erro ao montar o pedido:', error);
      await ctx.reply('Não foi possível montar o pedido. Tente /montar de novo.');
    }
  });
}
