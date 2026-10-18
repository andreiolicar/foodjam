import { interpretarAjuste } from './ajuste.js';
import { atualizarCatalogo } from './catalogo.js';
import type { ItemLote } from './coleta.js';
import { coletar, coletarLote } from './coleta.js';
import type { AuthorizedOrder, CoreAction, IncomingMessage, ParticipantId, Proposal, SessionId } from './contracts.js';
import { fechar } from './fechamento.js';
import type { LlmCallRecord } from './llm.js';
import type { CatalogPort, LlmPort, SessionRecord, SessionStore } from './ports.js';
import type { Descarte, ItemIncerto } from './proposta.js';
import { propor } from './proposta.js';
import type { ProblemaProposta } from './regras/verificar-proposta.js';
import type { CoreSession } from './sessao.js';
import {
  NaoAutorizadoError,
  TransicaoInvalidaError,
  cancelar,
  criarSessao,
  pedirConfirmacao,
  trocarPorAlternativa,
  voltarParaColeta,
} from './sessao.js';
import { SessoesEmMemoria } from './sessoes.js';
import {
  TEXTOS_ENDERECO,
  confirmarEndereco as confirmarEnderecoDaSessao,
  enderecoConfirmado,
  esperandoEnderecoDe,
  iniciarEndereco,
  lembrarEndereco,
  pedirOutroEndereco as pedirOutroEnderecoDaSessao,
  receberTextoEndereco,
} from './endereco.js';

export const TEXTOS = {
  soOrganizador: 'Só quem organizou o pedido pode fazer isso.',
  semSessao: 'Não há pedido em andamento. Me mencione para começar um.',
  sessaoEncerrada: 'Esse pedido já foi encerrado. Me mencione para começar outro.',
  faseInvalida: 'Isso não dá para fazer agora, nesta etapa do pedido.',
  semProposta: 'Não consegui montar uma proposta agora. Tente de novo em instantes.',
  semAlternativa: 'Não há outra opção diferente para este pedido.',
  erroInterno: 'Tive um problema aqui. Pode tentar de novo?',
} as const;

/**
 * Resultado de toda chamada ao agente. O bot só apresenta: envia as actions,
 * desenha a proposta/pedido e usa o outcome para decidir botões. Nunca decide regra.
 */
export interface Resposta {
  outcome: string;
  actions: CoreAction[];
  session?: CoreSession;
  proposal?: Proposal;
  /** Segunda melhor combinação (itens diferentes), para o botão "Outra opção". */
  alternative?: Proposal;
  order?: AuthorizedOrder;
  problems?: ProblemaProposta[];
  /** Na proposta: escolhas do modelo descartadas pelo código. */
  discarded?: Descarte[];
  /** Na proposta: itens a confirmar com quem tem restrição (sem descrição no cardápio). */
  uncertain?: ItemIncerto[];
  /** Em mensagens(): o outcome de cada pessoa do lote, na ordem da primeira mensagem dela. */
  resultados?: { participantId: ParticipantId; outcome: string }[];
}

export interface AgenteDeps {
  catalog: CatalogPort;
  llm: LlmPort;
  /** Padrão: SessoesEmMemoria. */
  sessions?: SessionStore;
  /** Relógio em ISO 8601. Padrão: new Date().toISOString(). */
  now?: () => string;
  registrar?: (record: LlmCallRecord) => void;
  /** Erros inesperados (rede, bug). O agente responde com outcome "error". */
  onError?: (error: unknown) => void;
  timeoutMs?: number;
  maxCatalogAgeMs?: number;
  /**
   * Endereço de entrega padrão (texto livre, ex.: do .env). Ao iniciar, o core
   * valida pela porta e pergunta ao organizador [Sim] [Outro endereço]. Sem ele,
   * o core pede que o organizador digite o endereço.
   */
  enderecoPadrao?: string;
}

export interface Organizador {
  id: ParticipantId;
  displayName: string;
}

export interface Agente {
  /** Alguém mencionou o bot: abre a sessão do chat (ou devolve a que já está ativa). */
  iniciar(sessionId: SessionId, organizador: Organizador): Promise<Resposta>;
  /** Mensagem de alguém do grupo: preferência na coleta, pedido de ajuste na proposta. */
  mensagem(message: IncomingMessage, displayName?: string): Promise<Resposta>;
  /**
   * Várias mensagens do mesmo chat de uma vez (o bot junta com debounce; veja
   * criarAgrupador). Na coleta vira uma chamada ao modelo para até 10 pessoas;
   * na proposta, cada mensagem é interpretada como ajuste, em ordem.
   */
  mensagens(sessionId: SessionId, itens: readonly ItemLote[]): Promise<Resposta>;
  /** Botões [Sim] / [Confirmar] do endereço. Só o organizador. Trocar o endereço descarta a proposta. */
  confirmarEndereco(sessionId: SessionId, actorId: ParticipantId): Promise<Resposta>;
  /** Botões [Outro endereço] / [Corrigir]: o organizador vai digitar o endereço no privado. Só o organizador. */
  pedirOutroEndereco(sessionId: SessionId, actorId: ParticipantId): Promise<Resposta>;
  /** Monta (ou refaz) a proposta. Só o organizador; exige endereço confirmado. */
  propor(sessionId: SessionId, actorId: ParticipantId): Promise<Resposta>;
  /** Botão "Outra opção": troca a proposta pela alternativa (e de volta). Só o organizador. */
  outraOpcao(sessionId: SessionId, actorId: ParticipantId): Promise<Resposta>;
  /** Volta da proposta para a coleta (ex.: entrou gente nova). Só o organizador. */
  reabrirColeta(sessionId: SessionId, actorId: ParticipantId): Promise<Resposta>;
  /** Autoriza e fecha. Só o organizador; idempotente. Devolve o AuthorizedOrder. */
  fechar(sessionId: SessionId, actorId: ParticipantId): Promise<Resposta>;
  /** Cancela a sessão. Só o organizador. */
  cancelar(sessionId: SessionId, actorId: ParticipantId): Promise<Resposta>;
  /** Estado atual da sessão, se houver. */
  obter(sessionId: SessionId): Promise<CoreSession | undefined>;
}

const FINAIS = new Set(['closed', 'cancelled']);

/**
 * Fachada única do core para a interface (Telegram). Guarda sessões, roteia
 * cada mensagem conforme a fase e processa as chamadas de um mesmo chat uma
 * de cada vez, para duas pessoas falando juntas não sobrescreverem a sessão.
 */
export function criarAgente(deps: AgenteDeps): Agente {
  const sessions = deps.sessions ?? new SessoesEmMemoria();
  const now = deps.now ?? (() => new Date().toISOString());
  const filas = new Map<SessionId, Promise<unknown>>();
  const llmDeps = {
    llm: deps.llm,
    ...(deps.registrar && { registrar: deps.registrar }),
    ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
  };

  /** Executa fn depois das chamadas anteriores do mesmo chat. */
  function enfileirar(sessionId: SessionId, fn: () => Promise<Resposta>): Promise<Resposta> {
    const anterior = filas.get(sessionId) ?? Promise.resolve();
    const atual = anterior.then(fn, fn);
    filas.set(sessionId, atual);
    const limpar = () => {
      if (filas.get(sessionId) === atual) filas.delete(sessionId);
    };
    atual.then(limpar, limpar);
    return atual;
  }

  /** Converte erros esperados em outcome e protege o bot de exceções. */
  async function protegido(actorId: ParticipantId | undefined, sessionId: SessionId, fn: () => Promise<Resposta>): Promise<Resposta> {
    const privada = (text: string): CoreAction[] =>
      actorId ? [{ type: 'send_message', sessionId, participantId: actorId, text }] : [];
    try {
      return await fn();
    } catch (error) {
      if (error instanceof NaoAutorizadoError) return { outcome: 'not_authorized', actions: privada(TEXTOS.soOrganizador) };
      if (error instanceof TransicaoInvalidaError) return { outcome: 'invalid_state', actions: privada(TEXTOS.faseInvalida) };
      deps.onError?.(error);
      return { outcome: 'error', actions: privada(TEXTOS.erroInterno) };
    }
  }

  /** Carrega a sessão ativa ou devolve a resposta de "sem sessão"/"encerrada". */
  async function ativa(sessionId: SessionId, actorId?: ParticipantId): Promise<SessionRecord | Resposta> {
    const record = await sessions.get(sessionId);
    const privada = (text: string): CoreAction[] =>
      actorId ? [{ type: 'send_message', sessionId, participantId: actorId, text }] : [];
    if (!record) return { outcome: 'no_session', actions: privada(TEXTOS.semSessao) };
    if (FINAIS.has(record.session.status)) {
      return { outcome: 'session_finished', session: record.session, actions: privada(TEXTOS.sessaoEncerrada) };
    }
    return record;
  }
  const ehResposta = (x: SessionRecord | Resposta): x is Resposta => 'outcome' in x;

  function exigirOrganizador(session: CoreSession, actorId: ParticipantId, acao: string): void {
    if (session.organizerId !== actorId) throw new NaoAutorizadoError(actorId, acao);
  }

  async function salvar(
    record: SessionRecord,
    session: CoreSession,
    extra: { catalog?: SessionRecord['catalog'] | undefined; proposalCount?: number } = {},
  ): Promise<void> {
    const next: SessionRecord = { ...record, session, proposalCount: extra.proposalCount ?? record.proposalCount };
    if ('catalog' in extra) {
      if (extra.catalog) next.catalog = extra.catalog;
      else delete next.catalog;
    }
    await sessions.set(next);
  }

  /** Propor/fechar sem endereço confirmado: avisa e lembra o passo pendente do endereço. */
  function enderecoExigido(session: CoreSession, actorId: ParticipantId): Resposta {
    return {
      outcome: 'address_required',
      session,
      actions: [
        { type: 'send_message', sessionId: session.id, participantId: actorId, text: TEXTOS_ENDERECO.exigido },
        ...lembrarEndereco(session),
      ],
    };
  }

  return {
    iniciar: (sessionId, organizador) =>
      enfileirar(sessionId, () =>
        protegido(organizador.id, sessionId, async () => {
          const existente = await sessions.get(sessionId);
          if (existente && !FINAIS.has(existente.session.status)) {
            return { outcome: 'already_active', session: existente.session, actions: [] };
          }
          const session = criarSessao({
            id: sessionId,
            organizerId: organizador.id,
            participants: [{ id: organizador.id, displayName: organizador.displayName, preferences: {} }],
          });
          // O contador de propostas continua entre sessões do mesmo chat: o segundo pedido
          // do grupo gera "chat-p2", não "chat-p1" de novo (proposalId é a chave de idempotência).
          // Endereço: propõe o padrão (se válido) ou pede para digitar. A coleta começa já, sem esperar.
          const endereco = await iniciarEndereco(session, deps.catalog, deps.enderecoPadrao);
          await sessions.set({ session: endereco.session, proposalCount: existente?.proposalCount ?? 0 });
          return {
            outcome: 'started',
            session: endereco.session,
            actions: [...endereco.actions, { type: 'session_updated', session: endereco.session }],
          };
        }),
      ),

    mensagem: (message, displayName) =>
      enfileirar(message.sessionId, () =>
        protegido(message.participantId, message.sessionId, async () => {
          const record = await ativa(message.sessionId);
          if (ehResposta(record)) return record;

          // Esperando o endereço do organizador: a mensagem dele vai para a validação, nunca para a coleta.
          if (esperandoEnderecoDe(record.session, message.participantId)) {
            const endereco = await receberTextoEndereco(record.session, message.text, deps.catalog);
            await salvar(record, endereco.session);
            return { outcome: endereco.outcome, session: endereco.session, actions: endereco.actions };
          }

          if (record.session.status === 'collecting') {
            const result = await coletar(record.session, message, llmDeps, displayName);
            await salvar(record, result.session);
            return { outcome: result.outcome, session: result.session, actions: result.actions };
          }
          if (!record.catalog) throw new Error(`sessão ${message.sessionId} em revisão sem catálogo da proposta`);
          const result = await interpretarAjuste(record.session, message, record.catalog, llmDeps);
          await salvar(record, result.session);
          return {
            outcome: result.outcome,
            session: result.session,
            actions: result.actions,
            ...(result.session.proposal && { proposal: result.session.proposal }),
            ...(result.problems && { problems: result.problems }),
          };
        }),
      ),

    mensagens: (sessionId, itens) =>
      enfileirar(sessionId, () =>
        protegido(undefined, sessionId, async () => {
          if (itens.length === 0) return { outcome: 'empty', actions: [], resultados: [] };
          const record = await ativa(sessionId);
          if (ehResposta(record)) return record;

          let session = record.session;
          const actions: CoreAction[] = [];
          const resultados: { participantId: ParticipantId; outcome: string }[] = [];
          let restantes = itens;

          // Esperando o endereço do organizador: as mensagens dele no lote vão para a
          // validação (vale a última), nunca para a coleta. As dos outros seguem normalmente.
          const doOrganizador = itens.filter((i) => esperandoEnderecoDe(session, i.participantId));
          const ultima = doOrganizador.at(-1);
          if (ultima) {
            const endereco = await receberTextoEndereco(session, ultima.text, deps.catalog);
            session = endereco.session;
            actions.push(...endereco.actions.filter((a) => a.type !== 'session_updated'));
            resultados.push({ participantId: ultima.participantId, outcome: endereco.outcome });
            restantes = itens.filter((i) => i.participantId !== ultima.participantId);
          }

          if (restantes.length > 0 && session.status === 'collecting') {
            const result = await coletarLote(session, restantes, llmDeps);
            session = result.session;
            actions.push(...result.actions.filter((a) => a.type !== 'session_updated'));
            resultados.push(...result.resultados);
            restantes = [];
          }

          // Na proposta, cada mensagem é um possível ajuste, em ordem.
          if (restantes.length > 0) {
            const catalogo = record.catalog;
            if (!catalogo) throw new Error(`sessão ${sessionId} em revisão sem catálogo da proposta`);
            for (const item of restantes) {
              const r = await interpretarAjuste(session, { sessionId, participantId: item.participantId, text: item.text }, catalogo, llmDeps);
              session = r.session;
              resultados.push({ participantId: item.participantId, outcome: r.outcome });
              actions.push(...r.actions.filter((a) => a.type !== 'session_updated'));
            }
          }
          if (session !== record.session) actions.push({ type: 'session_updated', session });
          await salvar(record, session);
          return {
            outcome: 'batch',
            session,
            actions,
            resultados,
            ...(session.proposal && { proposal: session.proposal }),
          };
        }),
      ),

    propor: (sessionId, actorId) =>
      enfileirar(sessionId, () =>
        protegido(actorId, sessionId, async () => {
          const record = await ativa(sessionId, actorId);
          if (ehResposta(record)) return record;
          exigirOrganizador(record.session, actorId, 'montar a proposta');
          const endereco = enderecoConfirmado(record.session);
          if (!endereco) return enderecoExigido(record.session, actorId);

          const proposalCount = record.proposalCount + 1;
          const result = await propor(record.session, {
            ...llmDeps,
            catalog: deps.catalog,
            now: now(),
            address: endereco,
            proposalId: `${sessionId}-p${proposalCount}`,
          });
          if (!result.ok) {
            return {
              outcome: result.reason,
              session: record.session,
              actions: [{ type: 'send_message', sessionId, participantId: actorId, text: TEXTOS.semProposta }],
              ...(result.problems && { problems: result.problems }),
            };
          }
          await salvar(record, result.session, { catalog: result.catalog, proposalCount });
          return {
            outcome: 'proposed',
            session: result.session,
            proposal: result.proposal,
            ...(result.alternative && { alternative: result.alternative }),
            actions: result.actions,
            discarded: result.discarded,
            uncertain: result.uncertain,
          };
        }),
      ),

    confirmarEndereco: (sessionId, actorId) =>
      enfileirar(sessionId, () =>
        protegido(actorId, sessionId, async () => {
          const record = await ativa(sessionId, actorId);
          if (ehResposta(record)) return record;
          const r = confirmarEnderecoDaSessao(record.session, actorId);
          // Endereço mudou com proposta na mesa: a proposta (e o catálogo dela) deixam de valer.
          await salvar(record, r.session, r.proposalDiscarded ? { catalog: undefined } : {});
          return { outcome: r.outcome, session: r.session, actions: r.actions };
        }),
      ),

    pedirOutroEndereco: (sessionId, actorId) =>
      enfileirar(sessionId, () =>
        protegido(actorId, sessionId, async () => {
          const record = await ativa(sessionId, actorId);
          if (ehResposta(record)) return record;
          const r = pedirOutroEnderecoDaSessao(record.session, actorId);
          await salvar(record, r.session);
          return { outcome: r.outcome, session: r.session, actions: r.actions };
        }),
      ),

    outraOpcao: (sessionId, actorId) =>
      enfileirar(sessionId, () =>
        protegido(actorId, sessionId, async () => {
          const record = await ativa(sessionId, actorId);
          if (ehResposta(record)) return record;
          exigirOrganizador(record.session, actorId, 'trocar de opção');
          if (!record.session.alternative) {
            return {
              outcome: 'no_alternative',
              session: record.session,
              actions: [{ type: 'send_message', sessionId, participantId: actorId, text: TEXTOS.semAlternativa }],
            };
          }
          const session = trocarPorAlternativa(record.session);
          await salvar(record, session);
          return {
            outcome: 'switched',
            session,
            actions: [{ type: 'session_updated', session }],
            ...(session.proposal && { proposal: session.proposal }),
            ...(session.alternative && { alternative: session.alternative }),
          };
        }),
      ),

    reabrirColeta: (sessionId, actorId) =>
      enfileirar(sessionId, () =>
        protegido(actorId, sessionId, async () => {
          const record = await ativa(sessionId, actorId);
          if (ehResposta(record)) return record;
          exigirOrganizador(record.session, actorId, 'reabrir a coleta');
          const session = voltarParaColeta(record.session);
          await salvar(record, session);
          return { outcome: 'collecting', session, actions: [{ type: 'session_updated', session }] };
        }),
      ),

    fechar: (sessionId, actorId) =>
      enfileirar(sessionId, () =>
        protegido(actorId, sessionId, async () => {
          const record = await sessions.get(sessionId);
          if (!record) return { outcome: 'no_session', actions: [] };
          exigirOrganizador(record.session, actorId, 'fechar o pedido');

          let session = record.session;
          if (session.status === 'reviewing') session = pedirConfirmacao(session);
          const proposal = session.proposal;
          if (!proposal || !record.catalog) throw new TransicaoInvalidaError(session.status, 'closed');

          const momento = now();
          const endereco = enderecoConfirmado(session);
          if (session.status !== 'closed' && !endereco) return enderecoExigido(session, actorId);
          const catalogo =
            session.status === 'closed' || !endereco
              ? record.catalog
              : await atualizarCatalogo(deps.catalog, record.catalog, proposal.orders.map((o) => o.storeId), momento, endereco);
          const result = fechar(session, actorId, momento, catalogo, {
            ...(deps.maxCatalogAgeMs !== undefined && { maxCatalogAgeMs: deps.maxCatalogAgeMs }),
          });

          if (!result.ok) {
            // A sessão fica aguardando confirmação: dá para ajustar e tentar fechar de novo.
            await salvar(record, session);
            return { outcome: 'close_rejected', session, proposal, problems: result.problems, actions: [] };
          }
          await salvar(record, result.session);
          return {
            outcome: result.alreadyClosed ? 'already_closed' : 'closed',
            session: result.session,
            order: result.order,
            actions: result.actions,
          };
        }),
      ),

    cancelar: (sessionId, actorId) =>
      enfileirar(sessionId, () =>
        protegido(actorId, sessionId, async () => {
          const record = await ativa(sessionId, actorId);
          if (ehResposta(record)) return record;
          const session = cancelar(record.session, actorId);
          await salvar(record, session);
          return { outcome: 'cancelled', session, actions: [{ type: 'session_updated', session }] };
        }),
      ),

    obter: async (sessionId) => (await sessions.get(sessionId))?.session,
  };
}
