import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

export type IfoodMcpStage = 'mcp_initial_connect' | 'oauth_browser' | 'oauth_callback'
  | 'oauth_state_validation' | 'oauth_token_exchange' | 'oauth_tokens_storage'
  | 'mcp_reconnect' | 'tools_list' | 'mcp_close';

interface SafeErrorDetails {
  errorType?: string;
  httpStatus?: number;
  oauthError?: string;
  mcpCode?: number;
  networkCode?: string;
  requestKind?: 'mcp' | 'oauth_metadata' | 'oauth_token';
  method?: 'GET' | 'POST' | 'DELETE';
  contentType?: 'application/json' | 'text/event-stream' | 'text/html' | 'other';
  clientAuthMethod?: 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt' | 'none';
  reason?: 'callback_timeout' | 'callback_cancelled' | 'callback_port_unavailable'
    | 'callback_invalid' | 'authorization_not_started' | 'authorization_restart_required'
    | 'pkce_unavailable' | 'tokens_not_saved' | 'unsupported_protocol_version';
}

export interface IfoodMcpDiagnostic extends SafeErrorDetails {
  readonly stage: IfoodMcpStage;
  readonly event: 'started' | 'succeeded' | 'failed' | 'authorization_required' | 'http_response';
}
export type DiagnosticListener = (diagnostic: IfoodMcpDiagnostic) => void;

const oauthErrors = new Set([
  'invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
  'unsupported_grant_type', 'invalid_scope', 'access_denied', 'server_error',
  'temporarily_unavailable', 'unsupported_response_type', 'invalid_token',
  'insufficient_scope', 'invalid_target', 'invalid_client_metadata',
]);
const errorTypes = new Set([
  'Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'ZodError', '$ZodError',
  'UnauthorizedError', 'InvalidRequestError', 'InvalidClientError', 'InvalidGrantError',
  'UnauthorizedClientError', 'UnsupportedGrantTypeError', 'InvalidScopeError',
  'AccessDeniedError', 'ServerError', 'TemporarilyUnavailableError', 'InvalidTokenError',
  'InsufficientScopeError', 'InvalidTargetError', 'InvalidClientMetadataError',
]);
const networkCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const stageMessages: Record<IfoodMcpStage, string> = {
  mcp_initial_connect: 'Não foi possível conectar: falha de autenticação ou handshake MCP inicial.',
  oauth_browser: 'Falha de autenticação OAuth ao abrir o navegador.',
  oauth_callback: 'Falha de autenticação OAuth no callback.',
  oauth_state_validation: 'Falha de autenticação OAuth na validação de state.',
  oauth_token_exchange: 'Falha de autenticação OAuth na troca do código por tokens.',
  oauth_tokens_storage: 'Falha de autenticação OAuth ao armazenar tokens em memória.',
  mcp_reconnect: 'Não foi possível conectar ao MCP após autenticação OAuth.',
  tools_list: 'Não foi possível listar ferramentas MCP.',
  mcp_close: 'Não foi possível encerrar a sessão MCP; recursos locais liberados.',
};

/** Nomes/códigos vêm de listas fechadas. Nunca copiar message, stack, data ou URL. */
export function safeErrorDetails(error: unknown): SafeErrorDetails {
  if (error instanceof IfoodMcpDiagnosticError) return { ...error.diagnostic };
  const result: SafeErrorDetails = { errorType: 'UnknownError' };
  if (!(error instanceof Error)) return result;
  result.errorType = errorTypes.has(error.name) ? error.name : 'Error';
  if (error instanceof StreamableHTTPError) {
    result.errorType = 'StreamableHTTPError';
    if (Number.isInteger(error.code) && error.code! >= 100 && error.code! <= 599) result.httpStatus = error.code!;
  }
  if (error instanceof OAuthError && oauthErrors.has(error.errorCode)) result.oauthError = error.errorCode;
  if (error instanceof McpError) {
    result.errorType = 'McpError';
    if (Number.isSafeInteger(error.code)) result.mcpCode = error.code;
  }
  for (const candidate of [error, error.cause]) {
    if (candidate && typeof candidate === 'object' && 'code' in candidate
      && typeof candidate.code === 'string' && networkCodes.has(candidate.code)) result.networkCode = candidate.code;
  }
  if (error.message.startsWith('Server\'s protocol version is not supported:')) result.reason = 'unsupported_protocol_version';
  return result;
}

/** Contém somente o snapshot sanitizado. Não retém a exceção original em cause. */
export class IfoodMcpDiagnosticError extends Error {
  readonly diagnostic: IfoodMcpDiagnostic;
  constructor(stage: IfoodMcpStage, details: SafeErrorDetails) {
    const diagnostic: IfoodMcpDiagnostic = Object.freeze({ ...details, stage, event: 'failed' });
    const hint = details.reason === 'callback_cancelled' ? 'Fluxo cancelado. '
      : details.reason === 'callback_timeout' ? 'Tempo de autorização esgotado. '
        : details.reason === 'callback_port_unavailable' ? 'Verifique a porta local cadastrada. ' : '';
    super(`${stageMessages[stage]} ${hint}${JSON.stringify(diagnostic)}`);
    this.name = 'IfoodMcpDiagnosticError';
    this.diagnostic = diagnostic;
  }
}

export function diagnosticError(stage: IfoodMcpStage, error: unknown, context: SafeErrorDetails = {}) {
  if (error instanceof IfoodMcpDiagnosticError) return error;
  return new IfoodMcpDiagnosticError(stage, { ...context, ...safeErrorDetails(error) });
}

/** Uma falha do consumidor de diagnóstico não pode interromper OAuth/cleanup. */
export function reportDiagnostic(listener: DiagnosticListener | undefined, event: IfoodMcpDiagnostic) {
  try { listener?.(Object.freeze(event)); } catch { /* Não propagar erros de logging. */ }
}
