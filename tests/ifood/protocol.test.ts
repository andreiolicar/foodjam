import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIfoodMcpClient, readIfoodMcpConfig } from '../../src/ifood/index.js';
import type { IfoodMcpDiagnostic } from '../../src/ifood/index.js';

const endpoint = 'https://consumer-mcp.ifood.com.br/marketplace';
const resourceMetadata = 'https://consumer-mcp.ifood.com.br/.well-known/oauth-protected-resource/marketplace';
const nativeFetch = globalThis.fetch;

async function localCallbackUrl() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return `http://127.0.0.1:${address.port}/callback`;
}

function mockServer(options: {
  tokenFailure?: boolean; invalidTools?: boolean; alternateIssuer?: boolean;
  reconnectFailure?: boolean; malformedTokens?: boolean; requirePost?: boolean; clientFailure?: boolean;
  readCatalog?: boolean; readResult?: unknown;
} = {}) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const methods: string[] = [];
  let tokenRequest: URLSearchParams | undefined;
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === resourceMetadata) return Response.json({
      resource: endpoint,
      authorization_servers: [options.alternateIssuer ? 'https://unexpected.example.test' : 'https://id.ifood.com.br'],
    });
    if (url.endsWith('/.well-known/oauth-authorization-server')) return new Response(null, { status: 404 });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: 'https://id.ifood.com.br/3p',
      authorization_endpoint: 'https://id.ifood.com.br/authorize', token_endpoint: 'https://id.ifood.com.br/token',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'], jwks_uri: 'https://id.ifood.com.br/jwks',
      subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS512'],
    });
    if (url === 'https://id.ifood.com.br/token') {
      tokenRequest = new URLSearchParams(String(init?.body));
      if (options.requirePost && (new Headers(init?.headers).has('authorization')
        || tokenRequest.get('client_id') !== 'test-client' || tokenRequest.get('client_secret') !== 'test-secret')) {
        return Response.json({ error: 'invalid_client', error_description: 'fixture: POST required for this client' }, { status: 401 });
      }
      if (options.tokenFailure) return Response.json({ error: 'invalid_grant', error_description: 'private-token' }, { status: 400 });
      if (options.clientFailure) return Response.json({ error: 'invalid_client', error_description: 'private-token' }, { status: 401 });
      if (options.malformedTokens) return Response.json({ token_type: 'Bearer', private: 'private-token' });
      return Response.json({ access_token: 'test-access-token', token_type: 'Bearer', refresh_token: 'test-refresh-token' });
    }
    if (url !== endpoint) throw new Error('Unexpected request in offline test.');
    const headers = new Headers(init?.headers);
    if (!headers.get('authorization')) return Response.json({ error: 'invalid_token' }, {
      status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadata}"` },
    });
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (options.reconnectFailure) return Response.json({ error: 'private-token' }, { status: 403 });
    const message = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { cursor?: string } };
    methods.push(message.method);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (options.readCatalog && message.method === 'tools/list') {
      const result = message.params?.cursor ? { tools: [] } : {
        tools: [{
          name: 'getUser', inputSchema: { type: 'object', additionalProperties: false },
          outputSchema: { type: 'object', properties: { fixtureCount: { type: 'number' } }, required: ['fixtureCount'] },
        }], nextCursor: 'fixture-second-page',
      };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    }
    if (options.readCatalog && message.method === 'tools/call') {
      return Response.json({ jsonrpc: '2.0', id: message.id, result: options.readResult });
    }
    const result = message.method === 'initialize' ? {
      protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'offline-ifood', version: '1.0' },
    } : { tools: options.invalidTools ? [{ name: 'invalid' }] : [{
      name: 'offline_tool', description: 'Fixture, não descoberta real.', inputSchema: { type: 'object', properties: {} },
    }] };
    return Response.json({ jsonrpc: '2.0', id: message.id, result }, { headers: { 'mcp-session-id': 'offline-session' } });
  });
  return { requests, methods, fetchMock, get tokenRequest() { return tokenRequest; } };
}

afterEach(() => vi.restoreAllMocks());

describe('SDK v1 real com HTTP externo simulado', () => {
  it.each([
    [{ content: [{ type: 'text', text: 'private-profile' }], structuredContent: { fixtureCount: 2, extra: 'private-extra' } }, false],
    [{ content: [{ type: 'text', text: 'private-failure' }], isError: true }, false],
    [{ content: [], structuredContent: { fixtureCount: 'private-invalid-type' } }, true],
  ] as const)('executa tools/call real, preservando resultado ou rejeitando outputSchema incompatível', async (readResult, invalid) => {
    const callbackUrl = await localCallbackUrl();
    const remote = mockServer({ readCatalog: true, readResult });
    const diagnostics: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret', IFOOD_MCP_CALLBACK_URL: callbackUrl,
    }), {
      onDiagnostic: (event) => diagnostics.push(event),
      openBrowser: async (url) => { await nativeFetch(`${callbackUrl}?state=${url.searchParams.get('state')}&code=test-code`); },
    });
    try {
      await client.connect();
      if (invalid) await expect(client.callReadTool('getUser', {})).rejects.toMatchObject({ diagnostic: { stage: 'tools_read', reason: 'read_result_invalid' } });
      else await expect(client.callReadTool('getUser', {})).resolves.toEqual(readResult);
      const requestBodies = remote.requests.filter((request) => request.url === endpoint && request.init?.method === 'POST')
        .map((request) => JSON.parse(String(request.init?.body)) as { method: string; params?: unknown });
      expect(requestBodies.filter((body) => body.method === 'tools/call')).toEqual([
        expect.objectContaining({ method: 'tools/call', params: { name: 'getUser', arguments: {} } }),
      ]);
      expect(remote.methods).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'tools/call']);
      expect(JSON.stringify(diagnostics)).not.toContain('private-');
    } finally { await client.close(); }
  });

  it('executa OAuth com PKCE, valida callback, reconecta e faz apenas tools/list', async () => {
    const callbackUrl = await localCallbackUrl();
    const remote = mockServer({ requirePost: true });
    const diagnostics: IfoodMcpDiagnostic[] = [];
    let challenge: string | null = null;
    const openBrowser = vi.fn(async (url: URL) => {
      expect(url.origin).toBe('https://id.ifood.com.br');
      expect(url.searchParams.get('redirect_uri')).toBe(callbackUrl);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('resource')).toBe(endpoint);
      challenge = url.searchParams.get('code_challenge');
      const target = new URL(callbackUrl);
      target.searchParams.set('state', url.searchParams.get('state')!);
      target.searchParams.set('code', 'test-authorization-code');
      await nativeFetch(target);
    });
    const client = createIfoodMcpClient(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret', IFOOD_MCP_CALLBACK_URL: callbackUrl,
    }), { openBrowser, onDiagnostic: (event) => diagnostics.push(event) });
    try {
      await expect(client.connect()).resolves.toEqual({ name: 'offline-ifood', version: '1.0' });
      await expect(client.listTools()).resolves.toMatchObject([{ name: 'offline_tool', inputSchema: { type: 'object' } }]);
      expect(openBrowser).toHaveBeenCalledOnce();
      expect(remote.tokenRequest?.get('redirect_uri')).toBe(callbackUrl);
      expect(remote.tokenRequest?.get('code')).toBe('test-authorization-code');
      expect(remote.tokenRequest?.get('grant_type')).toBe('authorization_code');
      expect(createHash('sha256').update(remote.tokenRequest!.get('code_verifier')!).digest('base64url')).toBe(challenge);
      const tokenHeaders = new Headers(remote.requests.find((request) => request.url.endsWith('/token'))?.init?.headers);
      expect(tokenHeaders.has('authorization')).toBe(false);
      expect(tokenHeaders.get('content-type')).toBe('application/x-www-form-urlencoded');
      expect(remote.tokenRequest?.getAll('client_id')).toEqual(['test-client']);
      expect(remote.tokenRequest?.getAll('client_secret')).toEqual(['test-secret']);
      expect(remote.requests.filter((request) => request.url.endsWith('/token'))).toHaveLength(1);
      expect(diagnostics).toContainEqual(expect.objectContaining({
        stage: 'oauth_token_exchange', event: 'http_response', httpStatus: 200, clientAuthMethod: 'client_secret_post',
      }));
      expect(remote.methods).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
      for (const stage of ['oauth_callback', 'oauth_state_validation', 'oauth_token_exchange', 'oauth_tokens_storage', 'mcp_reconnect', 'tools_list']) {
        expect(diagnostics).toContainEqual(expect.objectContaining({ stage, event: 'succeeded' }));
      }
      expect(JSON.stringify(diagnostics)).not.toMatch(/test-access-token|test-refresh-token|test-authorization-code|test-secret/);
    } finally {
      await client.close();
    }
    expect(remote.requests.some((request) => request.init?.method === 'DELETE')).toBe(true);
    await expect(nativeFetch(callbackUrl)).rejects.toThrow();
  });

  it.each([
    ['tokenFailure', 'oauth_token_exchange', 'InvalidGrantError'],
    ['clientFailure', 'oauth_token_exchange', 'InvalidClientError'],
    ['malformedTokens', 'oauth_token_exchange', 'ZodError'],
    ['reconnectFailure', 'mcp_reconnect', 'StreamableHTTPError'],
    ['invalidTools', 'tools_list', '$ZodError'],
  ] as const)('identifica exatamente a falha %s após callback aceito', async (failure, stage, errorType) => {
    const callbackUrl = await localCallbackUrl();
    const remote = mockServer({ [failure]: true });
    const diagnostics: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret', IFOOD_MCP_CALLBACK_URL: callbackUrl,
    }), {
      onDiagnostic: (event) => diagnostics.push(event),
      openBrowser: async (url) => { await nativeFetch(`${callbackUrl}?state=${url.searchParams.get('state')}&code=test-code`); },
    });
    try {
      let caught: unknown;
      try { await client.connect(); await client.listTools(); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ diagnostic: { stage, event: 'failed', errorType } });
      expect(diagnostics).toContainEqual(expect.objectContaining({ stage: 'oauth_state_validation', event: 'succeeded' }));
      expect(diagnostics).toContainEqual(expect.objectContaining({ stage, event: 'failed', errorType }));
      if (failure === 'tokenFailure') {
        expect(caught).toMatchObject({ diagnostic: { httpStatus: 400, oauthError: 'invalid_grant' } });
        expect(diagnostics.some((event) => event.stage === 'oauth_tokens_storage')).toBe(false);
      }
      if (failure === 'clientFailure') {
        expect(caught).toMatchObject({ diagnostic: { httpStatus: 401, oauthError: 'invalid_client', clientAuthMethod: 'client_secret_post' } });
        const tokenRequests = remote.requests.filter((request) => request.url.endsWith('/token'));
        expect(tokenRequests.length).toBeGreaterThan(0);
        for (const request of tokenRequests) {
          expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
          expect(new URLSearchParams(String(request.init?.body)).get('client_secret')).toBe('test-secret');
        }
      }
      if (failure === 'reconnectFailure') {
        expect(caught).toMatchObject({ diagnostic: { httpStatus: 403 } });
        expect(diagnostics).toContainEqual(expect.objectContaining({ stage: 'oauth_tokens_storage', event: 'succeeded' }));
      }
      expect(JSON.stringify(diagnostics)).not.toMatch(/private-token|test-secret|test-code|test-access-token|test-refresh-token/);
      expect((caught as Error).cause).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it.each(['tokenFailure', 'invalidTools'] as const)('sanitiza %s sem reter causa sensível', async (failure) => {
    const callbackUrl = await localCallbackUrl();
    mockServer({ [failure]: true });
    const client = createIfoodMcpClient(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret', IFOOD_MCP_CALLBACK_URL: callbackUrl,
    }), { openBrowser: async (url) => {
      await nativeFetch(`${callbackUrl}?state=${url.searchParams.get('state')}&code=test-code`);
    } });
    try {
      let caught: unknown;
      try {
        await client.connect();
        await client.listTools();
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      expect(String(caught)).not.toMatch(/private-token|test-secret|test-code/);
      expect((caught as Error).cause).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it('recusa enviar credenciais a outro authorization server', async () => {
    const remote = mockServer({ alternateIssuer: true });
    const openBrowser = vi.fn();
    const client = createIfoodMcpClient(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret',
      IFOOD_MCP_CALLBACK_URL: await localCallbackUrl(),
    }), { openBrowser });
    try {
      await expect(client.connect()).rejects.toThrow('autenticação');
      expect(openBrowser).not.toHaveBeenCalled();
      expect(remote.tokenRequest).toBeUndefined();
      expect(remote.requests.every((request) => !String(request.init?.body).includes('test-secret'))).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('distingue state inválido de falha na troca de tokens e não envia código ao AS', async () => {
    const callbackUrl = await localCallbackUrl();
    const remote = mockServer();
    const diagnostics: IfoodMcpDiagnostic[] = [];
    const client = createIfoodMcpClient(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret', IFOOD_MCP_CALLBACK_URL: callbackUrl,
    }), {
      onDiagnostic: (event) => diagnostics.push(event),
      openBrowser: async () => { await nativeFetch(`${callbackUrl}?state=private-invalid-state&code=private-code`); },
    });
    try {
      await expect(client.connect()).rejects.toMatchObject({ diagnostic: { stage: 'oauth_state_validation', event: 'failed' } });
      expect(remote.tokenRequest).toBeUndefined();
      expect(diagnostics).toContainEqual(expect.objectContaining({ stage: 'oauth_state_validation', event: 'failed' }));
      expect(diagnostics.some((event) => event.stage === 'oauth_token_exchange')).toBe(false);
      expect(JSON.stringify(diagnostics)).not.toMatch(/private-invalid-state|private-code/);
    } finally {
      await client.close();
    }
  });

  it('close cancela uma autenticação pendente e libera a porta do callback', async () => {
    const callbackUrl = await localCallbackUrl();
    mockServer();
    let browserOpened: () => void;
    const browser = new Promise<void>((resolve) => { browserOpened = resolve; });
    const client = createIfoodMcpClient(readIfoodMcpConfig({
      IFOOD_MCP_CLIENT_ID: 'test-client', IFOOD_MCP_CLIENT_SECRET: 'test-secret', IFOOD_MCP_CALLBACK_URL: callbackUrl,
    }), { openBrowser: async () => { browserOpened(); } });
    const connecting = client.connect();
    const result = expect(connecting).rejects.toThrow('autenticação');
    await browser;
    await client.close();
    await result;
    await expect(nativeFetch(callbackUrl)).rejects.toThrow();
    await expect(client.connect()).rejects.toThrow('encerrado');
  });
});
