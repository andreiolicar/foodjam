import { config } from 'dotenv';
import { GrammyError } from 'grammy';

import { CatalogoFake, LlmEmCascata, criarAgente, criarLlmDoAmbiente } from './core/index.js';
import { criarBot } from './telegram/index.js';

config({ quiet: true });

console.info('foodjam: bootstrap inicializado.');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.warn('foodjam: TELEGRAM_BOT_TOKEN ausente; o bot não foi iniciado.');
} else {
  const enderecoPadrao = process.env.ENDERECO_PADRAO;

  const llm = criarLlmDoAmbiente(process.env, {
    aoTrocar: (troca) =>
      console.warn(
        `[Íris] IA: ${troca.de} falhou (${troca.motivo}); ` +
          (troca.para ? `usando ${troca.para}.` : 'nenhum provedor restante.'),
      ),
  });
  if (llm instanceof LlmEmCascata) console.info(`foodjam: IA em cascata: ${llm.nomes.join(' → ')}.`);

  const iris = criarAgente({
    catalog: new CatalogoFake(), // trocar pela CatalogPort real do módulo iFood
    llm,
    onError: (error) => console.error('[Íris]', error),
    ...(enderecoPadrao && { enderecoPadrao }),
  });

  const { bot, agrupador } = criarBot(token, iris);

  // Ao desligar: envia os lotes pendentes antes de parar o polling.
  const parar = async () => {
    await agrupador.esvaziarTudo();
    await bot.stop();
  };
  process.once('SIGINT', () => void parar());
  process.once('SIGTERM', () => void parar());

  try {
    await bot.start({ onStart: (info) => console.info(`foodjam: bot @${info.username} iniciado.`) });
  } catch (error) {
    const naoAutorizado = error instanceof GrammyError && error.error_code === 401;
    console.error(
      naoAutorizado
        ? 'foodjam: o Telegram recusou o TELEGRAM_BOT_TOKEN (401). Copie o token completo do @BotFather.'
        : 'foodjam: não foi possível iniciar o bot.',
      naoAutorizado ? '' : error,
    );
    process.exitCode = 1;
  }
}
