import type { CartObservation, DiscoveryItem, DiscoveryMenu, DiscoveryStore, PreparationContext, PreparationPermit, DeliveryAddress, MenuItem, MenuItemId, MoneyCents, SessionId, Store, StoreId } from './contracts.js';
import type { TimedCatalogSnapshot } from './regras/validar-escolhas.js';
import type { PessoaClassificada } from './regras/combinacoes.js';
import type { CoreSession } from './sessao.js';

/** Tudo que o agente guarda por sessão (chat). */
export interface SessionRecord {
  session: CoreSession;
  /** Retrato do catálogo usado na proposta atual (para ajustes e fechamento). */
  catalog?: TimedCatalogSnapshot;
  /** Classificação do modelo na proposta atual, para sugerir outro item a quem estourar o orçamento. */
  classificacao?: PessoaClassificada[];
  /** Quantas propostas já foram geradas (para ids previsíveis). */
  proposalCount: number;
  discoveryCatalog?: { stores: DiscoveryStore[]; items: DiscoveryItem[] };
}

/**
 * Onde o agente guarda as sessões. Assíncrona para permitir trocar a versão
 * em memória por persistência sem mudar o agente.
 */
export interface SessionStore {
  get(sessionId: SessionId): Promise<SessionRecord | undefined>;
  set(record: SessionRecord): Promise<void>;
}

/**
 * Leitura do catálogo no vocabulário do core. O módulo iFood implementa esta
 * porta traduzindo as ferramentas reais; o core não conhece os nomes delas.
 * Não há operação de pedido aqui: o catálogo é só de leitura.
 */
export interface CatalogPort {
  /**
   * Valida um endereço digitado livremente e devolve a versão normalizada pelo
   * iFood, ou o motivo do erro. Não lança para endereço ruim: só para falha de rede.
   */
  validateAddress(text: string): Promise<AddressValidation>;

  /**
   * Busca lojas por termo livre (nome da loja ou de itens do cardápio) que
   * entregam no endereço. Pode devolver lojas fechadas; quem filtra é o core.
   * Lista vazia quando nada casa.
   */
  searchStores(query: string, address: DeliveryAddress): Promise<Store[]>;

  /**
   * Cardápio de uma loja para o endereço, incluindo itens indisponíveis.
   * Rejeita com StoreNotFoundError se a loja não existir.
   */
  getMenu(storeId: StoreId, address: DeliveryAddress): Promise<MenuItem[]>;

  /**
   * Cota um pedido de uma loja (sem comprar) e devolve a taxa de serviço que o
   * iFood cobraria. O core chama só para a proposta escolhida e a alternativa
   * (uma vez por loja) e de novo no fechamento.
   */
  quoteOrder(storeId: StoreId, items: readonly ItemCotacao[], address: DeliveryAddress): Promise<CotacaoPedido>;
}

/** Item de um pedido a cotar. */
export interface ItemCotacao {
  menuItemId: MenuItemId;
  quantity: number;
}

export interface CotacaoPedido {
  /** Taxa de serviço em centavos inteiros. */
  serviceFeeCents: MoneyCents;
}

/** Motivos de endereço recusado pelo iFood. */
export type AddressError = 'not_found' | 'out_of_area' | 'incomplete';

export type AddressValidation = { ok: true; address: DeliveryAddress } | { ok: false; reason: AddressError };

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

/** Fase de exploração: não promete preço, estoque ou frete final. */
export interface DiscoveryCatalogPort {
  /** Ofertas encontradas por desejo, sempre com associação explícita à loja. */
  searchItems?(query: string, address: DeliveryAddress): Promise<DiscoveryItem[]>;
  listSavedAddresses(): Promise<DeliveryAddress[]>;
  searchStores(query: string, address: DeliveryAddress): Promise<DiscoveryStore[]>;
  getMenu(storeId: StoreId, address: DeliveryAddress): Promise<DiscoveryMenu>;
  getStore(storeId: StoreId, address: DeliveryAddress): Promise<DiscoveryStore>;
}
/** Não existe submissão/compras nesta porta. */
export interface CommercialPreparationPort {
  prepare(context: PreparationContext, permit: PreparationPermit): Promise<CartObservation>;
}
