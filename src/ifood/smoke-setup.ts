import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCartId } from './cart-smoke.js';

const merchantId = '5443791a-6f3a-481a-9a60-9fa6bbfc2dd4';
const itemId = '18409df3-1e16-4bf8-9be5-433882c049aa';

class PreparationError extends Error {}

/** Histórico somente leitura; grava apenas argumentos mínimos, nunca respostas. */
export async function prepareSmokeArguments(outDir: string, databasePath = join(homedir(), '.local/share/opencode/opencode.db')): Promise<void> {
  // Node >=22.13 já declarado no projeto. Importar esta CLI não abre SQLite.
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let addressId: string;
  let location: Record<string, unknown>;
  try {
    const records = (tool: string, session?: string) => {
      const query = "SELECT session_id,data FROM part WHERE json_extract(data,'$.tool')=? AND json_extract(data,'$.state.status')='completed'"
        + (session ? ' AND session_id=?' : '') + ' ORDER BY time_created DESC';
      return database.prepare(query).all(...(session ? [tool, session] : [tool])).map((row) => {
        if (typeof row.session_id !== 'string' || typeof row.data !== 'string') throw new PreparationError('Formato do histórico desconhecido.');
        const record = JSON.parse(row.data) as { state?: { input?: Record<string, unknown> } };
        return { session: row.session_id, args: record.state?.input ?? {} };
      });
    };
    const previous = records('ifood_createCart').find(({ args }) => {
      if (args.merchantId !== merchantId || !Array.isArray(args.items)
        || !args.items.some((item: unknown) => !!item && typeof item === 'object' && 'itemId' in item && item.itemId === itemId)) return false;
      try { validateCartId(args.addressId); return true; } catch { return false; }
    });
    if (!previous) throw new PreparationError('Registro anterior válido não encontrado. Confirme o endereço pelo MCP antes de criar; nenhum ID foi inventado.');
    const merchant = records('ifood_getMerchant', previous.session).find(({ args }) => args.merchantId === merchantId)?.args;
    const item = records('ifood_getItem', previous.session).find(({ args }) => args.merchantId === merchantId && args.itemId === itemId)?.args;
    const merchantLocation = merchant?.userLocation;
    const itemLocation = item?.userLocation;
    if (!merchantLocation || typeof merchantLocation !== 'object' || Array.isArray(merchantLocation)
      || !itemLocation || typeof itemLocation !== 'object' || Array.isArray(itemLocation)) throw new PreparationError('Localização anterior não confirmada. Não crie o carrinho.');
    location = merchantLocation as Record<string, unknown>;
    for (const [field, limit] of [['latitude', 90], ['longitude', 180]] as const) {
      const value = location[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit
        || (itemLocation as Record<string, unknown>)[field] !== value) throw new PreparationError('Localização anterior inválida ou divergente. Nenhum valor foi exibido.');
    }
    location = { latitude: location.latitude, longitude: location.longitude };
    addressId = validateCartId(previous.args.addressId);
  } finally { database.close(); }

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const files: [string, Record<string, unknown>][] = [
    [join(outDir, 'ifood-smoke-create.json'), { merchantId, addressId, items: [{ itemId, quantity: 1 }] }],
    [join(outDir, 'ifood-smoke-preflight.json'), { addressId, merchantArgs: { merchantId, userLocation: location }, itemArgs: { merchantId, itemId, userLocation: location } }],
  ];
  if (files.some(([path]) => existsSync(path))) throw new PreparationError('Arquivos de preparação já existem; não serão sobrescritos. Revise os argumentos locais antes de continuar.');
  for (const [path, body] of files) {
    const file = openSync(path, 'wx', 0o600);
    try { writeFileSync(file, JSON.stringify(body) + '\n'); } finally { closeSync(file); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    let outDir: string | undefined;
    let databasePath: string | undefined;
    const seen = new Set<string>();
    const argv = process.argv.slice(2);
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index]!;
      const value = argv[index + 1];
      if (value === undefined || seen.has(flag)) throw new PreparationError('Uso: smoke-setup.ts --out-dir DIRETORIO [--database ARQUIVO].');
      seen.add(flag);
      if (flag === '--out-dir') outDir = value;
      else if (flag === '--database') databasePath = value;
      else throw new PreparationError('Uso: smoke-setup.ts --out-dir DIRETORIO [--database ARQUIVO].');
    }
    if (!outDir) throw new PreparationError('Informe o diretório de argumentos privados.');
    await prepareSmokeArguments(outDir, databasePath);
    console.info('Argumentos preparados em arquivos privados. Endereço omitido; nenhuma chamada remota executada.');
  })().catch((failure: unknown) => {
    console.error(failure instanceof PreparationError ? failure.message : 'Preparação local não concluída; dados do registro foram omitidos. Não crie o carrinho.');
    process.exitCode = 1;
  });
}
