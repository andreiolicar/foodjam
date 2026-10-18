import type { AcaoPropostaPreliminar, Agente, NomesCatalogo, Resposta, Organizador } from './agente.js';
import type { DeliveryAddress, DiscoveryCoverage, DiscoveryItem, DiscoveryStore, PreliminaryProposal, IncomingMessage, CoreAction } from './contracts.js';
import type { DiscoveryCatalogPort, LlmPort, SessionStore, SessionRecord } from './ports.js';
import { SessoesEmMemoria } from './sessoes.js';
import type { CoreSession } from './sessao.js';
import { criarSessao, cancelar as cancelarSessao } from './sessao.js';
import { coletarLote } from './coleta.js';
import type { ColetaOutcome, ItemLote } from './coleta.js';
import { confirmarEndereco as confirmar } from './endereco.js';
import { selecionarEnderecoSalvo, proporDescoberta } from './discovery-flow.js';
import type { DiscoveryLimits } from './discovery-search.js';
import type { LlmCallRecord } from './llm.js';
import { LlmSaidaInvalidaError } from './llm.js';
import { createCartController, type CartPreparationService } from './cart-controller.js';

export interface RespostaDescoberta extends Resposta {
  preliminary?: PreliminaryProposal;
  items?: DiscoveryItem[];
  stores?: DiscoveryStore[];
  collection?: { participantId: string; displayName: string; outcome: ColetaOutcome; included: boolean }[];
}

/** Mesma API do Core para exploração; operações cotadas continuam bloqueadas. */
export function criarAgenteDescoberta(deps: { catalog: DiscoveryCatalogPort; llm: LlmPort; sessions?: SessionStore; cartPreparation?: CartPreparationService; registrar?: (record: LlmCallRecord) => void; discoveryLimits?: Partial<DiscoveryLimits>; registrarDescoberta?: (event: { outcome: string; coverage: DiscoveryCoverage }) => void }) {
  const sessions = deps.sessions ?? new SessoesEmMemoria();
  const queues = new Map<string, Promise<unknown>>();
  const choices = new Map<string, number>();
  const collections = new Map<string, NonNullable<RespostaDescoberta['collection']>>();
  const message = (id: string, participantId: string, text: string): CoreAction => ({ type: 'send_message', sessionId: id, participantId, text });
  const active = (record: SessionRecord | undefined): record is SessionRecord => Boolean(record && !['closed', 'cancelled'].includes(record.session.status));
  const denied = (record: SessionRecord, actor: string): RespostaDescoberta => ({ outcome: 'not_authorized', session: record.session, actions: [message(record.session.id, actor, 'Somente quem organizou pode usar essa ação.')] });
  function clear(session: CoreSession) { const next = structuredClone(session); delete next.preliminary; delete next.preliminaryAlternative; return next; }
  function serial(id: string, op: () => Promise<RespostaDescoberta>): Promise<RespostaDescoberta> {
    const result = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(op).catch(async (error: unknown): Promise<RespostaDescoberta> => {
      const session = (await sessions.get(id))?.session;
      return { outcome: error instanceof LlmSaidaInvalidaError ? 'model_failed' : error instanceof Error && error.name === 'IfoodCatalogError' ? 'catalog_failed' : 'error', actions: [], ...(session ? { session } : {}) };
    });
    queues.set(id, result); void result.finally(() => { if (queues.get(id) === result) queues.delete(id); }); return result;
  }
  async function choose(id: string, actor: string, index: number): Promise<RespostaDescoberta> {
    const record = await sessions.get(id);
    if (!active(record)) return { outcome: 'no_session', actions: [] };
    if (record.session.organizerId !== actor) return denied(record, actor);
    const base = clear(record.session);
    if (index > 0) delete base.address;
    await sessions.set({ ...record, session: base });
    const addresses = await deps.catalog.listSavedAddresses();
    if (!addresses.length) return { outcome: 'address_required', session: base, actions: [{ type: 'send_message', sessionId: id, text: 'Não há endereço salvo disponível. Cadastre no aplicativo iFood; nenhum cadastro será feito pelo bot.' }] };
    const selected = await selecionarEnderecoSalvo(base, actor, { ...deps.catalog, listSavedAddresses: async () => addresses }, addresses[index % addresses.length]!.id!);
    choices.set(id, index % addresses.length); await sessions.set({ ...record, session: selected.session });
    return { outcome: 'address_default_proposed', ...selected, actions: [...selected.actions, ...(index > 0 ? [{ type: 'send_message' as const, sessionId: id, text: addresses.length > 1 ? 'Escolha entre os endereços salvos. Um endereço digitado precisa de validação e consentimento de cadastro; o bot não cadastra endereços nesta etapa.' : 'Não há outro endereço salvo. Para um endereço digitado, é preciso validação/cadastro autorizado; cadastre no aplicativo iFood e tente novamente. Nenhum endereço foi criado pelo bot.' }] : [])] };
  }
  async function propose(id: string, actor: string): Promise<RespostaDescoberta> {
    const record = await sessions.get(id);
    if (!active(record)) return { outcome: 'no_session', actions: [] };
    if (record.session.organizerId !== actor) return denied(record, actor);
    const address = record.session.address?.status === 'confirmed' ? record.session.address.confirmed : undefined;
    if (!address) return { outcome: 'address_required', actions: [], session: record.session };
    const collection = structuredClone(collections.get(id) ?? []);
    // A coleta só preenche este perfil quando reconhece uma preferência. Listas
    // vazias também são legítimas: representam indiferença alimentar explícita.
    const participants = record.session.participants.filter(p => Object.keys(p.preferences).length > 0);
    if (!participants.length) return { outcome: 'preferences_required', session: record.session, collection, actions: [] };
    const revision = record.proposalCount + 1;
    const base = clear(record.session); await sessions.set({ ...record, session: base, proposalCount: revision });
    const result = await proporDescoberta({ ...base, participants }, { port: deps.catalog, ...(deps.discoveryLimits ? { limits: deps.discoveryLimits } : {}), llm: deps.llm, address, mode: 'model', ...(deps.registrar ? { registrar: deps.registrar } : {}), proposalId: `${id}-preliminary-${revision}` });
    const outcome = result.proposal ? 'preliminary_ready' : result.reason ?? 'no_candidates';
    if (result.coverage) deps.registrarDescoberta?.({ outcome, coverage: structuredClone(result.coverage) });
    const reasons = result.coverage?.reasons ?? [];
    const labels = { term_limit: 'termos', store_limit: 'lojas', request_limit: 'chamadas', time_limit: 'tempo', item_limit: 'produtos' };
    const budgets = Object.entries(labels).filter(([key]) => reasons.includes(key as keyof typeof labels)).map(([, label]) => label);
    const coverageText = budgets.length
      ? `A pesquisa foi limitada por: ${budgets.join(', ')}. Foi consultada apenas uma amostra do catálogo.`
      : result.coverage?.limited ? 'Foi consultada uma amostra parcial do catálogo; páginas ou ofertas podem ter ficado fora da pesquisa.' : undefined;
    // A cobertura pública mantém as pessoas sem perfil, mas não lhes atribui itens.
    const proposal = result.proposal ? { ...result.proposal, participants: structuredClone(base.participants) } : undefined;
    const alternative = result.alternatives?.[0] ? { ...result.alternatives[0], participants: structuredClone(base.participants) } : undefined;
    const session = { ...base, ...(proposal ? { preliminary: proposal } : {}), ...(alternative ? { preliminaryAlternative: alternative } : {}) };
    await sessions.set({ ...record, session, proposalCount: revision, discoveryCatalog: { stores: result.stores, items: result.items } });
    return { outcome, actions: !result.proposal && coverageText ? [{ type: 'send_message', sessionId: id, text: coverageText }] : [], session,
      ...(proposal ? { preliminary: proposal } : {}), ...(session.preliminaryAlternative ? { preliminaryAlternative: session.preliminaryAlternative } : {}), collection, stores: result.stores, items: result.items };
  }
  async function collect(id: string, items: readonly ItemLote[]): Promise<RespostaDescoberta> {
    const record = await sessions.get(id);
    if (!active(record)) return { outcome: 'no_session', actions: [] };
    const result = await coletarLote(record.session, items, { llm: deps.llm, ...(deps.registrar ? { registrar: deps.registrar } : {}) });
    const changed = result.resultados.some(r => r.outcome === 'preference_updated');
    const hadProposal = Boolean(record.session.preliminary);
    const session = changed ? clear(result.session) : result.session;
    await sessions.set({ ...record, session });
    const collection = new Map((collections.get(id) ?? []).map(row => [row.participantId, row]));
    for (const row of result.resultados) collection.set(row.participantId, { ...row,
      displayName: session.participants.find(p => p.id === row.participantId)?.displayName ?? items.find(i => i.participantId === row.participantId)?.displayName ?? 'Participante',
      included: session.participants.some(p => p.id === row.participantId),
    });
    collections.set(id, [...collection.values()]);
    if (result.resultados.some(r => r.outcome === 'model_failed')) return { ...result, session, collection: [...collection.values()], outcome: 'model_failed' };
    if (hadProposal && changed) {
      const proposed = await propose(id, session.organizerId);
      return { ...proposed, actions: [...result.actions, ...proposed.actions], resultados: result.resultados.map(r => ({ ...r, outcome: r.outcome === 'preference_updated' ? 'adjusted' : r.outcome })), ...(proposed.preliminary ? { outcome: 'preliminary_adjusted' } : {}) };
    }
    return { ...result, session, collection: [...collection.values()], outcome: 'preferences_updated' };
  }
  async function proposalAction(id: string, actor: string, action: AcaoPropostaPreliminar, expected?: string): Promise<RespostaDescoberta> {
    const record = await sessions.get(id);
    if (!active(record)) return { outcome: expected === undefined ? 'no_session' : 'proposal_stale', actions: [] };
    if (record.session.organizerId !== actor) return denied(record, actor);
    // Executada somente dentro de serial(): nenhuma operação da sessão pode
    // substituir a proposta entre esta conferência e a mutação abaixo.
    if (expected !== undefined && record.session.preliminary?.id !== expected) return { outcome: 'proposal_stale', session: record.session, actions: [] };
    if (action === 'revisar') return { outcome: 'preliminary_review', session: record.session, actions: [] };
    if (action === 'outra_opcao') {
      const { preliminary, preliminaryAlternative } = record.session;
      if (!preliminary || !preliminaryAlternative) return { outcome: 'no_alternative', session: record.session, actions: [message(id, actor, 'Não há outra opção validada nesta amostra do catálogo.')] };
      // Identidade nova em toda apresentação, inclusive ao voltar à alternativa
      // anterior: um clique atrasado não pode reencontrar a mesma identidade.
      const revision = record.proposalCount + 1;
      const session = { ...record.session, preliminary: { ...preliminaryAlternative, id: `${id}-preliminary-${revision}` }, preliminaryAlternative: preliminary };
      await sessions.set({ ...record, session, proposalCount: revision });
      return { outcome: 'switched', session, preliminary: session.preliminary, preliminaryAlternative: preliminary, ...(record.discoveryCatalog ? { items: record.discoveryCatalog.items, stores: record.discoveryCatalog.stores } : {}), collection: collections.get(id) ?? [], actions: [] };
    }
    const session = action === 'cancelar' ? cancelarSessao(clear(record.session), actor) : clear(record.session);
    await sessions.set({ ...record, session });
    return { outcome: action === 'cancelar' ? 'cancelled' : 'collecting', session, actions: [] };
  }
  return {
    ...(deps.cartPreparation ? createCartController(sessions, deps.cartPreparation) : {}),
    agirNaPropostaPreliminar(id: string, actor: string, proposalId: string, action: AcaoPropostaPreliminar) { return serial(id, async () => {
      if (typeof proposalId !== 'string' || !proposalId) return { outcome: 'proposal_stale', actions: [] };
      return proposalAction(id, actor, action, proposalId);
    }); },
    iniciar(id: string, organizer: Organizador) { return serial(id, async () => {
      const record = await sessions.get(id);
      const previousCount = record?.proposalCount ?? 0;
      if (active(record)) return { outcome: 'already_active', actions: [], session: record.session };
      collections.delete(id);
      await sessions.set({ session: criarSessao({ id, organizerId: organizer.id, participants: [{ ...organizer, preferences: {} }] }), proposalCount: previousCount });
      const selected = await choose(id, organizer.id, 0);
      return { ...selected, outcome: selected.outcome === 'address_default_proposed' ? 'started' : selected.outcome };
    }); },
    confirmarEndereco(id: string, actor: string, expected?: DeliveryAddress) { return serial(id, async () => {
      const record = await sessions.get(id);
      if (!active(record)) return { outcome: 'no_session', actions: [] };
      if (record.session.organizerId !== actor) return denied(record, actor);
      const candidate = record.session.address?.candidate;
      if (expected && (!candidate || candidate.id !== expected.id || candidate.formatted !== expected.formatted)) return { outcome: 'address_stale', actions: [] };
      if (candidate) {
        const saved = await deps.catalog.listSavedAddresses();
        if (saved.filter(a => a.id === candidate.id && a.formatted === candidate.formatted).length !== 1) return { outcome: 'address_invalid', actions: [] };
      }
      const result = confirmar(record.session, actor); await sessions.set({ ...record, session: result.session });
      return { ...result, actions: result.actions.map(a => a.type === 'send_message' ? { type: 'send_message' as const, sessionId: id, text: 'Endereço confirmado pelo organizador. Respondam a esta mensagem com suas preferências; /montar prepara a sugestão. Para trocar o endereço salvo, use /endereco.' } : a) };
    }); },
    pedirOutroEndereco(id: string, actor: string) { return serial(id, () => choose(id, actor, (choices.get(id) ?? 0) + 1)); },
    mensagem(input: IncomingMessage, displayName?: string) { return serial(input.sessionId, () => collect(input.sessionId, [{ participantId: input.participantId, text: input.text, ...(displayName ? { displayName } : {}) }])); },
    mensagens(id: string, items: readonly ItemLote[]) { return serial(id, () => collect(id, items)); },
    propor(id: string, actor: string) { return serial(id, () => propose(id, actor)); },
    outraOpcao(id: string, actor: string) { return serial(id, () => proposalAction(id, actor, 'outra_opcao')); },
    reabrirColeta(id: string, actor: string) { return serial(id, () => proposalAction(id, actor, 'voltar_coleta')); },
    responderOrcamento(id: string, actor: string) { return serial(id, async () => {
      const record = await sessions.get(id); if (!active(record)) return { outcome: 'no_session', actions: [] };
      if (!record.session.participants.some(p => p.id === actor)) return denied(record, actor);
      return { outcome: 'commercial_pending', session: record.session, actions: [message(id, actor, 'Os valores finais ainda dependem do carrinho. Nenhum aceite financeiro foi registrado.')] };
    }); },
    fechar(id: string, actor: string) { return serial(id, async () => {
      const record = await sessions.get(id); if (!active(record)) return { outcome: 'no_session', actions: [] };
      if (record.session.organizerId !== actor) return denied(record, actor);
      return { outcome: 'commercial_pending', session: record.session, actions: [message(id, actor, 'Esta é uma proposta preliminar. Preparação comercial autorizada, valores atuais e aceites vinculados ao carrinho são necessários antes de qualquer fechamento.')] };
    }); },
    cancelar(id: string, actor: string) { return serial(id, () => proposalAction(id, actor, 'cancelar')); },
    async obter(id: string) { return (await sessions.get(id))?.session; },
    async nomes(id: string): Promise<NomesCatalogo | undefined> { const snapshot = (await sessions.get(id))?.discoveryCatalog; return snapshot ? { lojas: Object.fromEntries(snapshot.stores.map(s => [s.id, s.name])), itens: Object.fromEntries(snapshot.items.map(i => [i.id, i.name])) } : undefined; },
  } satisfies Agente;
}
