// API pública do core. Importar não abre conexões nem chama o modelo.
export type * from './contracts.js';

export { criarAgente, TEXTOS } from './agente.js';
export type { Agente, AgenteDeps, Organizador, Resposta } from './agente.js';
export { SessoesEmMemoria } from './sessoes.js';
export type { CatalogPort, LlmPort, LlmRequest, LlmTier, SessionRecord, SessionStore } from './ports.js';
export { StoreNotFoundError } from './ports.js';
export type { CoreSession, PendingQuestion } from './sessao.js';
export type { ProblemaProposta } from './regras/verificar-proposta.js';
export type { Descarte, ItemIncerto } from './proposta.js';

// Modelo: escolha pelo ambiente (AI_PROVIDER etc.) e registro de chamadas.
export { criarLlmDoAmbiente, temProvedorReal } from './llm-ambiente.js';
export type { LlmEnv } from './llm-ambiente.js';
export type { LlmCallRecord } from './llm.js';

// Fakes para desenvolver e testar a integração sem iFood nem modelo real.
export { CatalogoFake, LOJAS } from './fakes/catalogo-fake.js';
export { FakeLlm, responderHeuristico } from './fakes/llm-fake.js';
