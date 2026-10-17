import type { SessionId } from './contracts.js';
import type { SessionRecord, SessionStore } from './ports.js';

/**
 * Sessões em memória (um Map por chat). Suficiente para o hackathon; se o
 * processo reiniciar, as sessões em andamento se perdem. Guarda e devolve
 * cópias, para ninguém alterar o estado por fora do agente.
 */
export class SessoesEmMemoria implements SessionStore {
  private readonly records = new Map<SessionId, SessionRecord>();

  async get(sessionId: SessionId): Promise<SessionRecord | undefined> {
    const record = this.records.get(sessionId);
    return record && structuredClone(record);
  }

  async set(record: SessionRecord): Promise<void> {
    this.records.set(record.session.id, structuredClone(record));
  }

  get size(): number {
    return this.records.size;
  }
}
