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
  dietaryRestrictions?: string[];
  budgetCents?: MoneyCents;
}

export interface Participant {
  id: ParticipantId;
  displayName: string;
  preferences: ParticipantPreferences;
}

/** Vocabulário provisório; não implementa transições ou autorização de compra. */
export type SessionStatus = 'collecting' | 'reviewing' | 'closed';

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
