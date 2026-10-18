import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createPreparationAuthority, prepareCommercialProposal } from '../core/commercial-flow.js';
import type { CartPreparationService } from '../core/cart-controller.js';
import type { IfoodMcpClient, IfoodMcpTool } from './client.js';
import { catalogDocument } from './catalog-data.js';
import { createPrivateCartJournal } from './cart-journal.js';
import { createIfoodCommercialPreparation } from './commercial.js';
import { findCartTool } from './cart-tools.js';
import { createIfoodCheckoutInspection } from './checkout-inspection.js';

/** Composição opt-in. Só duas ferramentas de carrinho chegam ao cliente desta sessão. */
export async function createTelegramCartPreparation(client: IfoodMcpClient, tools: readonly IfoodMcpTool[], directory: string, moneyUnit?: 'BRL' | 'cents'): Promise<CartPreparationService> {
  const journal = await createPrivateCartJournal(directory);
  const authority = createPreparationAuthority();
  const restricted = {
    callReadTool: client.callReadTool.bind(client),
    callCartTool: (name: string, args: Record<string, unknown>) => {
      if (name !== 'createCart' && name !== 'getCart') throw new Error('Operação fora da preparação.');
      return client.callCartTool(name, args);
    },
  };
  const execute: (readOnly: boolean, ...args: Parameters<CartPreparationService['prepare']>) => ReturnType<CartPreparationService['prepare']> = async (readOnly, proposal, actor, current) => {
    for (const name of ['createCart', 'getCart'] as const) {
      const tool = findCartTool(name, tools);
      if (tool.execution && typeof tool.execution === 'object' && 'taskSupport' in tool.execution && tool.execution.taskSupport === 'required') throw new Error('Método comercial não homologado.');
    }
    if (!await current()) throw new Error('Proposta substituída.');
    const user = z.object({ success: z.literal(true), data: z.object({ email: z.string().min(1) }) }).parse(catalogDocument(await client.callReadTool('getUser', {})));
    const scope = createHash('sha256').update(user.data.email).digest('hex');
    const port = createIfoodCommercialPreparation(restricted, { authority, journal, authenticatedUserId: scope, tools, scopeBySession: true, isCurrent: current, ...(moneyUnit ? { moneyUnit } : {}) });
    return prepareCommercialProposal(proposal, actor, scope, authority, readOnly ? { prepare: context => port.readPrepared(context) } : port);
  };
  const read: CartPreparationService['read'] = (...args) => execute(true, ...args);
  return { prepare: (...args) => execute(false, ...args), read, checkout: createIfoodCheckoutInspection(client, tools, read) };
}
