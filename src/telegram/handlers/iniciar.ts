import type { Bot, Context } from 'grammy';

import type { Agente } from '../../core/index.js';
import { retirarBotoesDoCard } from '../services/proposta-tela.js';
import { apresentarActions } from '../services/apresentacao.js';

const FINAIS = new Set(['closed', 'cancelled']);

// Quem menciona o bot (ou usa /iniciar) no grupo vira organizador.
async function iniciarPedido(ctx: Context, iris: Agente): Promise<void> {
  const chat = ctx.chat;
  const usuario = ctx.from;
  if (!chat || !usuario) return;

  if (chat.type === 'private') {
    await ctx.reply('Me adicione a um grupo e me mencione lá (ou use /iniciar) para começar um pedido coletivo.');
    return;
  }

  const nome = usuario.first_name;

  try {
    const resposta = await iris.iniciar(String(chat.id), { id: String(usuario.id), displayName: nome });

    if (resposta.outcome === 'already_active') {
      await ctx.reply('Já existe um pedido em andamento neste grupo. Quem organizou pode usar /cancelar para encerrá-lo.');
      return;
    }

    if (resposta.outcome !== 'started') {
      await apresentarActions(ctx.api, resposta, ctx.me.username);
      await ctx.reply(`Não foi possível iniciar o pedido. Resultado: ${resposta.outcome}.`);
      return;
    }

    const enderecoNoGrupo = resposta.actions.some(a => a.type === 'confirm_address' && a.visibility === 'group');
    await ctx.reply(
      `Pedido iniciado por ${nome}! ` + (enderecoNoGrupo ? 'Mandem aqui preferências e restrições. Confirmações de orçamento permanecem no privado.\n' : 'Mandem aqui o que querem comer, restrições e limite de valor.\n') +
        (enderecoNoGrupo
          ? 'Confirme o endereço aqui no grupo. Quando todos tiverem falado, use /montar.'
          : `${nome}, te chamei no privado para combinar o endereço de entrega. Quando todos tiverem falado, use /montar.`),
    );

    // Endereço vai no privado do organizador.
    await apresentarActions(ctx.api, resposta, ctx.me.username);
  } catch {
    console.error('Erro ao iniciar. Dados privados omitidos.');
    await ctx.reply('Não foi possível iniciar o pedido.');
  }
}

export function registrarIniciar(bot: Bot, iris: Agente): void {
  bot.command('iniciar', (ctx) => iniciarPedido(ctx, iris));
  bot.chatType(['group', 'supergroup']).command('endereco', async ctx => {
    const id = String(ctx.chat.id); const result = await iris.pedirOutroEndereco(id, String(ctx.from.id));
    if (result.outcome === 'not_authorized') { await ctx.reply('Somente quem organizou pode trocar o endereço.'); return; }
    if (result.session && !result.session.preliminary && !result.session.proposal) await retirarBotoesDoCard(ctx.api, id);
    await apresentarActions(ctx.api, result, ctx.me.username);
    if (['error', 'catalog_failed'].includes(result.outcome)) await ctx.reply('Não foi possível reler os endereços salvos. A proposta anterior foi invalidada. Use /endereco quando a consulta estiver disponível.');
  });

  // Menção ao bot no grupo: inicia se não houver pedido ativo; senão segue para a coleta.
  bot.chatType(['group', 'supergroup']).on('message:text', async (ctx, next) => {
    const mencao = `@${ctx.me.username}`.toLowerCase();
    if (!ctx.message.text.toLowerCase().includes(mencao)) return next();

    const sessao = await iris.obter(String(ctx.chat.id));
    if (sessao && !FINAIS.has(sessao.status)) return next();

    await iniciarPedido(ctx, iris);

    // "@bot bora pedir, quero pizza": o resto da mensagem já entra na coleta.
    const resto = ctx.message.text.replace(new RegExp(mencao, 'gi'), '');
    if (/\p{L}/u.test(resto)) return next();
  });
}
