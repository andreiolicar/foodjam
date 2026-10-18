import { InlineKeyboard, InputFile, type Api } from 'grammy';
import type { Resposta } from '../../core/index.js';
import { validatedItemImageUrl } from '../../ifood/visual-metadata.js';

type MediaApi = Pick<Api, 'sendPhoto' | 'deleteMessage' | 'editMessageReplyMarkup'>;
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

/** Identidade já foi invalidada; remove botões e foto sem bloquear outro card. */
export async function removerFoto(api: MediaApi, sessionId: string, messageId: number): Promise<void> {
  await bounded(async signal => {
    await Promise.allSettled([
      api.editMessageReplyMarkup(sessionId, messageId, { reply_markup: new InlineKeyboard() }, telegramSignal(signal)),
      api.deleteMessage(sessionId, messageId, telegramSignal(signal)),
    ]);
  });
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

/** Uma foto do primeiro produto selecionado que tenha URL válida. */
export async function enviarFotoProposta(api: MediaApi, sessionId: string, response: Resposta,
  options: NonNullable<Parameters<Api['sendPhoto']>[2]>, current: () => Promise<boolean>,
  active: () => boolean): Promise<{ message_id: number } | undefined> {
  let url: string | undefined;
  for (const chosen of response.preliminary?.items ?? []) {
    const item = response.items?.find(i => i.id === chosen.menuItemId && i.storeId === chosen.storeId);
    url = validatedItemImageUrl(item?.itemImageUrl);
    if (url) break;
  }
  if (!url) return;
  return bounded(async signal => {
    const bytes = await photoBytes(url, signal);
    if (!bytes || signal.aborted || !await current() || !active()) return;
    const message = await api.sendPhoto(sessionId, new InputFile(bytes, 'produto.jpg'), options, telegramSignal(signal));
    // A tentativa pode terminar depois do prazo ou da troca. Nunca registra
    // essa mensagem como card, mesmo se o texto de fallback já foi entregue.
    if (signal.aborted || !active()) {
      await removerFoto(api, sessionId, message.message_id);
      return;
    }
    return message;
  });
}
