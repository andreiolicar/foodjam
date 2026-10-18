import type { Update, UserFromGetMe } from 'grammy/types';

import type { Agente } from '../../src/core/index.js';
import { criarBot, type ExecutorPedido } from '../../src/telegram/index.js';

// Bot de verdade (grammY + handlers + core), sem rede: os updates entram por
// handleUpdate e cada chamada à API do Telegram é gravada e respondida aqui.

export const GRUPO = -100123;

export interface Pessoa {
  id: number;
  first_name: string;
}

export interface Chamada {
  method: string;
  payload: Record<string, unknown>;
  /** Id que a API falsa deu à mensagem enviada. */
  messageId?: number;
}

interface Teclado {
  inline_keyboard?: { text: string; callback_data?: string; url?: string }[][];
}

// Ids de mensagem únicos entre harnesses: o bot guarda "último card" e "última pergunta"
// por grupo em memória do módulo, e ids repetidos entre testes confundiriam isso.
let proximaMensagem = 1000;

const BOT_INFO = {
  id: 999,
  is_bot: true,
  first_name: 'Íris',
  username: 'iris_bot',
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

export function criarHarness(iris: Agente, opcoes: { semPrivado?: number[]; aoAutorizar?: ExecutorPedido } = {}) {
  const { bot, agrupador } = criarBot('123:TESTE', iris, opcoes.aoAutorizar ? { aoAutorizar: opcoes.aoAutorizar } : {});
  bot.botInfo = BOT_INFO;

  const chamadas: Chamada[] = [];
  const bloqueados = new Set(opcoes.semPrivado ?? []);
  let proximoUpdate = 1;

  bot.api.config.use(async (_anterior, method, payload) => {
    const p = payload as Record<string, unknown>;
    if (method === 'sendMessage' && bloqueados.has(Number(p.chat_id))) {
      return { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" } as never;
    }
    if (method === 'sendMessage') {
      const messageId = proximaMensagem++;
      chamadas.push({ method, payload: p, messageId });
      return { ok: true, result: { message_id: messageId, date: 0, chat: { id: Number(p.chat_id) }, text: p.text } } as never;
    }
    chamadas.push({ method, payload: p });
    return { ok: true, result: true } as never;
  });

  const de = (pessoa: Pessoa) => ({ id: pessoa.id, is_bot: false, first_name: pessoa.first_name });

  async function texto(pessoa: Pessoa, text: string, chatId: number = GRUPO): Promise<void> {
    const comando = /^\/\w+/.exec(text);
    const chat = chatId === pessoa.id ? { id: chatId, type: 'private', first_name: pessoa.first_name } : { id: chatId, type: 'supergroup', title: 'Almoço' };
    await bot.handleUpdate({
      update_id: proximoUpdate++,
      message: {
        message_id: proximaMensagem++,
        date: 0,
        chat,
        from: de(pessoa),
        text,
        ...(comando && { entities: [{ type: 'bot_command', offset: 0, length: comando[0].length }] }),
      },
    } as Update);
  }

  async function clicar(pessoa: Pessoa, data: string, mensagem: { chatId: number; messageId: number }): Promise<void> {
    const chat = mensagem.chatId === pessoa.id ? { id: pessoa.id, type: 'private', first_name: pessoa.first_name } : { id: mensagem.chatId, type: 'supergroup', title: 'Almoço' };
    await bot.handleUpdate({
      update_id: proximoUpdate++,
      callback_query: {
        id: `cb${proximoUpdate}`,
        from: de(pessoa),
        chat_instance: 'x',
        data,
        message: { message_id: mensagem.messageId, date: 0, chat, text: '' },
      },
    } as Update);
  }

  /** Mensagens enviadas a um chat, com o id que a API falsa deu e os botões. */
  function enviadas(chatId: number) {
    return chamadas.flatMap((c) => {
      if (c.method !== 'sendMessage' || Number(c.payload.chat_id) !== chatId) return [];
      const teclado = c.payload.reply_markup as Teclado | undefined;
      return [{ text: String(c.payload.text), botoes: teclado?.inline_keyboard?.flat() ?? [], messageId: c.messageId ?? 0 }];
    });
  }

  /** Clica no botão com este texto na última mensagem do chat que o tem. */
  async function clicarBotao(pessoa: Pessoa, chatId: number, rotulo: string): Promise<void> {
    const mensagem = enviadas(chatId).findLast((m) => m.botoes.some((b) => b.text === rotulo));
    const botao = mensagem?.botoes.find((b) => b.text === rotulo);
    if (!mensagem || !botao?.callback_data) throw new Error(`botão "${rotulo}" não encontrado no chat ${chatId}`);
    await clicar(pessoa, botao.callback_data, { chatId, messageId: mensagem.messageId });
  }

  const chamadasDe = (method: string) => chamadas.filter((c) => c.method === method);

  /** A pessoa abriu conversa com o bot: as DMs para ela passam a funcionar. */
  const liberarPrivado = () => bloqueados.clear();

  return { bot, agrupador, chamadas, texto, clicar, clicarBotao, enviadas, chamadasDe, liberarPrivado };
}
