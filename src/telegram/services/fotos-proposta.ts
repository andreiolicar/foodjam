import { GrammyError, InlineKeyboard, InputFile, type Api } from 'grammy';
import { validatedItemImageUrl } from '../../ifood/visual-metadata.js';

type MediaApi = Pick<Api, 'sendPhoto' | 'sendMessage' | 'deleteMessage' | 'editMessageReplyMarkup' | 'editMessageCaption' | 'editMessageText'>;
// grammY tipa o shim de AbortSignal; Node fornece a mesma API em runtime.
type TelegramSignal = NonNullable<Parameters<Api['sendPhoto']>[3]>;
const telegramSignal = (signal: AbortSignal) => signal as unknown as TelegramSignal;
const timeoutMs = 2000;
const maxBytes = 5_000_000;

/** Prazo também vale para transportes que não respeitem AbortSignal. */
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise<undefined>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(undefined); }, timeoutMs);
    })]);
  } catch { /* Mídia opcional. Não retém nem registra URL/erro remoto. */ }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}

/** Limpeza limitada por tempo; só a exclusão confirmada permite substituir um item. */
export async function removerFoto(api: MediaApi, sessionId: string, messageId: number): Promise<boolean> {
  // Uma exclusão recusada não pode abortar a retirada independente dos botões.
  const [, deleted] = await Promise.all([
    bounded(signal => api.editMessageReplyMarkup(sessionId, messageId, { reply_markup: new InlineKeyboard() }, telegramSignal(signal))),
    bounded(signal => api.deleteMessage(sessionId, messageId, telegramSignal(signal))),
  ]);
  return deleted === true;
}

/** Download apenas da origem comprovada, sem redirects, com teto de bytes/tempo. */
async function photoBytes(url: string, signal: AbortSignal): Promise<Uint8Array | undefined> {
  const response = await fetch(url, { redirect: 'error', signal });
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const length = response.headers.get('content-length');
  if (!response.ok || response.redirected || !['image/jpeg', 'image/png', 'image/webp'].includes(type ?? '')
    || length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel(); return;
  }
  const reader = response.body?.getReader(); if (!reader) return;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (!signal.aborted) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) return;
      chunks.push(part.value);
    }
    if (signal.aborted || size === 0) return;
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Só uma rejeição explícita do Bot API prova que a mensagem não foi criada. */
function rejected(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code >= 400 && error.error_code < 500;
}
export type ResultadoEnvioItem = 'sent' | 'not_sent' | 'uncertain';
type AoEnviar = (messageId: number, late: boolean) => void;

/** Falha pré-envio permite texto; upload iniciado e incerto nunca permite duplicar. */
export async function enviarFotoItem(api: MediaApi, sessionId: string, itemImageUrl: string | undefined,
  caption: string, cardId: number, current: () => Promise<boolean>, active: () => boolean,
  onSent: AoEnviar): Promise<ResultadoEnvioItem> {
  const url = validatedItemImageUrl(itemImageUrl);
  if (!url || caption.length > 1024) return 'not_sent';
  let started = false; let refused = false; let delivered = false;
  await bounded(async signal => {
    const bytes = await photoBytes(url, signal);
    if (!bytes || !await current() || !active() || signal.aborted) return;
    started = true;
    let message: { message_id: number };
    try { message = await api.sendPhoto(sessionId, new InputFile(bytes, 'produto.jpg'), { caption, parse_mode: 'HTML', reply_parameters: { message_id: cardId } }, telegramSignal(signal)); }
    catch (error) { refused = rejected(error); return; }
    if (!await current() || !active()) { await removerFoto(api, sessionId, message.message_id); return; }
    // Aborto não prova que o Telegram recusou a foto. Na revisão vigente,
    // adota o único envio tardio em vez de apagá-lo após publicar outro.
    onSent(message.message_id, signal.aborted); delivered = true;
  });
  return delivered ? 'sent' : started && !refused ? 'uncertain' : 'not_sent';
}

/** Texto tem a mesma proteção contra retentativa de uma entrega ambígua. */
export async function enviarTextoItem(api: MediaApi, sessionId: string, text: string, cardId: number,
  current: () => Promise<boolean>, active: () => boolean, onSent: AoEnviar): Promise<ResultadoEnvioItem> {
  let started = false; let refused = false; let delivered = false;
  await bounded(async signal => {
    if (!await current() || !active() || signal.aborted) return;
    started = true;
    let message: { message_id: number };
    try { message = await api.sendMessage(sessionId, text, { parse_mode: 'HTML', reply_parameters: { message_id: cardId } }, telegramSignal(signal)); }
    catch (error) { refused = rejected(error); return; }
    if (!await current() || !active()) { await removerFoto(api, sessionId, message.message_id); return; }
    onSent(message.message_id, signal.aborted); delivered = true;
  });
  return delivered ? 'sent' : started && !refused ? 'uncertain' : 'not_sent';
}

/** Edição opcional também tem prazo; o ID antigo nunca limpa seu substituto. */
export async function editarMensagemItem(api: MediaApi, sessionId: string, messageId: number,
  kind: 'photo' | 'text', text: string, active: () => boolean): Promise<boolean> {
  return await bounded(async signal => {
    try {
      try {
        if (kind === 'photo') await api.editMessageCaption(sessionId, messageId, { caption: text, parse_mode: 'HTML' }, telegramSignal(signal));
        else await api.editMessageText(sessionId, messageId, text, { parse_mode: 'HTML' }, telegramSignal(signal));
      } catch (error) {
        if (!(error instanceof GrammyError && error.description.includes('message is not modified'))) throw error;
      }
      return !signal.aborted && active();
    } finally {
      if (!active()) await removerFoto(api, sessionId, messageId);
    }
  }) === true;
}

/** O resumo já existe: timeout da edição mantém seus botões e libera os itens. */
export async function editarResumoProposta(api: MediaApi, sessionId: string, messageId: number, text: string,
  options: NonNullable<Parameters<Api['editMessageText']>[3]>, active: () => boolean): Promise<void> {
  await bounded(async signal => {
    try { await api.editMessageText(sessionId, messageId, text, options, telegramSignal(signal)); }
    finally { if (!active()) await removerFoto(api, sessionId, messageId); }
  });
}
