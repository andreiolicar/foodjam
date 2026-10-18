import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buscarDescoberta } from '../../src/core/discovery-search.js';

it('SDK real em memória não recebe cancelamento de uma leitura já concluída', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let cancellations = 0; const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = async (message, options) => {
    if ('method' in message && message.method === 'notifications/cancelled') cancellations++;
    return send(message, options);
  };
  const server = new Server({ name: 'controlled', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'controlled' }] }));
  const client = new Client({ name: 'controlled', version: '1' });
  await server.connect(serverTransport); await client.connect(clientTransport);
  const store = { id: 's', name: 'Loja', isOpen: true };
  try {
    const result = await buscarDescoberta({
      listSavedAddresses: async () => [],
      searchStores: async (_query, _address, options) => {
        await client.callTool({ name: 'controlledRead', arguments: {} }, undefined, { signal: options!.signal! });
        return [store];
      },
      getStore: async () => store,
      getMenu: async () => ({ coverage: 'complete', items: [{ id: 'i', storeId: 's', name: 'Coxinha' }] }),
    }, [{ id: 'p', displayName: 'Pessoa', preferences: { wishes: ['coxinha'] } }], { formatted: 'Sintético' });
    expect(result.items).toHaveLength(1);
    expect(cancellations).toBe(0);
  } finally { await client.close(); await server.close(); }
});
