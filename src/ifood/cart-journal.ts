import { constants } from 'node:fs';
import { open, realpath, rename, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CartJournal } from './commercial.js';

/** Registro privado durável. Reserva ambígua nunca expira/recria automaticamente. */
export async function createPrivateCartJournal(directory: string): Promise<CartJournal> {
  if (!isAbsolute(directory) || (await lstat(directory)).isSymbolicLink()) throw new Error('Diretório privado inválido.');
  const base = await realpath(directory);
  const repository = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const inside = relative(repository, base);
  if ((await lstat(base)).mode & 0o077 || inside === '' || !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside)) throw new Error('Registro precisa ficar fora do repositório em diretório privado.');
  const path = (key: string) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Chave de registro inválida.');
    return resolve(base, createHash('sha256').update(key).digest('hex') + '.json');
  };
  async function syncDirectory() { const f = await open(base, 'r'); try { await f.sync(); } finally { await f.close(); } }
  async function get(key: string) {
    let file;
    try { file = await open(path(key), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
    try {
      const stat = await file.stat();
      if (stat.mode & 0o077 || stat.size > 16384) throw new Error('Registro privado inválido.');
      const data: unknown = JSON.parse(await file.readFile('utf8'));
      if (!data || typeof data !== 'object' || !('reserved' in data) || data.reserved !== true) throw new Error('Reserva inválida.');
      if ('cartId' in data) {
        if (typeof data.cartId !== 'string' || !data.cartId) throw new Error('Registro de carrinho inválido.');
        return { cartId: data.cartId };
      }
      return {};
    } finally { await file.close(); }
  }
  return {
    get,
    async reserve(key) {
      let file;
      try { file = await open(path(key), 'wx', 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
      try { await file.writeFile(JSON.stringify({ reserved: true })); await file.sync(); }
      finally { await file.close(); }
      await syncDirectory(); return true;
    },
    async saveCart(key, cartId) {
      if (!cartId || await get(key) === undefined) throw new Error('Reserva inexistente.');
      const target = path(key); const temp = `${target}.${randomUUID()}`;
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ reserved: true, cartId })); await file.sync(); }
      finally { await file.close(); }
      await rename(temp, target); await syncDirectory();
    },
  };
}
