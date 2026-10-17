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
    };

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
  totalCents: MoneyCents;
}

export interface ParticipantShare {
  participantId: ParticipantId;
  itemsCents: MoneyCents;
  deliveryCents: MoneyCents;
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
  orders: StoreOrder[];
  split: Split;
}
