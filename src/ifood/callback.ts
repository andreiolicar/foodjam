import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { diagnosticError, reportDiagnostic } from './diagnostics.js';
import type { DiagnosticListener } from './diagnostics.js';

export interface OAuthCallback {
  readonly code: Promise<string>;
  close(): Promise<void>;
}

/** Listener efêmero: só aceita GET no caminho e host do callback cadastrado. */
export async function startOAuthCallback(
  callbackUrl: string,
  expectedState: string,
  options: { timeoutMs?: number; signal?: AbortSignal; onDiagnostic?: DiagnosticListener } = {},
): Promise<OAuthCallback> {
  const callback = new URL(callbackUrl);
  reportDiagnostic(options.onDiagnostic, { stage: 'oauth_callback', event: 'started' });
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // O retorno pode chegar antes de connect() começar a aguardar o código.
  void code.catch(() => {});
  let settled = false;
  const finish = (result: string | Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (result instanceof Error) rejectCode(result);
    else resolveCode(result);
    server.close();
    server.closeIdleConnections();
  };
  const abort = () => finish(diagnosticError('oauth_callback', undefined, { reason: 'callback_cancelled' }));
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let url: URL;
    try {
      url = new URL(request.url ?? '/', callback.origin);
    } catch {
      response.writeHead(400).end('Callback OAuth inválido.');
      return;
    }
    if (request.method !== 'GET' || url.pathname !== callback.pathname || request.headers.host !== callback.host) {
      response.writeHead(404).end('Não encontrado.');
      return;
    }
    const state = url.searchParams.get('state') ?? '';
    const actual = Buffer.from(state);
    const expected = Buffer.from(expectedState);
    const validState = url.searchParams.getAll('state').length === 1
      && actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!validState) {
      response.writeHead(400).end('Autorização OAuth recusada ou callback inválido.');
      finish(diagnosticError('oauth_state_validation', undefined, { reason: 'callback_invalid' }));
      return;
    }
    reportDiagnostic(options.onDiagnostic, { stage: 'oauth_state_validation', event: 'succeeded' });
    const authorizationCode = url.searchParams.get('code');
    if (settled || !validState || url.searchParams.has('error') || !authorizationCode
      || url.searchParams.getAll('code').length !== 1) {
      response.writeHead(400).end('Autorização OAuth recusada ou callback inválido.');
      finish(diagnosticError('oauth_callback', undefined, { reason: 'callback_invalid' }));
      return;
    }
    response.writeHead(200).end('Autorização recebida. Volte ao terminal do FoodJam.');
    reportDiagnostic(options.onDiagnostic, { stage: 'oauth_callback', event: 'succeeded' });
    finish(authorizationCode);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error) => reject(diagnosticError('oauth_callback', error, { reason: 'callback_port_unavailable' })));
    const host = callback.hostname === '[::1]' ? '::1' : '127.0.0.1';
    server.listen(Number(callback.port || '80'), host, () => resolve());
  });
  server.on('error', (error) => finish(diagnosticError('oauth_callback', error)));
  const timer = setTimeout(() => finish(diagnosticError('oauth_callback', undefined, { reason: 'callback_timeout' })), options.timeoutMs ?? 180_000);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  return {
    code,
    async close() {
      finish(new Error('OAuth cancelado.'));
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
