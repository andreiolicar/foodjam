import type { MenuItem, Store, StoreId } from './contracts.js';

/**
 * Leitura do catálogo no vocabulário do core. O módulo iFood implementa esta
 * porta traduzindo as ferramentas reais; o core não conhece os nomes delas.
 * Não há operação de pedido aqui: o catálogo é só de leitura.
 */
export interface CatalogPort {
  /**
   * Busca lojas por termo livre (nome da loja ou de itens do cardápio).
   * Pode devolver lojas fechadas; quem filtra é o core. Lista vazia quando nada casa.
   */
  searchStores(query: string): Promise<Store[]>;

  /** Cardápio de uma loja, incluindo itens indisponíveis. Rejeita com StoreNotFoundError se a loja não existir. */
  getMenu(storeId: StoreId): Promise<MenuItem[]>;
}

/** fast: chamadas baratas (coleta). capable: raciocínio maior (proposta). */
export type LlmTier = 'fast' | 'capable';

export interface LlmRequest {
  tier: LlmTier;
  /** Instruções de sistema, escritas pelo core. */
  system: string;
  /** Conteúdo da chamada; mensagens de usuário chegam aqui já delimitadas como dados. */
  prompt: string;
  /** Nome da saída estruturada (ex.: "coleta"). */
  outputName: string;
  /** JSON Schema da saída, gerado do schema Zod, para o provedor forçar o formato. */
  outputSchema: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Acesso ao modelo de IA, independente de provedor. Devolve o JSON bruto da
 * saída estruturada; quem valida com Zod é o core (src/core/llm.ts).
 */
export interface LlmPort {
  generate(request: LlmRequest): Promise<unknown>;
}

export class StoreNotFoundError extends Error {
  constructor(readonly storeId: StoreId) {
    super(`loja não encontrada: ${storeId}`);
    this.name = 'StoreNotFoundError';
  }
}
