import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createIfoodMcpClient, readIfoodMcpConfig } from './index.js';
import type { IfoodMcpClient, IfoodMcpClientOptions, IfoodMcpConfig } from './index.js';
import { IfoodMcpDiagnosticError } from './diagnostics.js';
import { assertApprovedCartTool } from './cart-tools.js';
import { snapshotToolArguments } from './tool-validation.js';
import { extractCartId, inspectCartResult, parseCartIdPath, validateCartId, verifySingleCartItem } from './cart-smoke.js';
import type { CartIdLocation } from './cart-smoke.js';
import type { IfoodMcpCartResult } from './index.js';

function assertCartIdOutputAllowed(name: string, allowCartMutations: boolean, printCartId: boolean): void {
  if (printCartId && (name !== 'createCart' || !allowCartMutations)) {
    throw new Error('--print-cart-id exige createCart com --allow-cart-mutations.');
  }
}

interface CartCheckFlags {
  name: string;
  allowCartMutations: boolean;
  printCartId: boolean;
  inspectResult: boolean;
  cartIdPath?: string;
  verifySingleItem?: string;
}

function validateOutputOptions(flags: CartCheckFlags): CartIdLocation | undefined {
  assertCartIdOutputAllowed(flags.name, flags.allowCartMutations, flags.printCartId);
  if (flags.inspectResult && (flags.name !== 'getCart' || flags.allowCartMutations)) {
    throw new Error('--inspect-result exige getCart em modo somente leitura.');
  }
  if (flags.verifySingleItem !== undefined) {
    if (flags.name !== 'getCart' || flags.allowCartMutations || flags.inspectResult) throw new Error('--verify-single-item exige getCart somente leitura, sem inspeção.');
    try { validateCartId(flags.verifySingleItem); } catch { throw new Error('itemId esperado inválido.'); }
  }
  if (flags.cartIdPath !== undefined) {
    if (!flags.printCartId) throw new Error('--cart-id-path exige --print-cart-id.');
    return parseCartIdPath(flags.cartIdPath);
  }
  return undefined;
}

/** Parser local: nenhuma opção ou argumento pode abrir rede ou habilitar outro nome. */
export function parseCartCheckArgs(argv: string[]): CartCheckFlags {
  const name = argv[0];
  if (!name) throw new Error('Uso inválido.');
  const flags: CartCheckFlags = { name, allowCartMutations: false, printCartId: false, inspectResult: false };
  const seen = new Set<string>();
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!;
    if (seen.has(flag)) throw new Error('Opção duplicada.');
    seen.add(flag);
    if (flag === '--allow-cart-mutations') flags.allowCartMutations = true;
    else if (flag === '--print-cart-id') flags.printCartId = true;
    else if (flag === '--inspect-result') flags.inspectResult = true;
    else if (flag === '--cart-id-path' || flag === '--verify-single-item') {
      const path = argv[++index];
      if (path === undefined) throw new Error('Caminho não fornecido.');
      if (flag === '--cart-id-path') flags.cartIdPath = path;
      else flags.verifySingleItem = path;
    } else throw new Error('Uso inválido.');
  }
  assertApprovedCartTool(name, flags.allowCartMutations);
  validateOutputOptions(flags);
  return flags;
}

/** Teste manual opt-in; escrita desabilitada por padrão, dados pessoais omitidos. */
export async function runCartCheck(options: {
  name: string;
  args: Record<string, unknown>;
  allowCartMutations?: boolean;
  printCartId?: boolean;
  inspectResult?: boolean;
  cartIdPath?: string;
  verifySingleItem?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  error?: (message: string) => void;
  signal?: AbortSignal;
  createClient?: (config: IfoodMcpConfig, options?: IfoodMcpClientOptions) => Pick<IfoodMcpClient, 'connect' | 'callCartTool' | 'close'>;
}): Promise<number> {
  const log = options.log ?? console.info;
  const error = options.error ?? console.error;
  const allowCartMutations = options.allowCartMutations === true;
  const printCartId = options.printCartId === true;
  const inspectResult = options.inspectResult === true;
  const name = options.name;
  const verifySingleItem = options.verifySingleItem;
  let cartIdLocation: CartIdLocation | undefined;
  let config: IfoodMcpConfig;
  let args: Record<string, unknown>;
  try {
    assertApprovedCartTool(name, allowCartMutations);
    cartIdLocation = validateOutputOptions({ name, allowCartMutations, printCartId, inspectResult,
      ...(options.cartIdPath !== undefined ? { cartIdPath: options.cartIdPath } : {}),
      ...(verifySingleItem !== undefined ? { verifySingleItem } : {}),
    });
    args = snapshotToolArguments(options.args, 'cart');
    if (verifySingleItem !== undefined) validateCartId(args.cartId);
    config = readIfoodMcpConfig(options.env ?? process.env);
  } catch (failure) {
    error(failure instanceof Error ? failure.message : 'Configuração de carrinho inválida.');
    return 1;
  }
  const client = (options.createClient ?? createIfoodMcpClient)(config, {
    allowCartMutations,
    onDiagnostic: (event) => log(`[ifood] ${JSON.stringify(event)}`),
  });
  const cancel = () => { void client.close().catch(() => {}); };
  const printInspection = (result: IfoodMcpCartResult): boolean => {
    const inspection = inspectCartResult(result);
    log('Inspeção de estrutura: somente origem, caminhos e tipos; [] indica elemento de array. Chaves fora do vocabulário técnico são ocultas como <property>.');
    for (const field of inspection.fields) log(JSON.stringify(field));
    if (inspection.truncated) log('Inspeção limitada: máximo 200 campos, profundidade 8 e amostra de 10 elementos por array.');
    if (!inspection.hasJson) error('Formato não reconhecido como JSON. Nenhum valor foi exibido.');
    return inspection.hasJson;
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  let status = 0;
  try {
    if (options.signal?.aborted) throw new Error('Cancelado.');
    log(allowCartMutations ? 'Mutações habilitadas explicitamente para esta execução.' : 'Modo somente leitura; mutações desabilitadas.');
    log('Conectando para teste de carrinho. Autorize o usuário de teste no navegador, se solicitado.');
    await client.connect();
    if (options.signal?.aborted) throw new Error('Cancelado.');
    const result = await client.callCartTool(name, args);
    if (options.signal?.aborted) {
      error('Operação cancelada; o estado remoto pode ter mudado. Consulte o carrinho antes de repetir.');
      status = 1;
    } else if (result.isError) {
      error('A ferramenta retornou isError. Resposta omitida para preservar dados pessoais.');
      status = 1;
    } else if (printCartId) {
      try { log(`cartId: ${extractCartId(result, cartIdLocation)}`); }
      catch {
        error('cartId não confirmado no caminho explícito. O carrinho pode ter sido criado; não repita createCart automaticamente.');
        printInspection(result);
        status = 1;
      }
    } else if (verifySingleItem !== undefined) {
      if (verifySingleCartItem(result, args.cartId as string, verifySingleItem)) {
        log('Verificação aprovada: carrinho consultado corresponde ao solicitado, contém exatamente o produto esperado e quantidade 1. Valores e dados pessoais omitidos.');
      } else {
        error('Verificação falhou: identidade, produto, quantidade ou formato divergente. Resposta omitida; nenhuma mutação executada.');
        status = 1;
      }
    } else if (inspectResult) {
      if (!printInspection(result)) status = 1;
    } else log('Operação de carrinho concluída. Resposta omitida para preservar dados pessoais.');
  } catch (failure) {
    error(failure instanceof IfoodMcpDiagnosticError ? failure.message : 'Operação não concluída; dados da falha foram omitidos.');
    status = 1;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    try { await client.close(); log('Conexão encerrada.'); } catch {
      error('Recursos locais encerrados; encerramento remoto não confirmado.');
      status = 1;
    }
  }
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const cancel = () => { abort.abort(); process.stdin.destroy(); };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  void (async () => {
    const flags = parseCartCheckArgs(process.argv.slice(2));
    // Bloqueia antes de ler stdin, ambiente, abrir OAuth ou acessar a rede.
    assertApprovedCartTool(flags.name, flags.allowCartMutations);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > 1_048_576) throw new Error('Entrada excede limite.');
      chunks.push(buffer);
    }
    const input = Buffer.concat(chunks).toString('utf8').trim();
    const args: unknown = input ? JSON.parse(input) : {};
    const snapshot = snapshotToolArguments(args as Record<string, unknown>, 'cart');
    loadEnv({ quiet: true });
    return runCartCheck({ ...flags, args: snapshot, signal: abort.signal });
  })().then((status) => { process.exitCode = status; }).catch((failure: unknown) => {
    console.error(failure instanceof IfoodMcpDiagnosticError ? failure.message
      : 'Use um nome de carrinho aprovado e um objeto JSON válido em stdin (máximo 1 MiB). --print-cart-id [--cart-id-path ORIGEM:/CAMINHO] só é aceito em createCart com --allow-cart-mutations. --inspect-result e --verify-single-item UUID exigem getCart sem mutações.');
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  });
}
