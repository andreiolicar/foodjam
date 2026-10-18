import type { Context, Telegraf } from "telegraf";

import { registrarIniciar } from "./iniciar.js";
import { registrarMontar } from "./montar.js";
import { registrarProposta } from "./proposta.js";
import { registrarMensagens } from "./mensagens.js";
import { registrarEndereco } from "./endereco.js";
import { registrarCancelar } from "./cancelar.js";

export function registerHandlers(
  bot: Telegraf<Context>,
): void {
  registrarIniciar(bot);
  registrarEndereco(bot);
  registrarMontar(bot);
  registrarProposta(bot);
  registrarCancelar(bot);
  registrarMensagens(bot);
}