import { z } from 'zod';
import type { CheckoutInspection, PreliminaryProposal } from '../core/contracts.js';
import type { CartPreparationService } from '../core/cart-controller.js';
import { PreliminaryProposalSchema } from '../core/schemas.js';
import type { IfoodMcpClient, IfoodMcpTool } from './client.js';
import { catalogDocument } from './catalog-data.js';
import { validateToolSchema } from './tool-validation.js';

// Perfil observado em listPaymentMethods. Campos de cartão são deliberadamente
// descartados; nem tokens nem IDs de pagamento saem desta camada de leitura.
const methodsSchema = z.object({ paymentMethods: z.array(z.object({
  paymentMethodId: z.uuid(), kind: z.string().min(1),
})) }).refine(d => new Set(d.paymentMethods.map(m => m.paymentMethodId)).size === d.paymentMethods.length);
const required = ['listPaymentMethods', 'setCartPayment', 'submitOrder', 'getOrder', 'trackOrder'];

/** Não configura pagamento, não submete nem interpreta um retorno desconhecido. */
export function createIfoodCheckoutInspection(
  client: Pick<IfoodMcpClient, 'callPaymentOrderTool'>,
  inputTools: readonly IfoodMcpTool[],
  read: CartPreparationService['read'],
) {
  const tools = structuredClone(inputTools);
  return async (input: PreliminaryProposal, actor: string, current: () => Promise<boolean>): Promise<CheckoutInspection> => {
    const proposal = PreliminaryProposalSchema.parse(input);
    const valid = async () => { if (!await current()) throw new Error('Proposta substituída.'); };
    if (actor !== proposal.organizerId) throw new Error('Somente o organizador.');
    await valid();
    const review = await read(proposal, actor, current);
    await valid();
    const blockers = ['submission_result_unconfirmed', 'pix_result_unconfirmed'];
    if (required.some(name => tools.filter(t => t.name === name).length !== 1)) blockers.push('missing_capability');
    if (review.status === 'blocked') blockers.push('commercial_pending');
    const stores: CheckoutInspection['stores'] = [];
    for (const storeId of new Set(proposal.items.map(i => i.storeId))) {
      await valid();
      const observed = review.observations.filter(o => o.storeId === storeId);
      if (observed.length !== 1 || !observed[0]!.cartId) {
        stores.push({ storeId, issues: ['cart_unconfirmed'] }); continue;
      }
      try {
        const matches = tools.filter(t => t.name === 'listPaymentMethods');
        if (matches.length !== 1) throw new Error('Método ausente/ambíguo.');
        const tool = matches[0]!;
        if (tool.execution && typeof tool.execution === 'object' && 'taskSupport' in tool.execution && tool.execution.taskSupport === 'required') throw new Error('Método não homologado.');
        const args = { merchantId: storeId };
        validateToolSchema(tool.inputSchema, args, 'input', 'payment_order');
        const result = methodsSchema.parse(catalogDocument(await client.callPaymentOrderTool('listPaymentMethods', args)));
        await valid();
        const pixAvailable = result.paymentMethods.some(m => m.kind === 'PIX');
        stores.push({ storeId, pixAvailable, issues: pixAvailable ? [] : ['pix_unavailable'] });
      } catch {
        await valid();
        stores.push({ storeId, issues: ['payment_methods_failed'] });
      }
    }
    await valid();
    return { status: 'blocked', review: structuredClone(review), stores, blockers };
  };
}
