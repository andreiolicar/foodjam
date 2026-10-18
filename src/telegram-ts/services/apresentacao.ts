import type { Context } from "telegraf";

type RespostaBot = {
  outcome?: string;
  actions?: Array<{
    type?: string;
    participantId?: string;
    text?: string;
    message?: string;
  }>;
  proposal?: {
    justification?: string;
    [key: string]: unknown;
  };
};

export async function apresentarActions(
  ctx: Context,
  chatId: number,
  respostaOriginal: unknown,
): Promise<void> {
  const resposta = respostaOriginal as RespostaBot;

  for (const action of resposta.actions ?? []) {
    if (action.type !== "send_message") continue;

    const texto = action.text ?? action.message;
    if (!texto) continue;

    const destino = action.participantId ?? String(chatId);

    try {
      await ctx.telegram.sendMessage(destino, texto);
    } catch (error) {
      console.error(
        "Não foi possível enviar action da Íris:",
        error,
      );
    }
  }
}

export async function mostrarResultado(
  ctx: Context,
  chatId: number,
  respostaOriginal: unknown,
): Promise<void> {
  const resposta = respostaOriginal as RespostaBot;

  await apresentarActions(ctx, chatId, resposta);

  if (!resposta.proposal) {
    await ctx.telegram.sendMessage(
      chatId,
      `A Íris não gerou uma proposta. Resultado: ${
        resposta.outcome ?? "desconhecido"
      }.`,
    );
    return;
  }

  const proposta = resposta.proposal;

  await ctx.telegram.sendMessage(
    chatId,
    `🍽️ Recomendação da Íris\n\n${
      proposta.justification ?? "A Íris montou uma proposta."
    }`,
  );

  // Exibição temporária para validar a integração.
  const detalhes = JSON.stringify(proposta, null, 2) ?? "{}";
  const tamanhoParte = 3500;

  for (let i = 0; i < detalhes.length; i += tamanhoParte) {
    await ctx.telegram.sendMessage(
      chatId,
      `${i === 0 ? "Detalhes da proposta:\n" : ""}${
        detalhes.slice(i, i + tamanhoParte)
      }`,
    );
  }
}