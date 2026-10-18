import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { IfoodMcpConfig } from './config.js';
import { startOAuthCallback } from './callback.js';
import type { OAuthCallback } from './callback.js';
import { diagnosticError, reportDiagnostic } from './diagnostics.js';
import type { DiagnosticListener } from './diagnostics.js';

export type OpenBrowser = (url: URL) => Promise<void>;

/** Não usa shell nem imprime a URL OAuth, que contém state e challenge. */
export const openSystemBrowser: OpenBrowser = (url) => new Promise((resolve, reject) => {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href];
  execFile(command, args, { timeout: 10_000 }, (error) => {
    if (error) reject(new Error('Não foi possível abrir o navegador para OAuth. Verifique o navegador padrão e execute localmente.'));
    else resolve();
  });
});

/** Adaptador privado ao módulo. Tokens e verifier nunca são gravados em disco. */
export class DevelopmentOAuthProvider implements OAuthClientProvider {
  #tokens: OAuthTokens | undefined;
  #verifier: string | undefined;
  #state = randomBytes(32).toString('base64url');
  #callback: OAuthCallback | undefined;

  constructor(
    private readonly config: IfoodMcpConfig,
    private readonly openBrowser: OpenBrowser,
    private readonly signal?: AbortSignal,
    private readonly onDiagnostic?: DiagnosticListener,
  ) {}

  get redirectUrl() { return this.config.callbackUrl; }
  get clientMetadata() {
    return {
      client_name: 'FoodJam', redirect_uris: [this.config.callbackUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    };
  }
  clientInformation() {
    return {
      // O SDK seleciona o método do cliente pré-cadastrado por clientInformation,
      // não por clientMetadata. Preserve a preferência também neste objeto.
      ...this.clientMetadata,
      client_id: this.config.clientId, client_secret: this.config.clientSecret,
      // Binding do SDK v1: URL do AS anunciada pelo recurso, não o issuer OIDC /3p.
      issuer: 'https://id.ifood.com.br',
    };
  }
  state() { return this.#state; }
  tokens() { return this.#tokens; }
  saveTokens(tokens: OAuthTokens) {
    this.#tokens = tokens;
    reportDiagnostic(this.onDiagnostic, { stage: 'oauth_tokens_storage', event: 'succeeded' });
  }
  saveCodeVerifier(verifier: string) { this.#verifier = verifier; }
  codeVerifier() {
    if (!this.#verifier) throw diagnosticError('oauth_token_exchange', undefined, { reason: 'pkce_unavailable' });
    return this.#verifier;
  }
  async redirectToAuthorization(url: URL) {
    if (this.#callback) throw diagnosticError('oauth_browser', undefined, { reason: 'authorization_restart_required' });
    this.#callback = await startOAuthCallback(this.config.callbackUrl, this.#state, {
      ...(this.signal ? { signal: this.signal } : {}),
      ...(this.onDiagnostic ? { onDiagnostic: this.onDiagnostic } : {}),
    });
    reportDiagnostic(this.onDiagnostic, { stage: 'oauth_browser', event: 'started' });
    try {
      await this.openBrowser(url);
      reportDiagnostic(this.onDiagnostic, { stage: 'oauth_browser', event: 'succeeded' });
    } catch (error) {
      await this.#callback.close();
      throw diagnosticError('oauth_browser', error);
    }
  }
  async waitForCode() {
    if (!this.#callback) throw diagnosticError('oauth_callback', undefined, { reason: 'authorization_not_started' });
    try {
      return await this.#callback.code;
    } finally {
      await this.#callback.close();
    }
  }
  async dispose() {
    this.#tokens = undefined;
    this.#verifier = undefined;
    this.#state = '';
    await this.#callback?.close();
    this.#callback = undefined;
  }
}
