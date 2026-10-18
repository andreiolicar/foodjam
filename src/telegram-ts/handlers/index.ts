import type { Context, Telegraf } from "telegraf";

import { registrarIniciar } from "./iniciar.js";
import { registrarFinalizar } from "./finalizar.js";
import { registrarMensagens } from "./mensagens.js";
import { registrarEndereco } from "./endereco.js";
import { registrarCancelar } from "./cancelar.js";

export function registerHandlers(
  bot: Telegraf<Context>,
): void {
  registrarIniciar(bot);
  registrarEndereco(bot);
  registrarFinalizar(bot);
  registrarCancelar(bot);
  registrarMensagens(bot);
}