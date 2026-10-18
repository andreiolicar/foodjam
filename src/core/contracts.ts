/** Contratos internos iniciais; poderão evoluir conforme a integração dos módulos. */
export type SessionId = string;
export type ParticipantId = string;

/**
 * Centavos inteiros de BRL: 2590 = R$ 25,90.
 * Alias documental, sem validação em runtime. O core deverá validar inteiros
 * seguros e não negativos nas entradas e operações financeiras futuras.
 */
export type MoneyCents = number;

export interface ParticipantPreferences {
  foodPreferences?: string[];
  /** Restrição dura (saúde, dieta, alergia): a proposta nunca pode violar. */
  dietaryRestrictions?: string[];
  /** Rejeição de gosto ("sem japonês"): filtra lojas e categorias, sem risco à saúde. */
  avoids?: string[];
  /**
   * Itens que a pessoa quer receber, um por entrada ("um lanche e um bolo de
   * cenoura" → ["lanche", "bolo de cenoura"]). Vazio ou ausente: um item que
   * combine com foodPreferences.
   */
  wishes?: string[];
  /** Quantidades comprovadas, na mesma ordem de wishes. Ausência mantém uma unidade. */
  wishQuantities?: number[];
  budgetCents?: MoneyCents;
}

export interface Participant {
  id: ParticipantId;
  displayName: string;
  preferences: ParticipantPreferences;
}

/**
 * Fases da sessão: collecting (coleta) → reviewing (proposta) →
 * awaiting_confirmation (confirmação do organizador) → closed (fechada).
 * cancelled pode ser alcançada de qualquer fase não final. Transições em src/core/sessao.ts.
 */
export type SessionStatus = 'collecting' | 'reviewing' | 'awaiting_confirmation' | 'closed' | 'cancelled';

export interface SessionState {
  id: SessionId;
  organizerId: ParticipantId;
  status: SessionStatus;
  participants: Participant[];
}

/** Mensagem interna da interface conversacional para o core. */
export interface IncomingMessage {
  sessionId: SessionId;
  participantId: ParticipantId;
  text: string;
}

/** Ações internas para a interface; não representam ferramentas MCP do iFood. */
export type CoreAction =
  | {
      type: 'send_message';
      sessionId: SessionId;
      /** Presente para mensagem privada; ausente para mensagem coletiva. */
      participantId?: ParticipantId;
      text: string;
    }
  | {
      type: 'session_updated';
      session: SessionState;
    }
  | {
      /** Pedir ao organizador, no privado, que digite o endereço de entrega. */
      type: 'request_address';
      sessionId: SessionId;
      participantId: ParticipantId;
      text: string;
    }
  | {
      /**
       * Pedir ao organizador que confirme o endereço, no destino indicado, com botões:
       * kind "default" → [Sim] [Outro endereço]; kind "typed" → [Confirmar] [Corrigir].
       */
      type: 'confirm_address';
      /** Destino aprovado para a confirmação; orçamento continua privado. */
      visibility?: 'group';
      sessionId: SessionId;
      participantId: ParticipantId;
      address: DeliveryAddress;
      kind: 'default' | 'typed';
      text: string;
    }
  | {
      /**
       * Perguntar à pessoa, no privado, se aceita passar do orçamento, com
       * botões [Aceito] [Quero outro]. totalCents inclui itens, entrega e taxa de serviço.
       */
      type: 'budget_question';
      sessionId: SessionId;
      participantId: ParticipantId;
      proposalId: string;
      totalCents: MoneyCents;
      text: string;
    }
  | {
      /**
       * Sugerir, no privado, outro item que caiba no orçamento: botões
       * [Aceito a sugestão] [Fico sem]. Sem menuItemId, não há item que caiba:
       * só o botão [Fico sem].
       */
      type: 'item_suggestion';
      sessionId: SessionId;
      participantId: ParticipantId;
      proposalId: string;
      menuItemId?: MenuItemId;
      totalCents?: MoneyCents;
      text: string;
    };

/** Endereço de entrega já validado e normalizado pelo iFood. */
export interface DeliveryAddress {
  /** Texto normalizado devolvido pelo iFood (para mostrar e para as buscas). */
  formatted: string;
  /** Identificador opaco do endereço no iFood, se houver. */
  id?: string;
}

/** Identificadores opacos de catálogo; o módulo iFood faz o mapeamento. */
export type StoreId = string;
export type MenuItemId = string;

/** Loja no vocabulário do core, não no formato das ferramentas do iFood. */
export interface Store {
  id: StoreId;
  name: string;
  isOpen: boolean;
  deliveryFeeCents: MoneyCents;
  minimumOrderCents?: MoneyCents;
}

export interface MenuItem {
  id: MenuItemId;
  storeId: StoreId;
  name: string;
  description?: string;
  priceCents: MoneyCents;
  available: boolean;
  /**
   * Comida ou bebida, se o catálogo souber (ex.: pela seção do cardápio).
   * Ausente: o core infere pelo nome e pela descrição.
   */
  category?: 'food' | 'drink';
}

/** Item escolhido para uma pessoa. O preço é copiado do catálogo pelo código, nunca pelo modelo. */
export interface ProposedItem {
  participantId: ParticipantId;
  storeId: StoreId;
  menuItemId: MenuItemId;
  /** Inteiro de 1 a 10. */
  quantity: number;
  unitPriceCents: MoneyCents;
  /** Verdadeiro quando o item substitui o que a pessoa pediu originalmente. */
  isSubstitute?: boolean;
}

/** Pedido de uma loja dentro da proposta. totalCents = subtotalCents + deliveryFeeCents. */
export interface StoreOrder {
  storeId: StoreId;
  items: ProposedItem[];
  subtotalCents: MoneyCents;
  deliveryFeeCents: MoneyCents;
  /** Taxa de serviço cotada no iFood para este pedido. Ausente: não foi possível cotar. */
  serviceFeeCents?: MoneyCents;
  /** subtotalCents + deliveryFeeCents + serviceFeeCents (0 se ausente). */
  totalCents: MoneyCents;
}

export interface ParticipantShare {
  participantId: ParticipantId;
  itemsCents: MoneyCents;
  deliveryCents: MoneyCents;
  /** Parte da taxa de serviço das lojas em que a pessoa pediu (dividida como a entrega). */
  serviceCents: MoneyCents;
  /** itemsCents + deliveryCents + serviceCents: é o que vale para o orçamento. */
  totalCents: MoneyCents;
}

/** Rateio: a soma dos totalCents das partes é exatamente totalCents. */
export interface Split {
  shares: ParticipantShare[];
  totalCents: MoneyCents;
}

/** Proposta de pedido com 1 ou 2 lojas, montada e validada pelo core. */
export interface Proposal {
  id: string;
  sessionId: SessionId;
  orders: StoreOrder[];
  split: Split;
  /** Participantes que ficaram sem item nesta proposta. */
  uncoveredParticipantIds: ParticipantId[];
  /** Justificativa curta escrita pelo modelo. */
  justification: string;
}

/** Autorização explícita do organizador para uma proposta específica. */
export interface OrderAuthorization {
  proposalId: string;
  authorizedBy: ParticipantId;
  /** ISO 8601. */
  authorizedAt: string;
}

/**
 * Fronteira com quem executa o pedido: o core só entrega estes dados depois
 * da autorização do organizador. O core não executa a compra.
 */
export interface AuthorizedOrder {
  sessionId: SessionId;
  proposalId: string;
  authorization: OrderAuthorization;
  /** Endereço confirmado pelo organizador; é para onde todos os pedidos vão. */
  deliveryAddress: DeliveryAddress;
  orders: StoreOrder[];
  split: Split;
}

/** Descoberta real antes da cotação: ausência significa não comprovado. */
export type DiscoveryStore = Omit<Store, 'deliveryFeeCents'> & {
  deliveryFeeCents?: MoneyCents;
  /** Metadados informativos do estabelecimento; nunca participam da seleção. */
  reviewRating?: number;
  ratingCount?: number;
};
export type DiscoveryItem = Omit<MenuItem, 'priceCents' | 'available'> & {
  /** Foto principal validada, opcional e exclusivamente visual. */
  itemImageUrl?: string;
  priceCents?: MoneyCents;
  /** Preço base conhecido; promoção/valor aplicável ainda não comprovado. */
  basePriceCents?: MoneyCents;
  available?: boolean;
};
export interface DiscoveryMenu {
  /** Funcionamento observado ao consultar este menu, quando fornecido. */
  storeOpen?: boolean;
  items: DiscoveryItem[];
  coverage: 'offers_only' | 'complete';
  /** Consulta limitada intencionalmente; não representa fim de catálogo. */
  truncated?: boolean;
}
/** Motivos observados; amostra parcial não implica esgotamento de chamadas/tempo. */
export type DiscoveryCoverageReason = 'term_limit' | 'store_limit' | 'request_limit' | 'time_limit'
  | 'catalog_partial' | 'pagination_truncated' | 'item_limit' | 'classification_limit';
export interface DiscoveryCoverage {
  reasons?: DiscoveryCoverageReason[];
  /** Lojas distintas encontradas na amostra, incluindo fechadas. */
  candidateStores?: number;
  /** Lojas relidas individualmente para conferir funcionamento. */
  checkedStores?: number;
  /** Lojas distintas observadas fechadas na busca ou nas releituras. */
  closedStores?: number;
  classificationLimited?: boolean;
  /** requests conta operações da porta; cada uma pode ter paginação interna limitada. */
  terms: number; stores: number; items: number; requests: number; limited: boolean;
}
export interface PreliminaryProposal {
  coverage?: DiscoveryCoverage;
  id: string;
  sessionId: SessionId;
  organizerId: ParticipantId;
  address: DeliveryAddress;
  participants: Participant[];
  items: { participantId: ParticipantId; storeId: StoreId; menuItemId: MenuItemId; quantity: number; isSubstitute?: boolean }[];
  status: 'preliminary';
  /** Sem total/orçamento confirmado; não é autorização de compra. */
  pending: readonly ('commercial_validation' | 'catalog_incomplete')[];
}

export interface CartObservation {
  cartId: string;
  storeId: StoreId;
  items: { menuItemId: MenuItemId; quantity: number; unitPriceCents?: MoneyCents }[];
  amounts?: {
    subtotalCents: MoneyCents;
    deliveryCents: MoneyCents;
    feesCents: MoneyCents;
    benefitsCents: MoneyCents;
    voucherCents: MoneyCents;
    totalCents: MoneyCents;
  };
  issues: string[];
}
export interface PreparationContext {
  authenticatedUserId: string;
  sessionId: SessionId;
  proposalId: string;
  storeId: StoreId;
  address: DeliveryAddress;
  items: { menuItemId: MenuItemId; quantity: number }[];
}
/** Opaca: apenas a autoridade da aplicação reconhece a instância emitida. */
export interface PreparationPermit { readonly purpose: 'prepare_cart' }
export interface PreparationAuthority {
  verify(permit: PreparationPermit, context: PreparationContext): void;
}
export type CommercialShare = Omit<ParticipantShare, 'serviceCents'> & {
  feesCents: MoneyCents;
  discountCents: MoneyCents;
  /** Política local explícita; não representa a origem de descontos do iFood. */
  unattributedAdjustment?: { creditCents: MoneyCents; debitCents: MoneyCents };
};
export interface CommercialSplit { shares: CommercialShare[]; totalCents: MoneyCents }
export interface CommercialReview {
  status: 'blocked' | 'review_required';
  observations: CartObservation[];
  failures: StoreId[];
  split?: CommercialSplit;
  /** Confirmação individual necessária para cada excesso. */
  overBudget: { participantId: ParticipantId; totalCents: MoneyCents }[];
  /** Todos os compradores afetados precisam aceitar a política e a revisão. */
  adjustmentPolicy?: { name: 'proportional_unattributed_adjustment'; requiredParticipantIds: ParticipantId[] };
  revision: string;
}

/** Inspeção somente leitura. Contratos de retorno não homologados nunca autorizam compra. */
export interface CheckoutInspection {
  status: 'blocked';
  review: CommercialReview;
  stores: { storeId: StoreId; pixAvailable?: boolean; issues: string[] }[];
  blockers: string[];
}

/** Texto coletado ainda não é DeliveryAddress nem localização válida. */
export interface AddressRegistrationIntent {
  sessionId: SessionId;
  organizerId: ParticipantId;
  rawText: string;
  status: 'requires_registration_consent';
}
