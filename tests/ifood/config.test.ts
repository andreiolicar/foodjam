import { describe, expect, it } from 'vitest';
import { readIfoodMcpConfig } from '../../src/ifood/config.js';

const env = {
  IFOOD_MCP_CLIENT_ID: 'test-client',
  IFOOD_MCP_CLIENT_SECRET: 'test-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://localhost:19876/oauth/callback',
};

describe('configuração MCP', () => {
  it('lê credenciais e preserva o callback exato, sem escolher porta', () => {
    expect(readIfoodMcpConfig(env)).toMatchObject({
      endpoint: 'https://consumer-mcp.ifood.com.br/marketplace',
      clientId: env.IFOOD_MCP_CLIENT_ID,
      clientSecret: env.IFOOD_MCP_CLIENT_SECRET,
      callbackUrl: env.IFOOD_MCP_CALLBACK_URL,
    });
  });

  it('aceita endpoint HTTPS configurado', () => {
    expect(readIfoodMcpConfig({ ...env, IFOOD_MCP_ENDPOINT: 'https://mcp.example.test/service' }).endpoint)
      .toBe('https://mcp.example.test/service');
  });

  it.each(['IFOOD_MCP_CLIENT_ID', 'IFOOD_MCP_CLIENT_SECRET', 'IFOOD_MCP_CALLBACK_URL'])(
    'informa variável ausente: %s, sem valores sensíveis', (key) => {
      expect(() => readIfoodMcpConfig({ ...env, [key]: ' ' })).toThrow(key);
      try {
        readIfoodMcpConfig({ ...env, [key]: '' });
      } catch (error) {
        expect(String(error)).not.toContain(env.IFOOD_MCP_CLIENT_SECRET);
      }
    },
  );

  it.each([
    { IFOOD_MCP_ENDPOINT: 'http://example.test' },
    { IFOOD_MCP_ENDPOINT: 'https://user:password@example.test' },
    { IFOOD_MCP_ENDPOINT: 'invalid' },
    { IFOOD_MCP_ENDPOINT: 'https://example.test?token=secret' },
    { IFOOD_MCP_CALLBACK_URL: 'https://localhost:1234/callback' },
    { IFOOD_MCP_CALLBACK_URL: 'http://example.test:1234/callback' },
    { IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:0/callback' },
    { IFOOD_MCP_CALLBACK_URL: 'http://localhost:1234/callback?code=x' },
    { IFOOD_MCP_CALLBACK_URL: 'http://user:pass@localhost:1234/callback' },
  ])('rejeita configuração insegura ou incompatível: %j', (override) => {
    expect(() => readIfoodMcpConfig({ ...env, ...override })).toThrow();
  });
});
