import { describe, expect, it, vi } from 'vitest';
import { runSmokePreflight } from '../../src/ifood/smoke-preflight.js';
import type { IfoodMcpClientOptions, IfoodMcpConfig } from '../../src/ifood/index.js';

const merchantId = '5443791a-6f3a-481a-9a60-9fa6bbfc2dd4';
const itemId = '18409df3-1e16-4bf8-9be5-433882c049aa';
const addressId = '2831b708-f518-4e4e-955e-19c0d70f6214';
const coords = { latitude: -20, longitude: -40 }; // Fictícios, sem localização real.
const input = { addressId, merchantArgs: { merchantId, userLocation: coords }, itemArgs: { merchantId, itemId, userLocation: coords } };
const env = { IFOOD_MCP_CLIENT_ID: 'fixture-client', IFOOD_MCP_CLIENT_SECRET: 'fixture-secret', IFOOD_MCP_CALLBACK_URL: 'http://127.0.0.1:19876/callback' };
const result = (body: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });

function double(options: { foreignAddress?: boolean; changedLocation?: boolean; closedMerchant?: boolean; otherItem?: boolean; requiredOptions?: boolean; isError?: boolean } = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    callReadTool: vi.fn().mockImplementation(async (name: string) => {
      if (options.isError) return { content: [{ type: 'text', text: 'private-error' }], isError: true };
      if (name === 'listAddresses') return result({ results: [{ addressId: options.foreignAddress ? 'private-other-address' : addressId,
        coordinates: options.changedLocation ? { latitude: -10, longitude: -10 } : coords, formattedAddress: 'private-address' }] });
      if (name === 'getMerchant') return result({ merchantId, isOpen: !options.closedMerchant, address: 'private-address' });
      if (name === 'getItem') return result({ merchantId, itemId: options.otherItem ? 'private-other-item' : itemId, itemName: 'Tradicional One', optionGroups: [{ minSelections: options.requiredOptions ? 1 : 0 }], private: 'private-user' });
      throw new Error('Unexpected tool in smoke preflight.');
    }),
  };
}

describe('pré-verificação manual exclusivamente de leitura', () => {
  it('confirma conta/endereço/coordenadas, estabelecimento e item sem escrita nem saída pessoal', async () => {
    const client = double();
    const createClient = vi.fn<(config: IfoodMcpConfig, options?: IfoodMcpClientOptions) => typeof client>(() => client);
    const log = vi.fn();
    const error = vi.fn();
    expect(await runSmokePreflight({ input, env, createClient, log, error })).toBe(0);
    expect(createClient.mock.calls[0]?.[1]).toMatchObject({ allowCartMutations: false });
    expect(client.callReadTool.mock.calls.map((call) => call[0])).toEqual(['listAddresses', 'getMerchant', 'getItem']);
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/private-|2831b708|-20|-40/);
  });

  it.each(['foreignAddress', 'changedLocation', 'closedMerchant', 'otherItem', 'requiredOptions', 'isError'] as const)(
    'falha fechada para %s, sem mutações ou dados pessoais', async (failure) => {
      const client = double({ [failure]: true });
      const log = vi.fn();
      const error = vi.fn();
      expect(await runSmokePreflight({ input, env, createClient: () => client, log, error })).toBe(1);
      expect(client.close).toHaveBeenCalledOnce();
      expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toMatch(/private-|2831b708|-20|-40/);
    },
  );

  it('falha de rede não é repetida e sempre encerra', async () => {
    const client = double();
    client.callReadTool.mockRejectedValueOnce(new Error('private-network'));
    const error = vi.fn();
    expect(await runSmokePreflight({ input, env, createClient: () => client, log: vi.fn(), error })).toBe(1);
    expect(client.callReadTool).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-network');
  });
});
