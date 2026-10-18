import type { Bot, CallbackQueryContext, Context } from 'grammy';

import type { Agente, Agrupador, AuthorizedOrder, Resposta } from '../../core/index.js';
import { apresentarActions } from '../services/apresentacao.js';
import { DADOS_CARD, textoPedido } from '../services/card.js';
import { exibirProposta, retirarBotoesDoCard } from '../services/proposta-tela.js';
import { cancelarPedido } from './cancelar.js';

type Acao = (sessionId: string, actorId: string) => Promise<Resposta>;

/**
 * Chama o core com quem clicou. Quem pode usar cada botão é o core que decide:
 * a recusa (not_authorized) aparece como aviso no próprio botão, sem mensagem privada.
 * Devolve undefined quando já tratou a resposta.
 */
async function chamar(
  ctx: CallbackQueryContext<Context>,
  agrupador: Agrupador,
  acao: Acao,
): Promise<{ sessionId: string; resposta: Resposta } | undefined> {
  const sessionId = String(ctx.chat?.id);
  try {
    await agrupador.esvaziar(sessionId);
    const resposta = await acao(sessionId, String(ctx.from.id));

    if (resposta.outcome === 'not_authorized') {
      const aviso = resposta.actions.find((a) => a.type === 'send_message')?.text;
      await ctx.answerCallbackQuery({ text: aviso ?? 'Só quem organizou o pedido pode usar esses botões.', show_alert: true });
      return undefined;
    }

    await ctx.answerCallbackQuery();
    return { sessionId, resposta };
  } catch (error) {
    console.error('Erro no botão da proposta:', error);
    await ctx.answerCallbackQuery({ text: 'Não foi possível concluir. Tente de novo.' });
    return undefined;
  }
}

/** Recebe o pedido autorizado (fronteira com quem executa a compra no iFood). */
export type ExecutorPedido = (order: AuthorizedOrder) => void | Promise<void>;

export function registrarProposta(bot: Bot, iris: Agente, agrupador: Agrupador, aoAutorizar: ExecutorPedido): void {
  // "Outra opção": troca pela alternativa que o core já calculou (e de volta), sem chamar o modelo.
  bot.callbackQuery(DADOS_CARD.outra, async (ctx) => {
    const r = await chamar(ctx, agrupador, (s, a) => iris.outraOpcao(s, a));
    if (!r) return;

    if (r.resposta.outcome === 'switched') {
      await exibirProposta(ctx.api, iris, r.sessionId, r.resposta, ctx.me.username);
    } else {
      await apresentarActions(ctx.api, r.resposta, ctx.me.username);
    }
  });

  // "Voltar para a coleta": descarta a proposta e mantém as preferências.
  bot.callbackQuery(DADOS_CARD.voltar, async (ctx) => {
    const r = await chamar(ctx, agrupador, (s, a) => iris.reabrirColeta(s, a));
    if (!r) return;

    await apresentarActions(ctx.api, r.resposta, ctx.me.username);

    if (r.resposta.outcome === 'collecting') {
      await retirarBotoesDoCard(ctx.api, r.sessionId);
      await ctx.reply('Coleta reaberta! Quem quiser pode mandar ou mudar o pedido aqui. Depois usem /montar.');
    }
  });

  bot.callbackQuery(DADOS_CARD.cancelar, async (ctx) => {
    await ctx.answerCallbackQuery();
    await cancelarPedido(ctx, iris, agrupador);
  });

  // Confirmar: só o organizador; o core revalida catálogo e taxa e emite o pedido autorizado.
  bot.callbackQuery(DADOS_CARD.confirmar, async (ctx) => {
    const r = await chamar(ctx, agrupador, (s, a) => iris.fechar(s, a));
    if (!r) return;
    const { sessionId, resposta } = r;

    switch (resposta.outcome) {
      case 'closed':
      case 'already_closed': {
        await retirarBotoesDoCard(ctx.api, sessionId);
        const order = resposta.order;
        if (!order) return;

        const sessao = resposta.session ?? (await iris.obter(sessionId));
        const nomes = await iris.nomes(sessionId);
        const repetido = resposta.outcome === 'already_closed';
        await ctx.api.sendMessage(
          sessionId,
          `${textoPedido({ order, participantes: sessao?.participants ?? [], ...(nomes && { nomes }), repetido })}\n\n` +
            'Para um novo pedido, me mencione ou use /iniciar.',
          { parse_mode: 'HTML' },
        );

        // Idempotência: o executor recebe o pedido uma vez só (already_closed não executa de novo).
        if (!repetido) {
          try {
            await aoAutorizar(order);
          } catch (error) {
            console.error(`Erro ao entregar o pedido ${order.proposalId} ao executor:`, error);
          }
        }
        return;
      }

      case 'close_rejected': {
        // Taxa de serviço mudou (ou não deu para cotar): o core manda a proposta atualizada para o grupo rever.
        const taxa = resposta.problems?.some((p) => p.code === 'service_fee_changed' || p.code === 'service_fee_unavailable');
        if (taxa && resposta.proposal) {
          await exibirProposta(ctx.api, iris, sessionId, resposta, ctx.me.username);
          return;
        }
        await apresentarActions(ctx.api, resposta, ctx.me.username);
        await ctx.reply(TEXTO_CATALOGO_MUDOU);
        return;
      }

      default: {
        // budget_pending: o aviso com os nomes já vem nas actions; o card continua com os botões.
        await apresentarActions(ctx.api, resposta, ctx.me.username);
        const dica = DICAS_FECHAMENTO[resposta.outcome];
        if (dica) await ctx.reply(dica);
      }
    }
  });
}

export const TEXTO_CATALOGO_MUDOU =
  'Algo mudou no iFood desde a sugestão (item esgotado, loja fechada ou preço novo). ' +
  'Usem ↩️ Voltar para a coleta ou /montar para uma sugestão nova.';

const DICAS_FECHAMENTO: Record<string, string> = {
  address_required: 'Antes de confirmar, quem organizou precisa confirmar o endereço de entrega no privado.',
  no_session: 'Não há pedido em andamento.',
  session_finished: 'Este pedido já foi encerrado.',
};
