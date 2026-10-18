import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { DevelopmentOAuthProvider, openSystemBrowser } from './auth.js';
import type { OpenBrowser } from './auth.js';
import { readIfoodMcpConfig } from './config.js';
import type { IfoodMcpConfig } from './config.js';
import { diagnosticError, reportDiagnostic } from './diagnostics.js';
import type { DiagnosticListener, IfoodMcpDiagnostic, IfoodMcpStage } from './diagnostics.js';
import { assertApprovedReadTool, findReadTool, snapshotReadArguments, validateReadResult, validateReadSchema } from './read-tools.js';
import type { IfoodMcpReadResult } from './read-tools.js';
import { assertApprovedCartTool, findCartTool } from './cart-tools.js';
import type { IfoodMcpCartResult } from './cart-tools.js';
import { assertApprovedPaymentOrderTool, findPaymentOrderTool } from './payment-order-tools.js';
import type { IfoodMcpPaymentOrderResult } from './payment-order-tools.js';
import { snapshotToolArguments, validateToolResult, validateToolSchema } from './tool-validation.js';

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
  callReadTool(name: string, args: Record<string, unknown>): Promise<IfoodMcpReadResult>;
  callCartTool(name: string, args: Record<string, unknown>): Promise<IfoodMcpCartResult>;
  callPaymentOrderTool(name: string, args: Record<string, unknown>): Promise<IfoodMcpPaymentOrderResult>;
  /** Terminal e idempotente. Cancele e crie outro cliente para autenticar novamente. */
  close(): Promise<void>;
}

export interface IfoodMcpClientOptions {
  openBrowser?: OpenBrowser;
  onDiagnostic?: DiagnosticListener;
  /** Decisão da aplicação confiável, nunca derivada de argumentos/saída do LLM. */
  allowCartMutations?: boolean;
  /** Habilitação independente para setCartPayment. Não permite submeter pedidos. */
  allowPaymentConfiguration?: boolean;
}

/** Criar/importar não abre rede, callback, navegador nem lê process.env. */
export function createIfoodMcpClient(
  config: IfoodMcpConfig,
  options: IfoodMcpClientOptions = {},
): IfoodMcpClient {
  // Valida também configuração fornecida diretamente, sem depender de process.env.
  const validated = readIfoodMcpConfig({
    IFOOD_MCP_ENDPOINT: config.endpoint, IFOOD_MCP_CLIENT_ID: config.clientId,
    IFOOD_MCP_CLIENT_SECRET: config.clientSecret, IFOOD_MCP_CALLBACK_URL: config.callbackUrl,
  });
  // Snapshot: alterações posteriores no objeto de opções não habilitam escrita.
  const allowCartMutations = options.allowCartMutations === true;
  const allowPaymentConfiguration = options.allowPaymentConfiguration === true;
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  let provider: DevelopmentOAuthProvider | undefined;
  let connected = false;
  let closed = false;
  let connection: Promise<IfoodMcpServer | undefined> | undefined;
  let closing: Promise<void> | undefined;
  let catalog: IfoodMcpTool[] | undefined;
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
    const createdClient = client;
    client.onclose = () => {
      if (client === createdClient) { connected = false; catalog = undefined; }
    };
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

  const api: IfoodMcpClient = {
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
      catalog = undefined;
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
        if (!connected || closed) throw new Error('Conexão encerrada durante discovery.');
        catalog = structuredClone(tools);
        succeed();
        return tools;
      } catch (error) {
        const failure = diagnosticError('tools_list', error, httpContext.get('tools_list'));
        reportDiagnostic(options.onDiagnostic, failure.diagnostic);
        throw failure;
      }
    },
    async callReadTool(name, args) {
      const current = client;
      try {
        if (!connected || closed || !current) throw diagnosticError('tools_read', undefined, { reason: 'read_client_disconnected' });
        if (!provider?.tokens()?.access_token) throw diagnosticError('tools_read', undefined, { reason: 'read_not_authenticated' });
        assertApprovedReadTool(name);
        const argumentsSnapshot = snapshotReadArguments(args);
        if (!catalog) await api.listTools();
        if (!connected || closed || client !== current) throw diagnosticError('tools_read', undefined, { reason: 'read_client_disconnected' });
        const tool = findReadTool(name, catalog ?? []);
        startStage('tools_read');
        validateReadSchema(tool.inputSchema, argumentsSnapshot, 'input');
        const result = validateReadResult(tool, await current.callTool({ name, arguments: argumentsSnapshot }));
        if (result.isError) reportDiagnostic(options.onDiagnostic, {
          stage: 'tools_read', event: 'failed', reason: 'read_tool_failed',
        });
        else reportDiagnostic(options.onDiagnostic, { stage: 'tools_read', event: 'succeeded' });
        return result;
      } catch (error) {
        const failure = diagnosticError('tools_read', error, httpContext.get('tools_read'));
        reportDiagnostic(options.onDiagnostic, failure.diagnostic);
        throw failure;
      }
    },
    async callCartTool(name, args) {
      const current = client;
      try {
        if (!connected || closed || !current) throw diagnosticError('tools_cart', undefined, { reason: 'cart_client_disconnected' });
        if (!provider?.tokens()?.access_token) throw diagnosticError('tools_cart', undefined, { reason: 'cart_not_authenticated' });
        assertApprovedCartTool(name, allowCartMutations);
        const argumentsSnapshot = snapshotToolArguments(args, 'cart');
        if (!catalog) await api.listTools();
        if (!connected || closed || client !== current) throw diagnosticError('tools_cart', undefined, { reason: 'cart_client_disconnected' });
        const tool = findCartTool(name, catalog ?? [], options.onDiagnostic);
        startStage('tools_cart');
        if (tool.execution && typeof tool.execution === 'object' && 'taskSupport' in tool.execution
          && tool.execution.taskSupport === 'required') {
          throw diagnosticError('tools_cart', undefined, { reason: 'cart_execution_unsupported' });
        }
        validateToolSchema(tool.inputSchema, argumentsSnapshot, 'input', 'cart');
        if (!connected || closed || client !== current) throw diagnosticError('tools_cart', undefined, { reason: 'cart_client_disconnected' });
        // SDK 1.32.1 callTool valida structuredContent até em isError=true.
        // request preserva esse envelope; a validação de sucesso usa o catálogo
        // completo abaixo, sem duplicar autenticação, transporte ou protocolo.
        const result = validateToolResult(tool, await current.request({
          method: 'tools/call', params: { name, arguments: argumentsSnapshot },
        }, CallToolResultSchema), 'cart');
        if (result.isError) reportDiagnostic(options.onDiagnostic, {
          stage: 'tools_cart', event: 'failed', reason: 'cart_tool_failed',
        });
        else reportDiagnostic(options.onDiagnostic, { stage: 'tools_cart', event: 'succeeded' });
        return result;
      } catch (error) {
        const failure = diagnosticError('tools_cart', error, httpContext.get('tools_cart'));
        reportDiagnostic(options.onDiagnostic, failure.diagnostic);
        throw failure;
      }
    },
    async callPaymentOrderTool(name, args) {
      const current = client;
      try {
        if (!connected || closed || !current) throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_client_disconnected' });
        if (!provider?.tokens()?.access_token) throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_not_authenticated' });
        assertApprovedPaymentOrderTool(name, allowPaymentConfiguration);
        const argumentsSnapshot = snapshotToolArguments(args, 'payment_order');
        if (!catalog) await api.listTools();
        if (!connected || closed || client !== current) throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_client_disconnected' });
        const tool = findPaymentOrderTool(name, catalog ?? [], options.onDiagnostic);
        startStage('tools_payment_order');
        if (tool.execution && typeof tool.execution === 'object' && 'taskSupport' in tool.execution
          && tool.execution.taskSupport === 'required') {
          throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_execution_unsupported' });
        }
        validateToolSchema(tool.inputSchema, argumentsSnapshot, 'input', 'payment_order');
        if (!connected || closed || client !== current) throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_client_disconnected' });
        // Mesma fronteira do SDK da IF-03: preserva isError sem aplicar schema de sucesso.
        const result = validateToolResult(tool, await current.request({
          method: 'tools/call', params: { name, arguments: argumentsSnapshot },
        }, CallToolResultSchema), 'payment_order');
        if (result.isError) reportDiagnostic(options.onDiagnostic, {
          stage: 'tools_payment_order', event: 'failed', reason: 'payment_order_tool_failed',
        });
        else reportDiagnostic(options.onDiagnostic, { stage: 'tools_payment_order', event: 'succeeded' });
        return result;
      } catch (error) {
        const failure = diagnosticError('tools_payment_order', error, httpContext.get('tools_payment_order'));
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
          catalog = undefined;
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
  return api;
}
