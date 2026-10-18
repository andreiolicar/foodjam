import { InputFile, type Api } from 'grammy';
import type { Resposta } from '../../core/index.js';
import { validatedItemImageUrl } from '../../ifood/visual-metadata.js';

type MediaApi = Pick<Api, 'sendPhoto' | 'deleteMessage'>;
// grammY tipa o shim de AbortSignal; Node fornece a mesma API em runtime.
type TelegramSignal = NonNullable<Parameters<Api['sendPhoto']>[3]>;
const telegramSignal = (signal: AbortSignal) => signal as unknown as TelegramSignal;
const timeoutMs = 2000;
const maxBytes = 5_000_000;

/** Prazo também vale para transportes que não respeitem AbortSignal. */
async function bounded(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise<void>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(); }, timeoutMs);
    })]);
  } catch { /* Mídia opcional. Não retém nem registra URL/erro remoto. */ }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}

export function removerFoto(api: MediaApi, sessionId: string, messageId: number): Promise<void> {
  return bounded(async signal => { await api.deleteMessage(sessionId, messageId, telegramSignal(signal)); });
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

/** Fotos não têm botões. O card textual já está entregue e controla a revisão. */
export async function enviarFotosProposta(api: MediaApi, sessionId: string, response: Resposta, cardId: number,
  current: () => Promise<boolean>, sent: Set<number>, active: () => boolean): Promise<void> {
  const proposal = response.preliminary; if (!proposal) return;
  const photos = new Map<string, string>();
  for (const chosen of proposal.items) {
    const item = response.items?.find(i => i.id === chosen.menuItemId && i.storeId === chosen.storeId);
    const url = validatedItemImageUrl(item?.itemImageUrl);
    if (url && !photos.has(url)) photos.set(url, item!.name);
    if (photos.size >= 2) break;
  }
  for (const [url, name] of photos) {
    if (!active() || !await current() || !active()) break;
    await bounded(async signal => {
      const bytes = await photoBytes(url, signal);
      if (!bytes || signal.aborted || !await current() || !active()) return;
      const message = await api.sendPhoto(sessionId, new InputFile(bytes, 'produto.jpg'), {
        caption: name.slice(0, 200), reply_parameters: { message_id: cardId },
      }, telegramSignal(signal));
      // Registra antes de qualquer await: cancelamento concorrente já pode limpar.
      sent.add(message.message_id);
      // Mesmo um transporte que termine depois do prazo não deixa mídia velha.
      if (signal.aborted || !await current() || !active()) {
        sent.delete(message.message_id);
        await removerFoto(api, sessionId, message.message_id);
      }
    });
  }
}
