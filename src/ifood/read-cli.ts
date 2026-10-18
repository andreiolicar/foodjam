import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createIfoodMcpClient, readIfoodMcpConfig } from './index.js';
import type { IfoodMcpClient, IfoodMcpConfig } from './index.js';
import { IfoodMcpDiagnosticError } from './diagnostics.js';
import type { DiagnosticListener } from './diagnostics.js';
import { assertApprovedReadTool, snapshotReadArguments } from './read-tools.js';

/** Teste manual opt-in. Nenhuma resposta, argumento ou metadado pessoal é impresso. */
export async function runReadCheck(options: {
  name: string;
  args: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  error?: (message: string) => void;
  signal?: AbortSignal;
  createClient?: (config: IfoodMcpConfig, options?: { onDiagnostic?: DiagnosticListener }) => Pick<IfoodMcpClient, 'connect' | 'callReadTool' | 'close'>;
}): Promise<number> {
  const log = options.log ?? console.info;
  const error = options.error ?? console.error;
  let config: IfoodMcpConfig;
  let args: Record<string, unknown>;
  try {
    assertApprovedReadTool(options.name);
    args = snapshotReadArguments(options.args);
    config = readIfoodMcpConfig(options.env ?? process.env);
  } catch (failure) {
    // A validação local usa somente mensagens fixas, sem valores do ambiente.
    error(failure instanceof Error ? failure.message : 'Configuração de leitura inválida.');
    return 1;
  }
  const client = (options.createClient ?? createIfoodMcpClient)(config, {
    onDiagnostic: (event) => log(`[ifood] ${JSON.stringify(event)}`),
  });
  const cancel = () => { void client.close().catch(() => {}); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  let status = 0;
  try {
    if (options.signal?.aborted) throw new Error('Cancelado.');
    log('Conectando para teste de leitura. Autorize o usuário de teste no navegador, se solicitado.');
    await client.connect();
    const result = await client.callReadTool(options.name, args);
    if (result.isError) {
      error('A ferramenta retornou isError. Resposta omitida para preservar dados pessoais.');
      status = 1;
    } else log('Consulta de leitura concluída. Resposta omitida para preservar dados pessoais.');
  } catch (failure) {
    error(failure instanceof IfoodMcpDiagnosticError ? failure.message : 'Consulta não concluída; dados da falha foram omitidos.');
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
    assertApprovedReadTool(name);
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
    return runReadCheck({ name, args: snapshotReadArguments(args as Record<string, unknown>), signal: abort.signal });
  })().then((status) => { process.exitCode = status; }).catch((failure: unknown) => {
    console.error(failure instanceof IfoodMcpDiagnosticError ? failure.message
      : 'Use um nome de leitura aprovado e um objeto JSON válido em stdin (máximo 1 MiB).');
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  });
}
