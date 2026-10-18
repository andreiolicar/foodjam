import { describe, expect, it } from 'vitest';
import { InvalidGrantError, CustomOAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { diagnosticError, safeErrorDetails } from '../../src/ifood/diagnostics.js';

describe('diagnósticos seguros', () => {
  it('preserva apenas tipo e código OAuth conhecidos, sem mensagem, URL, stack ou cause', () => {
    const failure = new InvalidGrantError('authorization_code=private-code access_token=private-token client_secret=private-secret',
      'https://example.test?refresh_token=private-refresh');
    const safe = diagnosticError('oauth_token_exchange', failure);
    expect(safe.diagnostic).toMatchObject({
      stage: 'oauth_token_exchange', event: 'failed', errorType: 'InvalidGrantError', oauthError: 'invalid_grant',
    });
    expect(JSON.stringify(safe)).not.toContain('private-');
    expect(String(safe)).not.toContain('private-');
    expect(safe.cause).toBeUndefined();
  });

  it('não aceita nomes de erro ou códigos OAuth arbitrários', () => {
    const failure = new CustomOAuthError('private-secret', 'Cookie: private-cookie');
    failure.name = 'private-token';
    expect(JSON.stringify(safeErrorDetails(failure))).not.toContain('private-');
  });

  it('extrai status HTTP e código MCP sem reter corpos ou data', () => {
    expect(safeErrorDetails(new StreamableHTTPError(403, 'private-token'))).toMatchObject({ httpStatus: 403 });
    expect(safeErrorDetails(new McpError(-32602, 'private-code', { secret: 'private-secret' })))
      .toMatchObject({ errorType: 'McpError', mcpCode: -32602 });
  });

  it('extrai somente códigos de rede conhecidos da causa', () => {
    const failure = new TypeError('fetch failed private-secret', {
      cause: Object.assign(new Error('private-token'), { code: 'ECONNRESET' }),
    });
    expect(safeErrorDetails(failure)).toMatchObject({ errorType: 'TypeError', networkCode: 'ECONNRESET' });
    expect(JSON.stringify(safeErrorDetails(failure))).not.toContain('private-');
  });
});
