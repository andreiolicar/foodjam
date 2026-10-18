import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarAplicacaoReal } from './app.js';

/** Entrada única: Telegram grammY + Core de descoberta + Groq + MCP reais. */
export async function iniciarAplicacao(args = process.argv.slice(2)) {
  console.info('foodjam: bootstrap inicializado.');
  if (args.length && (args.length !== 2 || args[0] !== '--env')) throw new Error('Use --env com o arquivo local de MCP/Groq.');
  const loaded = config({ quiet: true, ...(args[1] ? { path: resolve(args[1]) } : {}) });
  if (args[1] && loaded.error) throw new Error('Não foi possível ler o arquivo local de ambiente.');
  if (!process.env.TELEGRAM_BOT_TOKEN) { console.warn('foodjam: TELEGRAM_BOT_TOKEN ausente; o bot não foi iniciado.'); return; }
  const runtime = await criarAplicacaoReal(process.env);
  const stop = () => { void runtime.close().catch(() => { console.error('foodjam: falha ao encerrar a conexão. Dados privados omitidos.'); }).finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const info = await runtime.bot.api.getMe(); runtime.bot.botInfo = info;
    if ((await runtime.bot.api.getWebhookInfo()).url) throw new Error('Webhook ativo: alinhe o polling antes de iniciar.');
    console.info(info.can_read_all_group_messages ? 'Telegram autenticado; leitura geral de grupo informada pelo bot.' : 'Privacy Mode ativo ou não informado: respondam diretamente à mensagem do bot e confiram as reações de recebimento.');
    await runtime.bot.start({ onStart: () => console.info('foodjam: interface grammY iniciada em modo preliminar.') });
    return runtime;
  } catch (error) {
    await runtime.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    throw new Error('Não foi possível manter a interface Telegram.', { cause: error });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void iniciarAplicacao().catch(() => { console.error('foodjam: integração real não iniciada; confira configuração, OAuth e polling. Dados privados omitidos.'); process.exitCode = 1; });
}
