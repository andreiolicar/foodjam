import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseCartCheckArgs, runCartCheck } from '../../src/ifood/cart-cli.js';
import type { IfoodMcpClient, IfoodMcpClientOptions, IfoodMcpConfig } from '../../src/ifood/index.js';

const env = {
  IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret',
  IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback',
};
function double() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    callCartTool: vi.fn<IfoodMcpClient['callCartTool']>().mockResolvedValue({ content: [{ type: 'text', text: 'private-cart' }], structuredContent: { total: 5779 } }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('CLI opcional de carrinhos', () => {
  it.each([
    [['createCart', '--allow-cart-mutations', '--print-cart-id'], { name: 'createCart', allowCartMutations: true, printCartId: true, inspectResult: false }],
    [['createCart', '--print-cart-id', '--allow-cart-mutations'], { name: 'createCart', allowCartMutations: true, printCartId: true, inspectResult: false }],
    [['createCart', '--allow-cart-mutations'], { name: 'createCart', allowCartMutations: true, printCartId: false, inspectResult: false }],
    [['getCart'], { name: 'getCart', allowCartMutations: false, printCartId: false, inspectResult: false }],
    [['getCart', '--inspect-result'], { name: 'getCart', allowCartMutations: false, printCartId: false, inspectResult: true }],
    [['getCart', '--verify-single-item', '18409df3-1e16-4bf8-9be5-433882c049aa'], { name: 'getCart', allowCartMutations: false, printCartId: false, inspectResult: false, verifySingleItem: '18409df3-1e16-4bf8-9be5-433882c049aa' }],
    [['createCart', '--allow-cart-mutations', '--print-cart-id', '--cart-id-path', 'json:/cartId'], { name: 'createCart', allowCartMutations: true, printCartId: true, inspectResult: false, cartIdPath: 'json:/cartId' }],
    [['createCart', '--allow-cart-mutations', '--print-cart-id', '--cart-id-path', 'structuredContent:/cart/id'], { name: 'createCart', allowCartMutations: true, printCartId: true, inspectResult: false, cartIdPath: 'structuredContent:/cart/id' }],
  ] as const)('aceita opções locais explícitas: %j', (argv, expected) => {
    expect(parseCartCheckArgs([...argv])).toEqual(expected);
  });

  it.each([
    [], ['createCart', '--print-cart-id'], ['getCart', '--print-cart-id'],
    ['getCart', '--allow-cart-mutations', '--print-cart-id'],
    ['addItemToCart', '--allow-cart-mutations', '--print-cart-id'],
    ['createCart', '--allow-cart-mutations', '--print-cart-id', '--print-cart-id'],
    ['createCart', '--allow-cart-mutations', '--unknown'],
    ['submitOrder', '--allow-cart-mutations', '--print-cart-id'],
    ['getCart', '--inspect-result', '--allow-cart-mutations'],
    ['createCart', '--allow-cart-mutations', '--inspect-result'],
    ['getCart', '--cart-id-path', 'structuredContent:/id'],
    ['createCart', '--allow-cart-mutations', '--cart-id-path', 'structuredContent:/id'],
    ['createCart', '--allow-cart-mutations', '--print-cart-id', '--cart-id-path'],
    ['createCart', '--allow-cart-mutations', '--print-cart-id', '--cart-id-path', 'unknown:/id'],
    ['getCart', '--verify-single-item'],
    ['getCart', '--verify-single-item', 'private-invalid-id'],
    ['getCart', '--verify-single-item', '18409df3-1e16-4bf8-9be5-433882c049aa', '--allow-cart-mutations'],
    ['createCart', '--allow-cart-mutations', '--verify-single-item', '18409df3-1e16-4bf8-9be5-433882c049aa'],
  ].map((argv) => ({ argv })))('rejeita saída de ID fora da criação autorizada e opções inválidas: $argv', ({ argv }) => {
    expect(() => parseCartCheckArgs(argv)).toThrow();
  });

  it.each(['getCart', 'getCartDeliveryMethods', 'addItemToCart', 'submitOrder'])('printCartId programático não habilita nem amplia %s', async (name) => {
    const createClient = vi.fn(() => double());
    expect(await runCartCheck({ name, args: {}, allowCartMutations: true, printCartId: true, env, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('printCartId programático exige criação explicitamente habilitada', async () => {
    const createClient = vi.fn(() => double());
    expect(await runCartCheck({ name: 'createCart', args: {}, printCartId: true, env, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(['getCartDeliveryMethods', 'createCart', 'submitOrder'])('inspeção é restrita a getCart sem habilitação de mutações: %s', async (name) => {
    const createClient = vi.fn(() => double());
    expect(await runCartCheck({ name, args: {}, inspectResult: true, allowCartMutations: true, env, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('inspeciona getCart sem exibir valores nem habilitar escrita', async () => {
    const client = double();
    client.callCartTool.mockResolvedValue({ content: [], structuredContent: { cart: { items: [{ itemId: 'private-product', quantity: 1 }], address: { streetName: 'private-street' } } } });
    const createClient = vi.fn<(config: IfoodMcpConfig, options?: IfoodMcpClientOptions) => typeof client>(() => client);
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'getCart', args: { cartId: 'private-id' }, inspectResult: true, env, createClient, log, error })).toBe(0);
    expect(createClient.mock.calls[0]?.[1]).toMatchObject({ allowCartMutations: false });
    expect(client.callCartTool).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain('/cart/items/[]/itemId');
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-');
    expect(client.close).toHaveBeenCalledOnce();
  });

  it.each([1, 2])('verifica quantidade %s em modo leitura com saída sanitizada', async (quantity) => {
    const client = double();
    client.callCartTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({
      cartId: 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9',
      items: [{ itemId: '18409df3-1e16-4bf8-9be5-433882c049aa', quantity, unitPrice: 3590 }], address: 'private-address',
    }) }] });
    const createClient = vi.fn<(config: IfoodMcpConfig, options?: IfoodMcpClientOptions) => typeof client>(() => client);
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'getCart', args: { cartId: 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9' }, verifySingleItem: '18409df3-1e16-4bf8-9be5-433882c049aa', env, createClient, log, error })).toBe(quantity === 1 ? 0 : 1);
    expect(createClient.mock.calls[0]?.[1]).toMatchObject({ allowCartMutations: false });
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/private-|a2f61c8d|18409df3|3590/);
    expect(client.callCartTool).toHaveBeenCalledOnce();
  });

  it.each([
    [{ content: [], structuredContent: { data: { id: 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9' }, address: 'private-address' } }, 'structuredContent:/data/id'],
    [{ content: [{ type: 'text', text: '{"cart":{"id":"a2f61c8d-759c-44a1-bb2e-d6c507d968a9","address":"private-address"}}' }] }, 'content[0].text:/cart/id'],
  ])('imprime apenas cartId com fonte/caminho explícitos e nunca o restante da resposta', async (result, path) => {
    const client = double();
    client.callCartTool.mockResolvedValue(result);
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'createCart', args: {}, allowCartMutations: true, printCartId: true, cartIdPath: path, env, createClient: () => client, log, error })).toBe(0);
    expect(log).toHaveBeenCalledWith('cartId: a2f61c8d-759c-44a1-bb2e-d6c507d968a9');
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/private-|structuredContent|content\[0\]/);
    expect(client.callCartTool).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'structuredContent:/cartId'])('formato desconhecido/ID inválido só mostra estrutura e não repete criação', async (path) => {
    const client = double();
    client.callCartTool.mockResolvedValue({ content: [], structuredContent: { cart: { id: 'private-invalid' }, merchantId: 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9', address: 'private-address' } });
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'createCart', args: {}, allowCartMutations: true, printCartId: true, ...(path ? { cartIdPath: path } : {}), env, createClient: () => client, log, error })).toBe(1);
    expect(JSON.stringify(log.mock.calls)).toContain('/cart/id');
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/private-|a2f61c8d/);
    expect(client.callCartTool).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('sem printCartId continua omitindo o UUID e a estrutura completa', async () => {
    const client = double();
    client.callCartTool.mockResolvedValue({ content: [], structuredContent: { cartId: 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9' } });
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'createCart', args: {}, allowCartMutations: true, env, createClient: () => client, log, error })).toBe(0);
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/a2f61c8d|structuredContent/);
  });

  it('isError não imprime ID nem inspeciona payload de erro', async () => {
    const client = double();
    client.callCartTool.mockResolvedValue({ content: [], isError: true, structuredContent: { cartId: 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9', items: [] } });
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'createCart', args: {}, allowCartMutations: true, printCartId: true, cartIdPath: 'structuredContent:/cartId', env, createClient: () => client, log, error })).toBe(1);
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/a2f61c8d|structuredContent|\/items/);
  });

  it('cancelamento impede a saída do cartId mesmo se chegar um UUID válido', async () => {
    const client = double();
    const abort = new AbortController();
    client.callCartTool.mockImplementationOnce(async () => {
      abort.abort();
      return { content: [], structuredContent: { cartId: 'a2f61c8d-759c-44a1-bb2e-d6c507d968a9' } };
    });
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'createCart', args: {}, allowCartMutations: true, printCartId: true, cartIdPath: 'structuredContent:/cartId', env, signal: abort.signal, createClient: () => client, log, error })).toBe(1);
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/a2f61c8d|structuredContent/);
    expect(client.callCartTool).toHaveBeenCalledOnce();
  });

  it('caminho de outro identificador é rejeitado antes de conectar ou criar', async () => {
    const createClient = vi.fn(() => double());
    expect(await runCartCheck({ name: 'createCart', args: {}, allowCartMutations: true, printCartId: true, cartIdPath: 'structuredContent:/address/id', env, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('consulta em modo somente leitura e omite argumentos, resposta e dados financeiros', async () => {
    const client = double();
    const log = vi.fn();
    const error = vi.fn();
    const createClient = vi.fn<(config: IfoodMcpConfig, options?: IfoodMcpClientOptions) => typeof client>(() => client);
    expect(await runCartCheck({ name: 'getCart', args: { cartId: 'private-cart-id' }, env, log, error, createClient })).toBe(0);
    expect(createClient.mock.calls[0]?.[1]).toMatchObject({ allowCartMutations: false });
    expect(client.callCartTool).toHaveBeenCalledWith('getCart', { cartId: 'private-cart-id' });
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/private-|5779/);
  });

  it.each(['createCart', 'addItemToCart', 'updateCartItem', 'removeItemFromCart', 'setCartDelivery'])(
    'bloqueia %s por padrão antes de credenciais e conexão', async (name) => {
      const createClient = vi.fn(() => double());
      expect(await runCartCheck({ name, args: { allowCartMutations: true }, env: {}, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it('permite uma mutação com opt-in explícito e encaminha a decisão ao cliente', async () => {
    const client = double();
    const createClient = vi.fn<(config: IfoodMcpConfig, options?: IfoodMcpClientOptions) => typeof client>(() => client);
    expect(await runCartCheck({ name: 'createCart', args: { fixture: 'private-argument' }, allowCartMutations: true, env, createClient, log: vi.fn(), error: vi.fn() })).toBe(0);
    expect(createClient.mock.calls[0]?.[1]).toMatchObject({ allowCartMutations: true });
    expect(client.callCartTool).toHaveBeenCalledWith('createCart', { fixture: 'private-argument' });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it.each(['submitOrder', 'setCartPayment', 'listPaymentMethods', 'setVoucher', 'removeVoucher', 'createAddress'])(
    'opt-in não autoriza %s', async (name) => {
      const createClient = vi.fn(() => double());
      expect(await runCartCheck({ name, args: {}, allowCartMutations: true, env: {}, createClient, log: vi.fn(), error: vi.fn() })).toBe(1);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it('isError produz saída de falha e cleanup sem expor conteúdo', async () => {
    const client = double();
    client.callCartTool.mockResolvedValue({ content: [{ type: 'text', text: 'private-failure' }], isError: true });
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'getCart', args: {}, env, createClient: () => client, log, error })).toBe(1);
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-');
  });

  it.each(['connect', 'callCartTool', 'close'] as const)('sanitiza falha em %s e sempre encerra recursos', async (operation) => {
    const client = double();
    client[operation].mockRejectedValue(new Error('private-failure'));
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'getCart', args: {}, env, createClient: () => client, log, error })).toBe(1);
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain('private-');
  });

  it('cancelamento prévio não conecta nem executa', async () => {
    const client = double();
    expect(await runCartCheck({ name: 'getCart', args: {}, env, signal: AbortSignal.abort(), createClient: () => client, log: vi.fn(), error: vi.fn() })).toBe(1);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.callCartTool).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('cancelamento durante conexão não encaminha a operação após conectar', async () => {
    const client = double();
    let connected!: () => void;
    client.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { connected = resolve; }));
    const abort = new AbortController();
    const status = runCartCheck({ name: 'getCart', args: {}, env, signal: abort.signal, createClient: () => client, log: vi.fn(), error: vi.fn() });
    abort.abort();
    connected();
    expect(await status).toBe(1);
    expect(client.callCartTool).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });

  it('cancelamento durante a chamada retorna falha mesmo quando chega uma resposta válida', async () => {
    const client = double();
    const abort = new AbortController();
    client.callCartTool.mockImplementationOnce(async () => {
      abort.abort();
      return { content: [] };
    });
    const log = vi.fn();
    const error = vi.fn();
    expect(await runCartCheck({ name: 'createCart', args: {}, allowCartMutations: true, env, signal: abort.signal, createClient: () => client, log, error })).toBe(1);
    expect(log.mock.calls.flat().join()).not.toContain('Operação de carrinho concluída');
    expect(error.mock.calls.flat().join()).toContain('estado remoto');
    expect(client.callCartTool).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalled();
  });

  it.each([
    [['createCart'], '{}', 'cart_mutations_disabled'],
    [['submitOrder', '--allow-cart-mutations'], '{}', 'cart_tool_not_allowed'],
    [['getCart'], '{private-input', 'JSON'],
    [['getCart', '--unknown'], '{}', 'JSON'],
    [['getCart', '--print-cart-id'], '{}', 'JSON'],
    [['getCart', '--inspect-result', '--allow-cart-mutations'], '{}', 'JSON'],
    [['createCart', '--allow-cart-mutations', '--print-cart-id', '--cart-id-path', 'structuredContent:/address/id'], '{}', 'JSON'],
  ])('comando rejeita escrita desabilitada, ferramenta proibida ou entrada inválida sem conectar', (argv, input, expected) => {
    const cwd = mkdtempSync(join(tmpdir(), 'foodjam-cart-'));
    try {
      let failure: unknown;
      try {
        execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../src/ifood/cart-cli.ts', import.meta.url)), ...argv], {
          cwd, env: {}, input, encoding: 'utf8', timeout: 10_000, stdio: 'pipe',
        });
      } catch (error) { failure = error; }
      expect(failure).toMatchObject({ status: 1 });
      const output = failure as { stdout: string; stderr: string };
      expect(output.stderr).toContain(expected);
      expect(output.stdout + output.stderr).not.toMatch(/private-input|Conectando/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
