import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DevelopmentOAuthProvider, openSystemBrowser } from './auth.js';
import type { OpenBrowser } from './auth.js';
import { readIfoodMcpConfig } from './config.js';
import type { IfoodMcpConfig } from './config.js';
import { diagnosticError, reportDiagnostic } from './diagnostics.js';
import type { DiagnosticListener, IfoodMcpDiagnostic, IfoodMcpStage } from './diagnostics.js';

/** Metadados preservados de tools/list; não representa permissão de execução. */
export interface IfoodMcpTool {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  [metadata: string]: unknown;
}

export interface IfoodMcpServer {
  name: string;
  version: string;
}

export interface IfoodMcpClient {
  connect(): Promise<IfoodMcpServer | undefined>;
  listTools(): Promise<IfoodMcpTool[]>;
  /** Terminal e idempotente. Cancele e crie outro cliente para autenticar novamente. */
  close(): Promise<void>;
}

/** Criar/importar não abre rede, callback, navegador nem lê process.env. */
export function createIfoodMcpClient(
  config: IfoodMcpConfig,
  options: { openBrowser?: OpenBrowser; onDiagnostic?: DiagnosticListener } = {},
): IfoodMcpClient {
  // Valida também configuração fornecida diretamente, sem depender de process.env.
  const validated = readIfoodMcpConfig({
    IFOOD_MCP_ENDPOINT: config.endpoint, IFOOD_MCP_CLIENT_ID: config.clientId,
    IFOOD_MCP_CLIENT_SECRET: config.clientSecret, IFOOD_MCP_CALLBACK_URL: config.callbackUrl,
  });
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  let provider: DevelopmentOAuthProvider | undefined;
  let connected = false;
  let closed = false;
  let connection: Promise<IfoodMcpServer | undefined> | undefined;
  let closing: Promise<void> | undefined;
  const abort = new AbortController();
  let stage: IfoodMcpStage = 'mcp_initial_connect';
  const httpContext = new Map<IfoodMcpStage, Pick<IfoodMcpDiagnostic, 'httpStatus' | 'requestKind' | 'method' | 'contentType' | 'clientAuthMethod'>>();
  const startStage = (next: IfoodMcpStage) => {
    stage = next;
    httpContext.delete(next);
    reportDiagnostic(options.onDiagnostic, { stage: next, event: 'started' });
  };
  const succeed = () => reportDiagnostic(options.onDiagnostic, { stage, event: 'succeeded' });

  const createConnection = () => {
    client = new Client({ name: 'FoodJam', version: '0.1.0' }, { capabilities: {} });
    transport = new StreamableHTTPClientTransport(new URL(validated.endpoint), {
      authProvider: provider!,
      // Limita também discovery, troca de código e encerramento, além do timeout MCP.
      fetch: async (url, init) => {
        const requestStage = stage;
        const requestUrl = new URL(url);
        const endpoint = new URL(validated.endpoint);
        const method = init?.method === 'POST' ? 'POST' : init?.method === 'DELETE' ? 'DELETE' : 'GET';
        const requestKind = requestUrl.origin === endpoint.origin && requestUrl.pathname === endpoint.pathname ? 'mcp'
          : method === 'POST' ? 'oauth_token' : 'oauth_metadata';
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]),
        });
        const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim();
        const contentType = mediaType === 'application/json' || mediaType === 'text/html' || mediaType === 'text/event-stream'
          ? mediaType : 'other';
        const clientAuthMethod: NonNullable<IfoodMcpDiagnostic['clientAuthMethod']> = new Headers(init?.headers).get('authorization')?.startsWith('Basic ') ? 'client_secret_basic'
          : init?.body instanceof URLSearchParams && init.body.has('client_secret') ? 'client_secret_post'
            : init?.body instanceof URLSearchParams && init.body.has('client_assertion') ? 'private_key_jwt' : 'none';
        const context = {
          httpStatus: response.status, requestKind, method, contentType,
          ...(requestKind === 'oauth_token' ? { clientAuthMethod } : {}),
        } as const;
        httpContext.set(requestStage, context);
        // Nenhuma URL, header, cookie ou corpo é incluído no evento.
        reportDiagnostic(options.onDiagnostic, { stage: requestStage, event: 'http_response', ...context });
        return response;
      },
    });
    return { client, transport };
  };

  async function establish(): Promise<IfoodMcpServer | undefined> {
    provider = new DevelopmentOAuthProvider(validated, options.openBrowser ?? openSystemBrowser, abort.signal, options.onDiagnostic);
    let current = createConnection();
    try {
      startStage('mcp_initial_connect');
      try {
        // SDK v1 declara Transport.sessionId? sem undefined, mas seu getter retorna
        // string | undefined. Ajuste local para exactOptionalPropertyTypes.
        await current.client.connect(current.transport as Transport);
        succeed();
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error;
        reportDiagnostic(options.onDiagnostic, { stage, event: 'authorization_required' });
        stage = 'oauth_callback';
        const code = await provider.waitForCode();
        startStage('oauth_token_exchange');
        await current.transport.finishAuth(code);
        succeed();
        if (!provider.tokens()) throw diagnosticError('oauth_tokens_storage', undefined, { reason: 'tokens_not_saved' });
        // O SDK fecha o transporte após initialize falhar. Reconectar exige instâncias novas.
        await current.client.close();
        startStage('mcp_reconnect');
        current = createConnection();
        await current.client.connect(current.transport as Transport);
        succeed();
      }
      connected = true;
      return current.client.getServerVersion();
    } catch (error) {
      const failure = diagnosticError(stage, error, httpContext.get(stage));
      reportDiagnostic(options.onDiagnostic, failure.diagnostic);
      await current.client.close().catch(() => {});
      await provider.dispose().catch(() => {});
      client = undefined;
      transport = undefined;
      // Mantém etapa e códigos seguros, descartando dados e exceção brutos.
      throw failure;
    }
  }

  return {
    connect() {
      if (closed) return Promise.reject(new Error('Cliente MCP encerrado. Crie uma nova instância.'));
      if (connected) return Promise.resolve(client?.getServerVersion());
      if (!connection) {
        connection = establish().finally(() => { connection = undefined; });
      }
      return connection;
    },
    async listTools() {
      if (!connected || closed || !client) throw new Error('Cliente MCP precisa estar conectado para listar ferramentas.');
      startStage('tools_list');
      try {
        const tools: IfoodMcpTool[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          tools.push(...page.tools);
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor)) throw new Error('Cursor repetido.');
          if (cursor) cursors.add(cursor);
        } while (cursor);
        succeed();
        return tools;
      } catch (error) {
        const failure = diagnosticError('tools_list', error, httpContext.get('tools_list'));
        reportDiagnostic(options.onDiagnostic, failure.diagnostic);
        throw failure;
      }
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        if (connection) {
          abort.abort();
          await connection.catch(() => {});
        }
        let failed = false;
        let failure: unknown;
        startStage('mcp_close');
        try {
          if (connected) await transport?.terminateSession();
        } catch (error) {
          failed = true;
          failure = error;
        } finally {
          try { await client?.close(); } catch (error) { failed = true; failure ??= error; }
          abort.abort();
          await provider?.dispose();
          connected = false;
          client = undefined;
          transport = undefined;
        }
        if (failed) {
          const error = diagnosticError('mcp_close', failure, httpContext.get('mcp_close'));
          reportDiagnostic(options.onDiagnostic, error.diagnostic);
          throw error;
        }
        succeed();
      })();
      return closing;
    },
  };
}
