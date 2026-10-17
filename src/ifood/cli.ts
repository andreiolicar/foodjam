import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createIfoodMcpClient, readIfoodMcpConfig } from './index.js';
import type { IfoodMcpClient, IfoodMcpConfig } from './index.js';
import { IfoodMcpDiagnosticError } from './diagnostics.js';
import type { DiagnosticListener } from './diagnostics.js';

/** Ponto de entrada testável; a CLI só é executada pelo guard ao fim do arquivo. */
export async function runDiscovery(options: {
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  error?: (message: string) => void;
  createClient?: (config: IfoodMcpConfig, options?: { onDiagnostic?: DiagnosticListener }) => IfoodMcpClient;
  signal?: AbortSignal;
} = {}): Promise<number> {
  const log = options.log ?? console.info;
  const error = options.error ?? console.error;
  let config: IfoodMcpConfig;
  try {
    config = readIfoodMcpConfig(options.env ?? process.env);
  } catch (failure) {
    // Somente mensagens produzidas pela validação local; nunca corpos HTTP/SDK.
    error(failure instanceof Error ? failure.message : 'Configuração MCP inválida.');
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
    log('Conectando ao MCP do iFood. Se solicitado, autorize o usuário de teste no navegador.');
    const server = await client.connect();
    log(`Conectado. Servidor: ${server ? JSON.stringify(server) : 'nome não disponibilizado'}.`);
    const tools = await client.listTools();
    log(`${tools.length} ferramenta(s) descoberta(s).`);
    for (const tool of tools) {
      log(`Nome: ${JSON.stringify(tool.name)}`);
      log(`Descrição: ${JSON.stringify(tool.description ?? 'não disponibilizada')}`);
      log(`Schema de entrada: ${JSON.stringify(tool.inputSchema, null, 2)}`);
    }
  } catch (failure) {
    error(failure instanceof IfoodMcpDiagnosticError ? failure.message
      : 'Descoberta não concluída. Falha sem diagnóstico seguro; nenhuma informação bruta foi exibida.');
    status = 1;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    try {
      await client.close();
      log('Conexão encerrada.');
    } catch (failure) {
      error(failure instanceof IfoodMcpDiagnosticError ? failure.message
        : 'Recursos locais encerrados; não foi possível confirmar encerramento da sessão remota.');
      status = 1;
    }
  }
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv({ quiet: true });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  void runDiscovery({ signal: abort.signal }).then((status) => {
    process.exitCode = status;
  }).catch(() => {
    console.error('Falha ao executar descoberta MCP. Verifique a configuração local.');
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  });
}
