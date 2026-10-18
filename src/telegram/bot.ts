import { Bot } from 'grammy';

import { criarAgrupador, type Agente, type Agrupador } from '../core/index.js';
import { registerHandlers } from './handlers/index.js';
import type { ExecutorPedido } from './handlers/proposta.js';
import { apresentarActions } from './services/apresentacao.js';
import { exibirProposta, retirarBotoesDoCard } from './services/proposta-tela.js';
import { loteAjustouProposta, reagirPreferencias } from './services/lote.js';

export interface OpcoesBot {
  /** Recebe cada pedido autorizado uma vez (o executor da compra no iFood). Padrão: só registra no log. */
  aoAutorizar?: ExecutorPedido;
  /** Produção MCP: revisão preliminar, sem fechar nem executar compra. */
  preliminaryOnly?: boolean;
}

export interface BotFoodjam {
  bot: Bot;
  agrupador: Agrupador;
}

// Cria o bot e o agrupador de mensagens do grupo. Não inicia o polling: quem chama decide quando.
export function criarBot(token: string, iris: Agente, opcoes: OpcoesBot = {}): BotFoodjam {
  const bot = new Bot(token);

  // Mensagens quase simultâneas do grupo viram um lote: uma chamada ao modelo em vez de várias.
  const agrupador = criarAgrupador(iris, {
    aoResponder: async (sessionId, resposta) => {
      const username = bot.botInfo.username;
      if (loteAjustouProposta(resposta)) {
        await exibirProposta(bot.api, iris, sessionId, resposta, username);
      } else {
        await apresentarActions(bot.api, resposta, username);
        if (resposta.session && !resposta.session.proposal && !resposta.session.preliminary) await retirarBotoesDoCard(bot.api, sessionId);
      }
      await reagirPreferencias(bot.api, sessionId, resposta);
    },
    onError: () => console.error('Erro ao responder lote. Dados privados omitidos.'),
  });

  const aoAutorizar: ExecutorPedido =
    opcoes.aoAutorizar ?? (() => console.info('foodjam: autorização recebida, sem executor configurado.'));
  registerHandlers(bot, iris, agrupador, aoAutorizar, opcoes.preliminaryOnly ?? false);

  bot.catch(() => console.error('Erro no bot. Dados privados omitidos.'));

  return { bot, agrupador };
}
