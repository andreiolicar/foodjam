import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createIfoodMcpClient, readIfoodMcpConfig } from './index.js';
import type { IfoodMcpClient, IfoodMcpConfig } from './index.js';
import { IfoodMcpDiagnosticError } from './diagnostics.js';
import type { DiagnosticListener } from './diagnostics.js';
import { assertApprovedPaymentOrderReadTool } from './payment-order-tools.js';
import { snapshotToolArguments } from './tool-validation.js';

/** Validação real somente quando chamada explicitamente; nunca imprime payloads. */
export async function runPaymentOrderReadCheck(options: {
  name: string;
  args: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  error?: (message: string) => void;
  signal?: AbortSignal;
  createClient?: (config: IfoodMcpConfig, options?: { onDiagnostic?: DiagnosticListener }) => Pick<IfoodMcpClient, 'connect' | 'callPaymentOrderTool' | 'close'>;
}): Promise<number> {
  const log = options.log ?? console.info;
  const error = options.error ?? console.error;
  let client: Pick<IfoodMcpClient, 'connect' | 'callPaymentOrderTool' | 'close'>;
  let args: Record<string, unknown>;
  try {
    assertApprovedPaymentOrderReadTool(options.name);
    args = snapshotToolArguments(options.args, 'payment_order');
    const config = readIfoodMcpConfig(options.env ?? process.env);
    client = (options.createClient ?? createIfoodMcpClient)(config, {
      onDiagnostic: (event) => log(`[ifood] ${JSON.stringify(event)}`),
    });
  } catch (failure) {
    error(failure instanceof IfoodMcpDiagnosticError ? failure.message : 'Preparação de leitura não concluída; detalhes omitidos.');
    return 1;
  }
  const cancel = () => { void client.close().catch(() => {}); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  let status = 0;
  try {
    if (options.signal?.aborted) throw new Error('Cancelado.');
    log('Conectando para consulta de leitura. Autorize o usuário de teste no navegador, se solicitado.');
    await client.connect();
    const result = await client.callPaymentOrderTool(options.name, args);
    if (result.isError) {
      error('A ferramenta retornou isError. Resposta omitida para preservar dados sensíveis.');
      status = 1;
    } else log('Consulta de leitura concluída. Resposta omitida para preservar dados sensíveis.');
  } catch (failure) {
    error(failure instanceof IfoodMcpDiagnosticError ? failure.message : 'Consulta de leitura não concluída; detalhes omitidos.');
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
  loadEnv({ quiet: true });
  const abort = new AbortController();
  const cancel = () => { abort.abort(); process.stdin.destroy(); };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  void (async () => {
    if (process.argv.length !== 3) throw new Error('Uso inválido.');
    const name = process.argv[2]!;
    assertApprovedPaymentOrderReadTool(name);
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
    return runPaymentOrderReadCheck({ name, args: snapshotToolArguments(args as Record<string, unknown>, 'payment_order'), signal: abort.signal });
  })().then((status) => { process.exitCode = status; }).catch(() => {
    console.error('Use listPaymentMethods, getOrder ou trackOrder para leitura e um objeto JSON válido em stdin (máximo 1 MiB).');
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  });
}
