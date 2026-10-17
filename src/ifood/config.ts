/** Configuração de desenvolvimento para um único usuário do MCP. */
export interface IfoodMcpConfig {
  readonly endpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Valor exato cadastrado no portal; não normalizar antes do OAuth. */
  readonly callbackUrl: string;
}

/** Só lê o ambiente quando chamada explicitamente. Nunca inclui valores nos erros. */
export function readIfoodMcpConfig(env: NodeJS.ProcessEnv = process.env): IfoodMcpConfig {
  const required = (key: string): string => {
    const value = env[key];
    if (!value?.trim()) throw new Error(`Configure ${key} no ambiente local.`);
    return value;
  };
  const endpoint = env.IFOOD_MCP_ENDPOINT ?? 'https://consumer-mcp.ifood.com.br/marketplace';
  const clientId = required('IFOOD_MCP_CLIENT_ID');
  const clientSecret = required('IFOOD_MCP_CLIENT_SECRET');
  const callbackUrl = required('IFOOD_MCP_CALLBACK_URL');
  let remote: URL;
  let callback: URL;
  try {
    remote = new URL(endpoint);
    callback = new URL(callbackUrl);
  } catch {
    throw new Error('IFOOD_MCP_ENDPOINT e IFOOD_MCP_CALLBACK_URL devem ser URLs válidas.');
  }
  if (remote.protocol !== 'https:' || remote.username || remote.password || remote.search || remote.hash) {
    throw new Error('IFOOD_MCP_ENDPOINT deve usar HTTPS sem credenciais, query ou fragmento.');
  }
  if (callback.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname)
    || callback.username || callback.password || callback.search || callback.hash || callback.port === '0') {
    throw new Error('IFOOD_MCP_CALLBACK_URL deve ser HTTP em loopback, com porta fixa e sem credenciais, query ou fragmento. Use o callback exato cadastrado no portal.');
  }
  return Object.freeze({ endpoint, clientId, clientSecret, callbackUrl });
}
