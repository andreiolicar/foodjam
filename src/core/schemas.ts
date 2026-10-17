import { z } from 'zod';

export const MAX_QUANTITY = 10;
export const MAX_STORES_PER_PROPOSAL = 2;
export const MAX_OPTIONS_PER_MODEL_PROPOSAL = 3;
export const MAX_JUSTIFICATION_LENGTH = 280;

/** No Zod 4, z.int() já exige inteiro seguro. */
export const MoneyCentsSchema = z.int().min(0);
const IdSchema = z.string().min(1);
const QuantitySchema = z.int().min(1).max(MAX_QUANTITY);
const JustificationSchema = z.string().trim().min(1).max(MAX_JUSTIFICATION_LENGTH);

const distinctStores = (items: readonly { storeId: string }[]) => new Set(items.map((i) => i.storeId)).size;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

// ---------------------------------------------------------------------------
// Schemas de domínio: espelham os tipos de contracts.ts. Validam o que vem da
// porta do catálogo e a proposta montada pelo core.
// ---------------------------------------------------------------------------

export const StoreSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  isOpen: z.boolean(),
  deliveryFeeCents: MoneyCentsSchema,
  minimumOrderCents: MoneyCentsSchema.exactOptional(),
});

export const MenuItemSchema = z.object({
  id: IdSchema,
  storeId: IdSchema,
  name: z.string().min(1),
  description: z.string().exactOptional(),
  priceCents: MoneyCentsSchema,
  available: z.boolean(),
});

export const ProposedItemSchema = z.object({
  participantId: IdSchema,
  storeId: IdSchema,
  menuItemId: IdSchema,
  quantity: QuantitySchema,
  unitPriceCents: MoneyCentsSchema,
  isSubstitute: z.boolean().exactOptional(),
});

export const StoreOrderSchema = z
  .object({
    storeId: IdSchema,
    items: z.array(ProposedItemSchema).min(1),
    subtotalCents: MoneyCentsSchema,
    deliveryFeeCents: MoneyCentsSchema,
    totalCents: MoneyCentsSchema,
  })
  .superRefine((order, ctx) => {
    if (order.items.some((item) => item.storeId !== order.storeId)) {
      ctx.addIssue({ code: 'custom', message: 'item de outra loja dentro do pedido', path: ['items'] });
    }
    if (order.subtotalCents !== sum(order.items.map((i) => i.unitPriceCents * i.quantity))) {
      ctx.addIssue({ code: 'custom', message: 'subtotalCents não bate com os itens', path: ['subtotalCents'] });
    }
    if (order.totalCents !== order.subtotalCents + order.deliveryFeeCents) {
      ctx.addIssue({ code: 'custom', message: 'totalCents ≠ subtotalCents + deliveryFeeCents', path: ['totalCents'] });
    }
  });

export const ParticipantShareSchema = z
  .object({
    participantId: IdSchema,
    itemsCents: MoneyCentsSchema,
    deliveryCents: MoneyCentsSchema,
    totalCents: MoneyCentsSchema,
  })
  .refine((share) => share.totalCents === share.itemsCents + share.deliveryCents, {
    message: 'totalCents ≠ itemsCents + deliveryCents',
    path: ['totalCents'],
  });

export const SplitSchema = z
  .object({
    shares: z.array(ParticipantShareSchema),
    totalCents: MoneyCentsSchema,
  })
  .superRefine((split, ctx) => {
    if (sum(split.shares.map((s) => s.totalCents)) !== split.totalCents) {
      ctx.addIssue({ code: 'custom', message: 'a soma das partes não bate com o total', path: ['totalCents'] });
    }
    if (new Set(split.shares.map((s) => s.participantId)).size !== split.shares.length) {
      ctx.addIssue({ code: 'custom', message: 'participante repetido no rateio', path: ['shares'] });
    }
  });

export const ProposalSchema = z
  .object({
    id: IdSchema,
    sessionId: IdSchema,
    orders: z.array(StoreOrderSchema).min(1).max(MAX_STORES_PER_PROPOSAL),
    split: SplitSchema,
    uncoveredParticipantIds: z.array(IdSchema),
    justification: JustificationSchema,
  })
  .superRefine((proposal, ctx) => {
    if (distinctStores(proposal.orders) !== proposal.orders.length) {
      ctx.addIssue({ code: 'custom', message: 'loja repetida na proposta', path: ['orders'] });
    }
    if (sum(proposal.orders.map((o) => o.totalCents)) !== proposal.split.totalCents) {
      ctx.addIssue({ code: 'custom', message: 'total do rateio ≠ soma dos pedidos', path: ['split', 'totalCents'] });
    }
  });

// ---------------------------------------------------------------------------
// Saída do modelo: só IDs, quantidade e justificativa. Estrito: qualquer campo
// extra (por exemplo, um preço inventado) reprova a saída. Preços, totais e
// rateio são preenchidos pelo código a partir do catálogo.
// ---------------------------------------------------------------------------

export const ModelPickSchema = z.strictObject({
  participantId: IdSchema,
  storeId: IdSchema,
  menuItemId: IdSchema,
  quantity: QuantitySchema,
  isSubstitute: z.boolean().exactOptional(),
});

export const ModelOptionSchema = z
  .strictObject({
    picks: z.array(ModelPickSchema).min(1),
    justification: JustificationSchema,
  })
  .refine((option) => distinctStores(option.picks) <= MAX_STORES_PER_PROPOSAL, {
    message: `no máximo ${MAX_STORES_PER_PROPOSAL} lojas por opção`,
    path: ['picks'],
  });

export const ModelProposalSchema = z.strictObject({
  options: z.array(ModelOptionSchema).min(1).max(MAX_OPTIONS_PER_MODEL_PROPOSAL),
});

export type ModelPick = z.infer<typeof ModelPickSchema>;
export type ModelOption = z.infer<typeof ModelOptionSchema>;
export type ModelProposal = z.infer<typeof ModelProposalSchema>;

// ---------------------------------------------------------------------------
// Saída do modelo na coleta. Todos os campos são obrigatórios (nullable em vez
// de opcional) para ser compatível com saída estruturada dos provedores.
// O modelo só transcreve o orçamento citado (budgetText); o valor em centavos
// é extraído por código.
// ---------------------------------------------------------------------------

export const MAX_PREFERENCE_ITEMS = 10;
export const MAX_PREFERENCE_LENGTH = 60;
export const MAX_CLARIFICATION_LENGTH = 200;

const PreferenceListSchema = z.array(z.string().trim().min(1).max(MAX_PREFERENCE_LENGTH)).max(MAX_PREFERENCE_ITEMS);

export const ColetaOutputSchema = z
  .strictObject({
    kind: z.enum(['preference', 'question', 'irrelevant', 'ambiguous']),
    foodPreferences: PreferenceListSchema,
    dietaryRestrictions: PreferenceListSchema,
    avoids: PreferenceListSchema,
    budgetText: z.string().trim().min(1).max(40).nullable(),
    clarification: z.string().trim().min(1).max(MAX_CLARIFICATION_LENGTH).nullable(),
  })
  .refine((output) => output.kind !== 'ambiguous' || output.clarification !== null, {
    message: 'kind "ambiguous" exige clarification',
    path: ['clarification'],
  });

export type ColetaOutput = z.infer<typeof ColetaOutputSchema>;

// ---------------------------------------------------------------------------
// Saída do modelo ao interpretar um pedido de ajuste ("troca o meu por um café").
// O modelo só aponta o id escolhido entre as opções dadas; quem valida e
// recalcula é o código (ajustar).
// ---------------------------------------------------------------------------

export const AjusteOutputSchema = z
  .strictObject({
    kind: z.enum(['swap', 'not_adjustment', 'ambiguous']),
    menuItemId: IdSchema.nullable(),
    quantity: QuantitySchema.nullable(),
    clarification: z.string().trim().min(1).max(MAX_CLARIFICATION_LENGTH).nullable(),
  })
  .refine((o) => o.kind !== 'swap' || o.menuItemId !== null, { message: 'kind "swap" exige menuItemId', path: ['menuItemId'] })
  .refine((o) => o.kind !== 'ambiguous' || o.clarification !== null, {
    message: 'kind "ambiguous" exige clarification',
    path: ['clarification'],
  });

export type AjusteOutput = z.infer<typeof AjusteOutputSchema>;
