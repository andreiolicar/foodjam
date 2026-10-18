import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CommercialPreparationPort } from '../core/ports.js';
import type { CartObservation, PreparationAuthority, PreparationContext } from '../core/contracts.js';
import type { IfoodMcpClient } from './client.js';
import { catalogDocument, catalogItemIdentity, catalogMerchantIdentity, IfoodCatalogError } from './catalog-data.js';
import { catalogAddress, savedAddressLocation } from './catalog-address.js';
import { readCartObservation } from './cart-observation.js';

export interface CartJournal {
  get(key: string): Promise<{ cartId?: string } | undefined>;
  reserve(key: string): Promise<boolean>;
  saveCart(key: string, cartId: string): Promise<void>;
}

// Sem escolhas de adicionais no contrato desta fase. Zero só é seguro quando
// cada grupo declara explicitamente que nenhuma seleção é obrigatória.
const optionalGroups = z.array(z.object({ optionGroupId: z.string().min(1), minSelections: z.literal(0),
  maxSelections: z.number().int().nonnegative().safe(), options: z.array(z.object({ optionId: z.string().min(1) })) }))
  .refine(groups => new Set(groups.map(g => g.optionGroupId)).size === groups.length
    && groups.every(g => new Set(g.options.map(o => o.optionId)).size === g.options.length));

export function createIfoodCommercialPreparation(client: Pick<IfoodMcpClient, 'callReadTool' | 'callCartTool'>, options: {
  authority: PreparationAuthority; journal: CartJournal; authenticatedUserId: string; moneyUnit?: 'BRL' | 'cents';
}): CommercialPreparationPort & { readKnownCart(context: PreparationContext, cartId: string): Promise<CartObservation> } {
  const { authority, journal, authenticatedUserId, moneyUnit } = options;
  if (!authenticatedUserId || moneyUnit !== undefined && moneyUnit !== 'BRL' && moneyUnit !== 'cents') throw new IfoodCatalogError('invalid_config');
  const check = (context: PreparationContext) => {
    if (context.authenticatedUserId !== authenticatedUserId || !context.sessionId || !context.proposalId || !context.storeId
      || !context.items.length || new Set(context.items.map(i => i.menuItemId)).size !== context.items.length
      || context.items.some(i => !i.menuItemId || !Number.isSafeInteger(i.quantity) || i.quantity < 1)) throw new IfoodCatalogError('invalid_input');
    catalogAddress(context.address);
  };
  async function known(context: PreparationContext, cartId: string) {
    check(context);
    if (!cartId) throw new IfoodCatalogError('invalid_input');
    try { return readCartObservation(await client.callCartTool('getCart', { cartId }), context, cartId, moneyUnit); }
    catch (e) { if (e instanceof IfoodCatalogError) throw e; throw new IfoodCatalogError('read_failed'); }
  }
  return {
    async prepare(input, permit) {
      const context = structuredClone(input);
      authority.verify(permit, context); check(context);
      // Identidade do carrinho, não ordem/conteúdo mutável do payload. Mudança de
      // composição na mesma proposta não libera outra criação após timeout.
      const key = createHash('sha256').update(JSON.stringify({ authenticatedUserId: context.authenticatedUserId,
        sessionId: context.sessionId, proposalId: context.proposalId, storeId: context.storeId })).digest('hex');
      const previous = await journal.get(key);
      if (previous?.cartId) return known(context, previous.cartId);
      if (previous) throw new Error('Preparação pendente/ambígua; reconciliar antes de repetir.');
      // Todas as verificações anteriores à reserva são somente leitura.
      const address = catalogAddress(context.address);
      const userLocation = savedAddressLocation(catalogDocument(await client.callReadTool('listAddresses', {})), address);
      const merchant = catalogMerchantIdentity(catalogDocument(await client.callReadTool('getMerchant', { merchantId: context.storeId, userLocation })));
      if (merchant.merchantId !== context.storeId || !merchant.isOpen) throw new IfoodCatalogError('merchant_scope_mismatch');
      const explicitNoOptions = new Set<string>();
      for (const item of context.items) {
        const detail = catalogDocument(await client.callReadTool('getItem', { merchantId: context.storeId, itemId: item.menuItemId, userLocation }));
        if (catalogItemIdentity(detail, context.storeId).itemId !== item.menuItemId) throw new IfoodCatalogError('item_scope_mismatch');
        if (detail && typeof detail === 'object' && 'available' in detail && detail.available === false) throw new IfoodCatalogError('tool_failed');
        // Grupos opcionais minSelections=0 foram observados no preflight real.
        // Não adicionar opções nem calcular preços de adicionais não escolhidos.
        if (!detail || typeof detail !== 'object' || !('optionGroups' in detail) || !Array.isArray(detail.optionGroups)
          || !optionalGroups.safeParse(detail.optionGroups).success) throw new Error('Opções do produto exigem validação explícita.');
        if (detail.optionGroups.length) explicitNoOptions.add(item.menuItemId);
      }
      if (!await journal.reserve(key)) throw new Error('Preparação já reservada; consultar registro.');
      // Registro persistido ANTES do envio: timeout/crash nunca dispara outra criação.
      let cartId: string;
      try {
        const raw = catalogDocument(await client.callCartTool('createCart', { merchantId: context.storeId, addressId: context.address.id,
          items: context.items.map(i => ({ itemId: i.menuItemId, quantity: i.quantity,
            ...(explicitNoOptions.has(i.menuItemId) ? { options: [] } : {}) })) }));
        if (!raw || typeof raw !== 'object' || !('cartId' in raw) || typeof raw.cartId !== 'string' || !raw.cartId) throw new Error('ID não confirmado.');
        cartId = raw.cartId;
        await journal.saveCart(key, cartId);
      } catch { throw new Error('Criação não confirmada; não repetir. Reconciliar registro privado.'); }
      return known(context, cartId);
    },
    readKnownCart(input, cartId) { return known(structuredClone(input), cartId); },
  };
}
