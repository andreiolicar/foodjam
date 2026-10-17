
import { Telegraf } from "telegraf";

import { TELEGRAM_BOT_TOKEN } from "./config.js";
import { registerHandlers } from "./handlers.js";

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not configured");
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

registerHandlers(bot);

bot.launch()
  .then(() => console.log("Bot iniciado!"))
  .catch((error) => console.error("Erro ao iniciar o bot:", error));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
