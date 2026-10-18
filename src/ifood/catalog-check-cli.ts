import { open, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { createIfoodMcpClient } from './client.js';
import type { IfoodMcpClient, IfoodMcpClientOptions, IfoodMcpTool } from './client.js';
import { readIfoodMcpConfig } from './config.js';
import type { IfoodMcpConfig } from './config.js';
import type { IfoodMcpReadResult } from './read-tools.js';
import { snapshotReadArguments } from './read-tools.js';
import { addCatalogRecord, catalogDocument, catalogInput, catalogPage, catalogMerchant, catalogItemIdentity, catalogMenuItem, IfoodCatalogError, mapMenuItem, mapMerchant, merchantMissing } from './catalog-data.js';
import { savedAddressLocation } from './catalog-address.js';

// Mais estreita que a allowlist pública. Discovery não habilita nomes novos.
const planSchema = z.object({
  moneyUnit: z.enum(['BRL', 'cents']).optional(),
  address: z.object({ formatted: z.string().min(1), id: z.string().min(1).optional() }).optional(),
  calls: z.array(z.object({
    name: z.enum(['listAddresses', 'searchOffers', 'browseOffers', 'getMerchant', 'getItem']),
    args: z.record(z.string(), z.unknown()),
    pagination: z.object({ maxPages: z.number().int().min(1).max(5) }).strict().optional(),
  }).strict().refine((call) => call.pagination === undefined || call.name === 'searchOffers' || call.name === 'browseOffers')).max(20),
}).strict();
type Plan = z.infer<typeof planSchema>;
type Call = Plan['calls'][number];

function expectedKind(call: Call): 'MERCHANT' | 'ITEM' {
  if (call.args.resultKind === 'MERCHANT' || call.args.resultKind === 'ITEM') return call.args.resultKind;
  return call.name === 'searchOffers' ? 'MERCHANT' : 'ITEM';
}

function parsePlan(value: unknown): Plan {
  const snapshot = snapshotReadArguments(value as Record<string, unknown>);
  const checked = planSchema.safeParse(snapshot);
  if (!checked.success) throw new Error('Plano de leitura inválido.');
  return checked.data;
}

function checkScope(row: unknown, merchantId: unknown, itemId?: unknown): void {
  catalogInput(merchantId as string);
  if (itemId !== undefined) {
    catalogInput(itemId as string);
    const actual = catalogItemIdentity(row, merchantId as string);
    if (actual.itemId !== itemId) throw new IfoodCatalogError('item_scope_mismatch');
    return;
  }
  if (!row || typeof row !== 'object' || !('merchantId' in row) || typeof row.merchantId !== 'string') throw new IfoodCatalogError('invalid_data');
  if (row.merchantId !== merchantId) throw new IfoodCatalogError('merchant_scope_mismatch');

}

function checkProfile(call: Call, result: IfoodMcpReadResult, plan: Plan): Record<string, unknown> {
  try {
    const document = catalogDocument(result);
    if (call.name === 'listAddresses') {
      if (!plan.address) return { ok: false, reason: 'address_not_provided' };
      return { ok: true, location: savedAddressLocation(document, {
        formatted: plan.address.formatted,
        ...(plan.address.id === undefined ? {} : { id: plan.address.id }),
      }) };
    }
    if (call.name === 'getMerchant' || call.name === 'getItem') {
      catalogInput(call.args.merchantId as string);
      if (call.name === 'getMerchant' && merchantMissing(document, call.args.merchantId as string)) return { ok: true, storeFound: false };
      if (call.name === 'getItem') catalogInput(call.args.itemId as string);
      checkScope(document, call.args.merchantId, call.name === 'getItem' ? call.args.itemId : undefined);
      if (!plan.moneyUnit) return { ok: false, reason: 'unit_unconfirmed', scopeVerified: true,
        ...(call.name !== 'getItem' ? {} : { availabilityVerified: typeof (document as Record<string, unknown>).available === 'boolean' }) };
      const mapped = call.name === 'getMerchant' ? mapMerchant(document, plan.moneyUnit)
        : mapMenuItem(document, call.args.merchantId as string, plan.moneyUnit);
      return { ok: true, mapped };
    }
    const kind = expectedKind(call);
    const page = catalogPage(document, kind);
    let merchantId: unknown;
    if (kind === 'MERCHANT') page.results.forEach(catalogMerchant);
    else {
      const refinements = call.args.refinements;
      merchantId = refinements && typeof refinements === 'object' && 'merchantId' in refinements ? refinements.merchantId : undefined;
      catalogInput(merchantId as string);
      for (const row of page.results) catalogMenuItem(row, merchantId as string);
    }
    if (!plan.moneyUnit) return { ok: false, reason: 'unit_unconfirmed', scopeVerified: kind === 'ITEM', ...(kind === 'ITEM' ? { availabilityVerified: page.results.length > 0 && page.results.every((row) => catalogMenuItem(row, merchantId as string).available !== undefined) } : {}), continuation: page.nextPageToken ? 'pending' : 'end_observed' };
    const mapped = page.results.map((row) => kind === 'MERCHANT'
      ? mapMerchant(row, plan.moneyUnit!) : mapMenuItem(row, merchantId as string, plan.moneyUnit!));
    return { ok: true, mapped, continuation: page.nextPageToken ? 'pending' : 'end_observed' };
  } catch (failure) {
    return { ok: false, reason: failure instanceof IfoodCatalogError ? failure.reason : 'profile_check_failed' };
  }
}

interface ReadReport {
  homologated: false;
  paginationVerified: false;
  tools: IfoodMcpTool[];
  calls: { name: Call['name']; args: Record<string, unknown>; result?: IfoodMcpReadResult; profile?: Record<string, unknown>; failure?: 'read_failed'; paginationFailure?: 'pagination_cycle' | 'pagination_limit' | 'conflicting_duplicate' }[];
}

/**
 * Manual e opt-in. Só chamadas do plano; paginação apenas com limite explícito.
 * writeReport recebe dados privados integrais: nunca enviar a logger/Telegram.
 */
export async function runCatalogReadCheck(options: {
  input: unknown;
  writeReport: (report: ReadReport) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  log?: (message: string) => void;
  error?: (message: string) => void;
  createClient?: (config: IfoodMcpConfig, options: IfoodMcpClientOptions) => Pick<IfoodMcpClient, 'connect' | 'listTools' | 'callReadTool' | 'close'>;
}): Promise<number> {
  const log = options.log ?? console.info;
  const error = options.error ?? console.error;
  let plan: Plan;
  let config: IfoodMcpConfig;
  try {
    plan = parsePlan(options.input);
    config = readIfoodMcpConfig(options.env ?? process.env);
    if (options.signal?.aborted || typeof options.writeReport !== 'function') throw new Error('Cancelado.');
  } catch { error('Plano, configuração ou destino privado inválido; leitura não iniciada.'); return 1; }

  const report: ReadReport = { homologated: false, paginationVerified: false, tools: [], calls: [] };
  let client: ReturnType<NonNullable<typeof options.createClient>> | undefined;
  let status = 0;
  const cancel = () => { void client?.close().catch(() => {}); };
  const checkCancelled = () => { if (options.signal?.aborted) throw new Error('Cancelado.'); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    checkCancelled();
    client = (options.createClient ?? createIfoodMcpClient)(config, {
      allowCartMutations: false, allowPaymentConfiguration: false,
    });
    log('Inspeção manual somente leitura. Autorize OAuth no navegador, se solicitado.');
    await client.connect();
    checkCancelled();
    report.tools = await client.listTools();
    checkCancelled();
    for (const call of plan.calls) {
      const seen = new Set<string>();
      const records = new Map<string, { id: string; record: unknown }>();
      let args = call.args;
      if (typeof args.nextPageToken === 'string' && args.nextPageToken) seen.add(args.nextPageToken);
      const limit = call.pagination?.maxPages ?? 1;
      for (let index = 0; index < limit; index++) {
        checkCancelled();
        const entry: ReadReport['calls'][number] = { name: call.name, args };
        report.calls.push(entry);
        try {
          entry.result = await client.callReadTool(call.name, args);
        } catch { entry.failure = 'read_failed'; throw new Error('Leitura não concluída.'); }
        checkCancelled();
        entry.profile = checkProfile({ ...call, args }, entry.result, plan);
        const failed = entry.profile.ok === false && !['unit_unconfirmed', 'address_not_provided'].includes(String(entry.profile.reason));
        if (failed) status = 1;
        // Sem opt-in, a semântica continua sendo exatamente uma página.
        // Perfil incompatível interrompe a paginação desta consulta.
        if (!call.pagination || failed) break;
        const kind = expectedKind(call);
        const page = catalogPage(catalogDocument(entry.result), kind);
        try {
          for (const row of page.results) {
            const record = kind === 'MERCHANT' ? catalogMerchant(row)
              : catalogMenuItem(row, (call.args.refinements as { merchantId: string }).merchantId);
            const id = 'itemId' in record ? record.itemId : record.merchantId;
            addCatalogRecord(records, { id, record });
          }
        } catch (failure) {
          if (!(failure instanceof IfoodCatalogError) || failure.reason !== 'conflicting_duplicate') throw failure;
          entry.paginationFailure = 'conflicting_duplicate'; status = 1; break;
        }
        const token = page.nextPageToken;
        if (!token) break;
        if (seen.has(token)) {
          entry.paginationFailure = 'pagination_cycle'; status = 1; break;
        }
        if (index + 1 === limit) {
          entry.paginationFailure = 'pagination_limit'; status = 1; break;
        }
        seen.add(token);
        // Preserva todos os argumentos originais, alterando só o token recebido.
        args = { ...call.args, nextPageToken: token };
      }
    }
  } catch { error('Inspeção não concluída; detalhes privados omitidos.'); status = 1; }
  finally {
    options.signal?.removeEventListener('abort', cancel);
    try { await client?.close(); }
    catch { error('Encerramento remoto não confirmado; detalhes omitidos.'); status = 1; }
  }
  try { await options.writeReport(report); }
  catch { error('Não foi possível gravar o relatório privado.'); return 1; }
  log('Relatório privado preparado. Perfil e paginação NÃO homologados; revise as evidências manualmente.');
  return status;
}

/** Criação exclusiva, sem sobrescrita/symlink, fora do repo e em diretório privado. */
export async function openPrivateCatalogReport(path: string) {
  if (!isAbsolute(path)) throw new Error('Destino privado inválido.');
  const parent = await realpath(dirname(path));
  const repository = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const fromRepository = relative(repository, parent);
  if (fromRepository === '' || (!fromRepository.startsWith(`..${sep}`) && fromRepository !== '..' && !isAbsolute(fromRepository))) {
    throw new Error('Destino privado deve ficar fora do repositório.');
  }
  if (((await stat(parent)).mode & 0o077) !== 0) throw new Error('Diretório deve ser privado.');
  return open(resolve(parent, path.slice(path.lastIndexOf(sep) + 1)), 'wx', 0o600);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const cancel = () => { abort.abort(); process.stdin.destroy(); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  void (async () => {
    if (process.argv.length !== 4 || process.argv[2] !== '--report') throw new Error('Uso inválido.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > 1_048_576) throw new Error('Plano muito grande.');
      chunks.push(buffer);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    parsePlan(input); // validar antes de arquivo, ambiente, rede ou OAuth
    const file = await openPrivateCatalogReport(process.argv[3]!);
    try {
      loadEnv({ quiet: true });
      return await runCatalogReadCheck({ input, signal: abort.signal,
        writeReport: async (report) => { await file.writeFile(JSON.stringify(report, null, 2)); },
      });
    } finally { await file.close(); }
  })().then((status) => { process.exitCode = status; }).catch(() => {
    console.error('Use --report com arquivo novo em diretório privado fora do repo e plano JSON válido em stdin. Dados omitidos.');
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  });
}
