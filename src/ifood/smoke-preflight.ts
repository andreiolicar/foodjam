import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createIfoodMcpClient, readIfoodMcpConfig } from './index.js';
import type { IfoodMcpClient, IfoodMcpClientOptions, IfoodMcpConfig } from './index.js';
import { IfoodMcpDiagnosticError } from './diagnostics.js';
import { readJsonObjectResult, validateCartId } from './cart-smoke.js';
import { snapshotReadArguments } from './read-tools.js';

const merchantId = '5443791a-6f3a-481a-9a60-9fa6bbfc2dd4';
const itemId = '18409df3-1e16-4bf8-9be5-433882c049aa';
interface SmokeInput {
  addressId: string;
  merchantArgs: Record<string, unknown>;
  itemArgs: Record<string, unknown>;
}

function parseInput(value: unknown): SmokeInput {
  const input = snapshotReadArguments(value as Record<string, unknown>);
  validateCartId(input.addressId);
  const merchant = snapshotReadArguments(input.merchantArgs as Record<string, unknown>);
  const item = snapshotReadArguments(input.itemArgs as Record<string, unknown>);
  const location = snapshotReadArguments(merchant.userLocation as Record<string, unknown>);
  const itemLocation = snapshotReadArguments(item.userLocation as Record<string, unknown>);
  if (merchant.merchantId !== merchantId || item.merchantId !== merchantId || item.itemId !== itemId
    || typeof location.latitude !== 'number' || typeof location.longitude !== 'number'
    || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
    || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180
    || itemLocation.latitude !== location.latitude || itemLocation.longitude !== location.longitude) throw new Error('Argumentos de pré-verificação inválidos.');
  return { addressId: input.addressId as string, merchantArgs: merchant, itemArgs: item };
}

/** Executa somente as três consultas da IF-02; nunca cria, atualiza ou paga. */
export async function runSmokePreflight(options: {
  input: unknown;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  error?: (message: string) => void;
  signal?: AbortSignal;
  createClient?: (config: IfoodMcpConfig, options?: IfoodMcpClientOptions) => Pick<IfoodMcpClient, 'connect' | 'callReadTool' | 'close'>;
}): Promise<number> {
  const log = options.log ?? console.info;
  const error = options.error ?? console.error;
  let input: SmokeInput;
  let config: IfoodMcpConfig;
  try { input = parseInput(options.input); config = readIfoodMcpConfig(options.env ?? process.env); }
  catch { error('Preparação ou configuração inválida. Nenhum dado pessoal foi exibido.'); return 1; }
  const client = (options.createClient ?? createIfoodMcpClient)(config, {
    allowCartMutations: false, onDiagnostic: (event) => log(`[ifood] ${JSON.stringify(event)}`),
  });
  const cancel = () => { void client.close().catch(() => {}); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const read = async (name: string, args: Record<string, unknown>) => {
    if (options.signal?.aborted) throw new Error('Cancelado.');
    const result = await client.callReadTool(name, args);
    if (options.signal?.aborted) throw new Error('Cancelado.');
    return readJsonObjectResult(result);
  };
  let status = 0;
  try {
    if (options.signal?.aborted) throw new Error('Cancelado.');
    log('Pré-verificação somente leitura. Autorize o usuário de teste no navegador, se solicitado.');
    await client.connect();
    const addresses = await read('listAddresses', {});
    const address: unknown = Array.isArray(addresses.results) ? addresses.results.find((record: unknown) =>
      !!record && typeof record === 'object' && 'addressId' in record && record.addressId === input.addressId) : undefined;
    if (!address || typeof address !== 'object' || !('coordinates' in address)) throw new Error('Endereço não confirmado.');
    const coordinates = snapshotReadArguments(address.coordinates as Record<string, unknown>);
    const location = input.merchantArgs.userLocation as Record<string, unknown>;
    if (coordinates.latitude !== location.latitude || coordinates.longitude !== location.longitude) throw new Error('Localização alterada.');
    const merchant = await read('getMerchant', input.merchantArgs);
    if (merchant.merchantId !== merchantId || merchant.isOpen !== true) throw new Error('Estabelecimento não confirmado como aberto.');
    const item = await read('getItem', input.itemArgs);
    if (item.itemId !== itemId || item.merchantId !== merchantId || typeof item.itemName !== 'string'
      || item.itemName.trim().toLocaleLowerCase('pt-BR') !== 'tradicional one'
      || !Array.isArray(item.optionGroups) || !item.optionGroups.every((group: unknown) =>
        !!group && typeof group === 'object' && 'minSelections' in group && group.minSelections === 0)) {
      throw new Error('Produto ou opções não confirmados.');
    }
    log('Pré-verificação aprovada: endereço da conta e localização conferidos; estabelecimento aberto; Tradicional One retornado sem opções obrigatórias. Dados pessoais e valores omitidos.');
  } catch (failure) {
    error(failure instanceof IfoodMcpDiagnosticError ? failure.message
      : 'Pré-verificação não aprovada. Dados omitidos; não crie o carrinho.');
    status = 1;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    try { await client.close(); log('Conexão encerrada.'); }
    catch { error('Recursos locais encerrados; encerramento remoto não confirmado.'); status = 1; }
  }
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const cancel = () => { abort.abort(); process.stdin.destroy(); };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  void (async () => {
    if (process.argv.length !== 2) throw new Error('Uso inválido.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > 1_048_576) throw new Error('Entrada excede limite.');
      chunks.push(buffer);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    parseInput(input);
    loadEnv({ quiet: true });
    return runSmokePreflight({ input, signal: abort.signal });
  })().then((status) => { process.exitCode = status; }).catch(() => {
    console.error('Use os argumentos privados da preparação em stdin; entrada inválida foi omitida.');
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  });
}
