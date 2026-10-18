import type { Bot } from 'grammy';

import type { Agente, Agrupador } from '../../core/index.js';
import { exibirProposta } from '../services/proposta-tela.js';

// Sem proposta: o core já mandou o motivo no privado do organizador; o grupo recebe uma dica.
const DICAS_SEM_PROPOSTA: Record<string, string> = {
  address_required: 'Antes de montar o pedido, quem organizou precisa confirmar o endereço de entrega no privado.',
  no_candidates: 'A busca atual não encontrou produtos compatíveis na amostra pesquisada. Isso não significa que não existam no catálogo geral. Vocês podem ajustar as preferências e tentar novamente.',
  no_valid_option: 'Não encontrei uma combinação que atenda o grupo. Mandem mais detalhes e usem /montar de novo.',
  model_failed: 'A IA real está indisponível ou retornou dados inválidos. Preferências preservadas; confira o diagnóstico antes de repetir.',
  preferences_required: 'A coleta ainda não reconheceu preferências válidas. Confiram as perguntas no privado.',
  catalog_failed: 'Não foi possível consultar o catálogo real do iFood. Nenhuma simulação foi utilizada.',
  store_closed: 'Na amostra pesquisada, foram encontradas lojas fechadas e não foi possível confirmar uma loja aberta com produtos. Isso não representa todo o catálogo. Nenhum carrinho foi criado.',
  error: 'A consulta não pôde ser concluída. A sessão permanece disponível.',
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
    } catch {
      console.error('Erro ao montar o pedido. Dados privados omitidos.');
      await ctx.reply('Não foi possível montar o pedido. Tente /montar de novo.');
    }
  });
}
