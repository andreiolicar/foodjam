import { Markup, type Context, type Telegraf } from "telegraf";

import { iris } from "../iris.js";
import * as collector from "../collector.js";
import { setOrganizador, setAguardandoEndereco } from "./state.js";
import { apresentarActions } from "../services/apresentacao.js";

async function pedirOuConfirmarEndereco(
  ctx: Context,
  chatId: number,
  statusEndereco: string | undefined,
): Promise<void> {
  // Sem endereço salvo: pede o endereço em vez de mostrar os botões.
  if (statusEndereco === "awaiting_text") {
    setAguardandoEndereco(chatId);

    await ctx.reply(
      "Envie o endereço de entrega completo, incluindo rua, número, bairro e cidade.",
    );
    return;
  }

  // Só chega aqui se já existir um endereço para confirmar.
  await ctx.reply(
    "Antes de começar, confirme o endereço de entrega ou escolha outro endereço.",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "✅ Sim, confirmar endereço",
          "endereco:confirmar",
        ),
      ],
      [
        Markup.button.callback(
          "🏠 Outro endereço",
          "endereco:outro",
        ),
      ],
    ]),
  );
}

export function registrarIniciar(bot: Telegraf<Context>): void {
  bot.command("iniciar", async (ctx) => {
    const chatId = ctx.chat.id;
    const usuario = ctx.from;

    if (!usuario) {
      await ctx.reply("Não foi possível identificar o organizador.");
      return;
    }

    if (collector.isActive(chatId)) {
      await ctx.reply("Já existe uma coleta ativa.");
      return;
    }

    const participantId = String(usuario.id);
    const displayName = usuario.first_name ?? "Participante";

    try {
      const inicio = await iris.iniciar(String(chatId), {
        id: participantId,
        displayName,
      });

      await apresentarActions(ctx, chatId, inicio);

      // Já existe uma sessão na Íris (por exemplo, parada na etapa do endereço).
      if (inicio.outcome === "already_active") {
        const organizerId = inicio.session?.organizerId;

        if (organizerId === undefined) {
          await ctx.reply(
            "Já existe um pedido em andamento. Use /cancelar para encerrá-lo e começar de novo.",
          );
          return;
        }

        if (String(organizerId) !== participantId) {
          await ctx.reply(
            "Já existe um pedido em andamento iniciado por outra pessoa.",
          );
          return;
        }

        setOrganizador(chatId, participantId);
        await pedirOuConfirmarEndereco(
          ctx,
          chatId,
          inicio.session?.address?.status,
        );
        return;
      }

      if (inicio.outcome !== "started") {
        await ctx.reply(
          `Não foi possível iniciar uma nova sessão. Resultado: ${inicio.outcome}.`,
        );
        return;
      }

      setOrganizador(chatId, participantId);
      await pedirOuConfirmarEndereco(
        ctx,
        chatId,
        inicio.session?.address?.status,
      );
    } catch (error) {
      console.error("Erro ao iniciar:", error);
      await ctx.reply("Não foi possível iniciar o pedido.");
    }
  });
}