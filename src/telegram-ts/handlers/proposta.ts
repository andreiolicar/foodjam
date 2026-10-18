import type { Context, Telegraf } from "telegraf";

import { iris } from "../iris.js";
import * as collector from "../collector.js";
import {
  clearAguardandoOrcamento,
  clearEmProposta,
  clearOrganizador,
  getOrganizador,
  isAguardandoOrcamento,
  isEmProposta,
  setAguardandoOrcamento,
} from "./state.js";
import { apresentarActions } from "../services/apresentacao.js";
import {
  botoesProposta,
  exibirProposta,
  type RespostaProposta,
} from "./montar.js";

const FALHAS: string[] = [
  "error",
  "not_authorized",
  "invalid_state",
  "no_session",
  "session_finished",
];

// Valida quem clicou e se ainda existe uma proposta na tela.
async function validar(
  ctx: Context,
): Promise<{ chatId: number; actorId: string } | undefined> {
  const chatId = ctx.chat?.id;
  const actorId = ctx.from?.id;

  await ctx.answerCbQuery();

  if (chatId == null || actorId == null) return undefined;

  if (String(actorId) !== getOrganizador(chatId)) {
    await ctx.reply("Somente o organizador pode usar esses botões.");
    return undefined;
  }

  if (!isEmProposta(chatId)) {
    await ctx.reply(
      "Essa sugestão não está mais ativa. Use /montar para gerar outra.",
    );
    return undefined;
  }

  return { chatId, actorId: String(actorId) };
}

// Remove os botões da mensagem clicada para evitar clique duplo.
async function tirarBotoes(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch {
    // a mensagem pode já ter sido editada; ignora
  }
}

export function registrarProposta(bot: Telegraf<Context>): void {
  // Confirma a proposta e encerra a etapa de escolha.
  bot.action("proposta:confirmar", async (ctx) => {
    const dados = await validar(ctx);
    if (!dados) return;

    const { chatId, actorId } = dados;

    try {
      await tirarBotoes(ctx);

      const resposta = await iris.fechar(String(chatId), actorId);

      await apresentarActions(ctx, chatId, resposta);

      console.log("Fechamento do pedido:", resposta);

      if (FALHAS.includes(resposta.outcome)) {
        await ctx.reply(
          `Não foi possível confirmar o pedido. Resultado: ${resposta.outcome}.`,
        );
        return;
      }

      clearOrganizador(chatId);

      await ctx.reply(
        "Pedido confirmado! A próxima etapa é o pagamento. Para um novo pedido, use /iniciar.",
      );
    } catch (error) {
      console.error("Erro ao confirmar o pedido:", error);
      await ctx.reply("Não foi possível confirmar o pedido.");
    }
  });

  // Pede uma nova sugestão sem mexer na coleta.
  bot.action("proposta:outra", async (ctx) => {
    const dados = await validar(ctx);
    if (!dados) return;

    const { chatId, actorId } = dados;

    try {
      await tirarBotoes(ctx);

      // Se o core tiver um método próprio para recusar a proposta atual,
      // troque esta chamada por ele.
      const resposta = await iris.propor(String(chatId), actorId);

      console.log("Nova proposta da Íris:", resposta);

      const temProposta = await exibirProposta(ctx, chatId, resposta);

      if (!temProposta) {
        await ctx.reply(
          "Não consegui gerar outra opção agora. Use /cancelar ou volte para a coleta.",
        );
      }
    } catch (error) {
      console.error("Erro ao pedir outra opção:", error);
      await ctx.reply("Não foi possível gerar outra opção.");
    }
  });

  // Pede um orçamento menor: o próximo texto do organizador é a resposta.
  bot.action("proposta:orcamento", async (ctx) => {
    const dados = await validar(ctx);
    if (!dados) return;

    await tirarBotoes(ctx);

    setAguardandoOrcamento(dados.chatId);

    await ctx.reply(
      "Qual é o novo orçamento? Envie o valor, por exemplo: até R$ 40.",
    );
  });

  // Reabre a coleta para a turma adicionar mais mensagens.
  bot.action("proposta:voltar", async (ctx) => {
    const dados = await validar(ctx);
    if (!dados) return;

    const { chatId, actorId } = dados;

    try {
      await tirarBotoes(ctx);

      const resposta = await iris.reabrirColeta(String(chatId), actorId);

      await apresentarActions(ctx, chatId, resposta);

      console.log("Reabertura da coleta:", resposta);

      if (FALHAS.includes(resposta.outcome)) {
        await ctx.reply(
          `Não foi possível voltar para a coleta. Resultado: ${resposta.outcome}.`,
        );
        return;
      }

      clearEmProposta(chatId);

      if (!collector.isActive(chatId)) {
        collector.start(chatId);
      }

      await ctx.reply(
        "Coleta reaberta! Envie mais mensagens e, quando terminar, use /montar.",
      );
    } catch (error) {
      console.error("Erro ao reabrir a coleta:", error);
      await ctx.reply("Não foi possível reabrir a coleta.");
    }
  });

  // Cancela o pedido diretamente.
  bot.action("proposta:cancelar", async (ctx) => {
    const dados = await validar(ctx);
    if (!dados) return;

    const { chatId, actorId } = dados;

    try {
      await tirarBotoes(ctx);

      const resposta = await iris.cancelar(String(chatId), actorId);

      await apresentarActions(ctx, chatId, resposta);

      console.log("Cancelamento:", resposta.outcome);

      collector.finish(chatId);
      clearOrganizador(chatId);

      await ctx.reply("Pedido cancelado. Para começar outro, use /iniciar.");
    } catch (error) {
      console.error("Erro ao cancelar o pedido:", error);
      await ctx.reply("Não foi possível cancelar o pedido.");
    }
  });

  // Recebe o texto com o novo orçamento (depois do botão "Orçamento menor").
  bot.on("text", async (ctx, next) => {
    const chatId = ctx.chat.id;

    if (!isAguardandoOrcamento(chatId)) {
      return next();
    }

    // Deixa os comandos (como /cancelar) passarem.
    if (ctx.message.text.startsWith("/")) {
      return next();
    }

    const actorId = String(ctx.from.id);

    if (actorId !== getOrganizador(chatId)) {
      await ctx.reply("Aguarde o organizador informar o novo orçamento.");
      return;
    }

    try {
      // Aqui "resposta" é o texto digitado. Se o core esperar outro formato
      // (número, valor fixo), converta antes de chamar.
      const resposta = await iris.responderOrcamento(
        String(chatId),
        actorId,
        ctx.message.text.trim(),
      );

      await apresentarActions(ctx, chatId, resposta);

      console.log("Resposta ao orçamento:", resposta);

      clearAguardandoOrcamento(chatId);

      if (FALHAS.includes(resposta.outcome)) {
        await ctx.reply(
          `Não foi possível ajustar o orçamento. Resultado: ${resposta.outcome}.`,
          botoesProposta(),
        );
        return;
      }

      // Usa a proposta que já veio na resposta; se não veio, pede uma nova.
      const jaTemProposta =
        (resposta as { proposal?: unknown }).proposal != null;

      const proposta = jaTemProposta
        ? (resposta as unknown as RespostaProposta)
        : await iris.propor(String(chatId), actorId);

      const temProposta = await exibirProposta(ctx, chatId, proposta);

      if (!temProposta) {
        await ctx.reply(
          "Não consegui montar uma sugestão dentro desse orçamento. Tente outro valor ou volte para a coleta.",
          botoesProposta(),
        );
      }
    } catch (error) {
      console.error("Erro ao responder o orçamento:", error);
      clearAguardandoOrcamento(chatId);

      await ctx.reply(
        "Não foi possível ajustar o orçamento.",
        botoesProposta(),
      );
    }
  });
}