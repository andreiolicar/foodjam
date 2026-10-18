import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevelopmentOAuthProvider } from '../../src/ifood/auth.js';
import { readIfoodMcpConfig } from '../../src/ifood/config.js';
import { startOAuthCallback } from '../../src/ifood/callback.js';
import { selectClientAuthMethod, refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';

async function callbackUrl() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}/oauth/callback`;
}

afterEach(() => vi.restoreAllMocks());

describe('callback OAuth local', () => {
  it('entrega código somente depois de validar state e encerra listener', async () => {
    const url = await callbackUrl();
    const callback = await startOAuthCallback(url, 'expected-state', { timeoutMs: 1000 });
    try {
      expect((await fetch(`${url.replace('/oauth/callback', '/wrong')}?state=expected-state&code=x`)).status).toBe(404);
      const response = await fetch(`${url}?state=expected-state&code=authorization-code`);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain('authorization-code');
      await expect(callback.code).resolves.toBe('authorization-code');
    } finally {
      await callback.close();
    }
    await expect(fetch(url)).rejects.toThrow();
  });

  it.each([
    '?state=wrong&code=private', '?code=private',
    '?state=expected-state&state=expected-state&code=private',
    '?state=expected-state&code=one&code=two',
    '?state=expected-state&error=access_denied&error_description=private',
    '?state=expected-state',
  ])('rejeita callback inválido ou negado sem vazar dados: %s', async (query) => {
    const url = await callbackUrl();
    const callback = await startOAuthCallback(url, 'expected-state', { timeoutMs: 1000 });
    const result = expect(callback.code).rejects.toThrow(/OAuth/);
    try {
      const response = await fetch(url + query);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('private');
      await result;
    } finally {
      await callback.close();
    }
  });

  it('expira e permite liberar a porta', async () => {
    const url = await callbackUrl();
    const callback = await startOAuthCallback(url, 'state', { timeoutMs: 20 });
    await expect(callback.code).rejects.toThrow(/tempo/i);
    await callback.close();
    const replacement = await startOAuthCallback(url, 'state', { timeoutMs: 1000 });
    await replacement.close();
  });

  it('cancela o callback quando a conexão é encerrada', async () => {
    const abort = new AbortController();
    const callback = await startOAuthCallback(await callbackUrl(), 'state', { signal: abort.signal });
    const result = expect(callback.code).rejects.toThrow('cancelado');
    abort.abort();
    await result;
    await callback.close();
  });

  it('falha amigavelmente se a porta cadastrada está ocupada', async () => {
    const url = await callbackUrl();
    const callback = await startOAuthCallback(url, 'state');
    try {
      await expect(startOAuthCallback(url, 'other')).rejects.toThrow('porta');
    } finally {
      await callback.close();
    }
  });
});

describe('provedor OAuth de desenvolvimento', () => {
  it('informa POST no metadata e no client information usado pela seleção do SDK', async () => {
    const provider = new DevelopmentOAuthProvider(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'client', IFOOD_MCP_CLIENT_SECRET: 'secret',
      IFOOD_MCP_CALLBACK_URL: await callbackUrl(),
    }), vi.fn());
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe('client_secret_post');
    expect(provider.clientInformation()).toMatchObject({
      token_endpoint_auth_method: 'client_secret_post', issuer: 'https://id.ifood.com.br',
    });
    expect(selectClientAuthMethod(provider.clientInformation(), ['client_secret_basic', 'client_secret_post', 'private_key_jwt']))
      .toBe('client_secret_post');
    await provider.dispose();
  });

  it('usa também POST no refresh com o SDK real, sem Basic ou duplicação de credenciais', async () => {
    const provider = new DevelopmentOAuthProvider(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret&+=/ç',
      IFOOD_MCP_CALLBACK_URL: await callbackUrl(),
    }), vi.fn());
    const request = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body));
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(params.getAll('client_id')).toEqual(['fixture-client']);
      expect(params.getAll('client_secret')).toEqual(['fixture-secret&+=/ç']);
      expect(params.get('grant_type')).toBe('refresh_token');
      return Response.json({ access_token: 'fixture-token', token_type: 'Bearer' });
    });
    try {
      await refreshAuthorization('https://id.ifood.com.br', {
        metadata: {
          issuer: 'https://id.ifood.com.br/3p', authorization_endpoint: 'https://id.ifood.com.br/authorize',
          token_endpoint: 'https://id.ifood.com.br/token', response_types_supported: ['code'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        },
        clientInformation: provider.clientInformation(), refreshToken: 'fixture-refresh', fetchFn: request,
      });
      expect(request).toHaveBeenCalledOnce();
    } finally {
      await provider.dispose();
    }
  });

  it('mantém credenciais, tokens e PKCE apenas em memória e limpa ao encerrar', async () => {
    const provider = new DevelopmentOAuthProvider(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'client', IFOOD_MCP_CLIENT_SECRET: 'secret',
      IFOOD_MCP_CALLBACK_URL: await callbackUrl(),
    }), vi.fn());
    expect(provider.clientInformation()).toMatchObject({ client_id: 'client', client_secret: 'secret' });
    expect(provider.clientMetadata.grant_types).toEqual(['authorization_code', 'refresh_token']);
    const state = provider.state();
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(provider.state()).toBe(state);
    provider.saveCodeVerifier('pkce-verifier');
    expect(provider.codeVerifier()).toBe('pkce-verifier');
    const tokens = { access_token: 'private', token_type: 'Bearer', issuer: 'https://id.ifood.com.br' };
    provider.saveTokens(tokens);
    expect(provider.tokens()).toBe(tokens);
    await provider.dispose();
    expect(provider.tokens()).toBeUndefined();
    expect(() => provider.codeVerifier()).toThrow();
  });

  it('recebe retorno do navegador sem imprimir URL, código ou tokens', async () => {
    const url = await callbackUrl();
    const log = vi.spyOn(console, 'log');
    const provider = new DevelopmentOAuthProvider(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'client', IFOOD_MCP_CLIENT_SECRET: 'secret', IFOOD_MCP_CALLBACK_URL: url,
    }), async () => {
      await fetch(`${url}?state=${provider.state()}&code=test-code`);
    });
    try {
      await provider.redirectToAuthorization(new URL('https://id.ifood.com.br/authorize'));
      await expect(provider.waitForCode()).resolves.toBe('test-code');
      expect(log).not.toHaveBeenCalled();
    } finally {
      await provider.dispose();
    }
  });
});
