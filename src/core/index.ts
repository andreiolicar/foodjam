// API pública do core. Importar não abre conexões nem chama o modelo.
export type * from './contracts.js';

export { criarAgente, TEXTOS } from './agente.js';
export type { AcaoPropostaPreliminar, Agente, AgenteDeps, NomesCatalogo, Organizador, Resposta } from './agente.js';
export { criarAgrupador } from './agrupador.js';
export type { Agrupador, AgrupadorOptions } from './agrupador.js';
export type { ItemLote } from './coleta.js';
export { SessoesEmMemoria } from './sessoes.js';
export type {
  AddressError,
  AddressValidation,
  CatalogPort,
  CotacaoPedido,
  ItemCotacao,
  LlmPort,
  LlmRequest,
  LlmTier,
  SessionRecord,
  SessionStore,
} from './ports.js';
export { TEXTOS_ORCAMENTO } from './orcamento.js';
export type { RespostaOrcamento } from './orcamento.js';
export { StoreNotFoundError } from './ports.js';
export type { CoreSession, EnderecoSessao, PendingQuestion } from './sessao.js';
export { TEXTOS_ENDERECO } from './endereco.js';
export type { ProblemaProposta } from './regras/verificar-proposta.js';
export type { Descarte, ItemIncerto } from './proposta.js';

// Modelo: escolha pelo ambiente (AI_PROVIDER etc.) e registro de chamadas.
export { criarLlmDoAmbiente, temProvedorReal } from './llm-ambiente.js';
export type { LlmEnv, OpcoesLlmAmbiente } from './llm-ambiente.js';
export { LlmEmCascata } from './llm-cascata.js';
export type { TrocaDeProvedor } from './llm-cascata.js';
export type { LlmCallRecord } from './llm.js';

// Fakes para desenvolver e testar a integração sem iFood nem modelo real.
export { CatalogoFake, ENDERECO_FAKE, LOJAS } from './fakes/catalogo-fake.js';
export { FakeLlm, responderHeuristico } from './fakes/llm-fake.js';

export { coletarEnderecoDigitado, selecionarEnderecoSalvo, proporDescoberta } from './discovery-flow.js';
export { createPreparationAuthority, prepareCommercialProposal, reviewCommercial, canConfirmCommercial } from './commercial-flow.js';
export type { DiscountPolicy } from './commercial-flow.js';
export type { DiscoveryCatalogPort, CommercialPreparationPort } from './ports.js';
export { criarAgenteDescoberta } from './discovery-agent.js';
export type { RespostaDescoberta } from './discovery-agent.js';
