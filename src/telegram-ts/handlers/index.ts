import type { Context, Telegraf } from "telegraf";

import { registrarIniciar } from "./iniciar.js";
import { registrarFinalizar } from "./finalizar.js";
import { registrarMensagens } from "./mensagens.js";

export function registerHandlers(
  bot: Telegraf<Context>,
): void {
  registrarIniciar(bot);
  registrarFinalizar(bot);
  registrarMensagens(bot);
}