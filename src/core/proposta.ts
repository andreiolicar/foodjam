import { buscarCandidatas } from './catalogo.js';
import { MAX_ITENS_POR_PESSOA } from './coleta.js';
import type { CoreAction, MenuItem, MenuItemId, Participant, ParticipantId, Proposal, ProposedItem } from './contracts.js';
import type { LlmCallRecord } from './llm.js';
import { LlmSaidaInvalidaError, gerarEstruturado } from './llm.js';
import type { CatalogPort, LlmPort } from './ports.js';
import type { PessoaPrompt, ResumoEscolha } from './prompts/proposta.js';
import {
  SISTEMA_CLASSIFICACAO,
  SISTEMA_JUSTIFICATIVA,
  montarPromptClassificacao,
  montarPromptJustificativa,
} from './prompts/proposta.js';
import type { Escolha, Metricas, PessoaClassificada } from './regras/combinacoes.js';
import { compararMetricas, enumerarCombinacoes, escolherNaCombinacao, medir } from './regras/combinacoes.js';
import { itemIncerto, itensElegiveis } from './regras/elegibilidade.js';
import { montarPedidos } from './regras/montar-pedidos.js';
import { calcularRateio } from './regras/rateio.js';
import type { PickRejectionReason, TimedCatalogSnapshot } from './regras/validar-escolhas.js';
import type { ProblemaProposta } from './regras/verificar-proposta.js';
import { verificarProposta } from './regras/verificar-proposta.js';
import { JustificativaSchema, criarClassificacaoSchema } from './schemas.js';
import type { CoreSession } from './sessao.js';
import { TransicaoInvalidaError, apresentarProposta } from './sessao.js';

export const JUSTIFICATIVA_PADRAO = 'Montei a combinação de lojas que melhor atende o pedido de cada um.';

export interface PropostaDeps {
  catalog: CatalogPort;
  llm: LlmPort;
  /** ISO 8601 da consulta ao catálogo. */
  now: string;
  /** Id da nova proposta, gerado por quem chama. */
  proposalId: string;
  registrar?: (record: LlmCallRecord) => void;
  timeoutMs?: number;
}

export type DescarteReason = PickRejectionReason | 'not_eligible' | 'duplicate_pick' | 'over_budget';

/** Item que o modelo citou ou o código escolheu e foi descartado, com o motivo. */
export interface Descarte {
  participantId: ParticipantId;
  menuItemId: MenuItemId;
  reason: DescarteReason;
}

/** Item que passou nas regras, mas sem descrição que confirme a restrição da pessoa. */
export interface ItemIncerto {
  participantId: ParticipantId;
  menuItemId: MenuItemId;
}

export type PropostaResult =
  | {
      ok: true;
      session: CoreSession;
      proposal: Proposal;
      catalog: TimedCatalogSnapshot;
      discarded: Descarte[];
      uncertain: ItemIncerto[];
      /** Métricas da opção escolhida e quantas combinações foram avaliadas. */
      metricas: Metricas;
      combinacoesAvaliadas: number;
      actions: CoreAction[];
    }
  | {
      ok: false;
      reason: 'no_participants' | 'no_candidates' | 'model_failed' | 'no_valid_option';
      catalog?: TimedCatalogSnapshot;
      problems?: ProblemaProposta[];
    };

/** Desejos da pessoa: wishes (até 3) ou, sem eles, um desejo geral a partir do gosto. */
export function desejosDe(participant: Participant): string[] {
  const wishes = (participant.preferences.wishes ?? []).map((w) => w.trim()).filter(Boolean);
  if (wishes.length > 0) return [...new Set(wishes)].slice(0, MAX_ITENS_POR_PESSOA);
  const gosto = participant.preferences.foodPreferences ?? [];
  return [gosto.length > 0 ? gosto.join(', ') : 'qualquer comida'];
}

/**
 * Fase de proposta:
 * 1. Recuperação em código pela CatalogPort e filtro de itens elegíveis por
 *    pessoa (restrições, avoids, orçamento unitário, loja aberta, disponível).
 * 2. Modelo capable (1 chamada): para cada desejo de cada pessoa, classifica
 *    itens elegíveis em "atende", "substituto" ou "não serve".
 * 3. Código enumera todas as combinações de 1 e 2 lojas, escolhe o melhor
 *    item por desejo, confere pedido mínimo e orçamento e escolhe a melhor
 *    combinação (compararMetricas).
 * 4. Modelo fast (1 chamada): só a justificativa curta da opção escolhida.
 */
export async function propor(session: CoreSession, deps: PropostaDeps): Promise<PropostaResult> {
  if (session.status !== 'collecting' && session.status !== 'reviewing') {
    throw new TransicaoInvalidaError(session.status, 'reviewing');
  }
  if (session.participants.length === 0) return { ok: false, reason: 'no_participants' };

  const catalog = await buscarCandidatas(deps.catalog, session.participants, deps.now);
  const pessoas: PessoaPrompt[] = session.participants
    .map((participant) => ({ participant, desejos: desejosDe(participant), itensPermitidos: itensElegiveis(participant, catalog) }))
    .filter((p) => p.itensPermitidos.length > 0);
  if (pessoas.length === 0) return { ok: false, reason: 'no_candidates', catalog };

  const llmOpcoes = {
    llm: deps.llm,
    ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
    ...(deps.registrar && { registrar: deps.registrar }),
  };

  let classificacao;
  try {
    classificacao = await gerarEstruturado({
      ...llmOpcoes,
      phase: 'proposta_classificacao',
      tier: 'capable',
      system: SISTEMA_CLASSIFICACAO,
      prompt: montarPromptClassificacao(pessoas, catalog.stores),
      outputName: 'proposta_classificacao',
      schema: criarClassificacaoSchema(new Map(pessoas.map((p) => [p.participant.id, p.desejos.length]))),
    });
  } catch (error) {
    if (!(error instanceof LlmSaidaInvalidaError)) throw error;
    return { ok: false, reason: 'model_failed', catalog };
  }

  // Guardrail: só ids elegíveis da própria pessoa; o resto é descartado.
  const discarded: Descarte[] = [];
  const classificadas: PessoaClassificada[] = classificacao.pessoas.map((p) => {
    const permitidos = new Set(pessoas.find((x) => x.participant.id === p.participantId)?.itensPermitidos.map((i) => i.id));
    const filtrar = (ids: readonly string[]) =>
      [...new Set(ids)].filter((id) => {
        if (permitidos.has(id)) return true;
        discarded.push({ participantId: p.participantId, menuItemId: id, reason: 'not_eligible' });
        return false;
      });
    return { participantId: p.participantId, desejos: p.desejos.map((d) => ({ atende: filtrar(d.atende), substitutos: filtrar(d.substitutos) })) };
  });

  const itemPorId = new Map(catalog.menuItems.map((i) => [i.id, i]));
  const lojaDoItem = new Map(catalog.menuItems.map((i) => [i.id, i.storeId]));
  const combinacoes = enumerarCombinacoes(catalog.stores.map((s) => s.id));

  let melhor: { proposal: Proposal; metricas: Metricas; descartes: Descarte[] } | undefined;
  const problemas: ProblemaProposta[] = [];
  for (const combinacao of combinacoes) {
    const escolhas = escolherNaCombinacao(combinacao, classificadas, lojaDoItem);
    const avaliada = avaliarCombinacao(escolhas, session, catalog, classificadas, itemPorId, deps.proposalId);
    if (!avaliada.proposal) {
      problemas.push(...avaliada.problems);
      continue;
    }
    if (!melhor || compararMetricas(avaliada.metricas, melhor.metricas) < 0) {
      melhor = { proposal: avaliada.proposal, metricas: avaliada.metricas, descartes: avaliada.descartes };
    }
  }
  if (!melhor) return { ok: false, reason: 'no_valid_option', catalog, problems: unicos(problemas) };
  discarded.push(...melhor.descartes);

  const justification = await justificar(melhor.proposal, session, catalog, llmOpcoes);
  const proposal: Proposal = { ...melhor.proposal, justification };

  const uncertain = proposal.orders
    .flatMap((o) => o.items)
    .filter((item) => {
      const restricoes = session.participants.find((p) => p.id === item.participantId)?.preferences.dietaryRestrictions ?? [];
      const menuItem = itemPorId.get(item.menuItemId);
      return menuItem !== undefined && itemIncerto(menuItem, restricoes);
    })
    .map((item) => ({ participantId: item.participantId, menuItemId: item.menuItemId }));

  const next = apresentarProposta(session, proposal);
  return {
    ok: true,
    session: next,
    proposal,
    catalog,
    discarded,
    uncertain,
    metricas: melhor.metricas,
    combinacoesAvaliadas: combinacoes.length,
    actions: [{ type: 'session_updated', session: next }],
  };
}

interface Avaliacao {
  proposal?: Proposal;
  metricas: Metricas;
  problems: ProblemaProposta[];
  descartes: Descarte[];
}

/**
 * Transforma as escolhas de uma combinação em proposta e valida. Quem passa
 * do orçamento perde um item por vez (primeiro substitutos, depois o último)
 * até caber. Pedido mínimo não atingido ou outro problema invalidam a combinação.
 */
function avaliarCombinacao(
  escolhasIniciais: readonly Escolha[],
  session: CoreSession,
  catalog: TimedCatalogSnapshot,
  classificadas: readonly PessoaClassificada[],
  itemPorId: ReadonlyMap<MenuItemId, MenuItem>,
  proposalId: string,
): Avaliacao {
  let escolhas = [...escolhasIniciais];
  const descartes: Descarte[] = [];
  const vazia = { metricas: medir([], classificadas, 0, 0), problems: [], descartes };

  for (;;) {
    if (escolhas.length === 0) return vazia;
    const items: ProposedItem[] = escolhas.map((e) => ({
      participantId: e.participantId,
      storeId: e.storeId,
      menuItemId: e.menuItemId,
      quantity: 1,
      unitPriceCents: itemPorId.get(e.menuItemId)?.priceCents ?? 0,
      ...(e.isSubstitute && { isSubstitute: true }),
    }));
    const orders = montarPedidos(items, catalog.stores);
    const proposal: Proposal = {
      id: proposalId,
      sessionId: session.id,
      orders,
      split: calcularRateio(orders),
      uncoveredParticipantIds: session.participants.map((p) => p.id).filter((id) => !items.some((i) => i.participantId === id)),
      justification: JUSTIFICATIVA_PADRAO,
    };

    const problems = verificarProposta(proposal, session, catalog);
    if (problems.length === 0) {
      return { proposal, metricas: medir(escolhas, classificadas, orders.length, proposal.split.totalCents), problems, descartes };
    }
    if (!problems.every((p) => p.code === 'over_budget')) {
      return { metricas: vazia.metricas, problems, descartes };
    }

    for (const problema of problems) {
      if (problema.code !== 'over_budget') continue;
      const daPessoa = escolhas.filter((e) => e.participantId === problema.participantId);
      const remover = daPessoa.find((e) => e.isSubstitute) ?? daPessoa.at(-1);
      if (!remover) continue;
      descartes.push({ participantId: remover.participantId, menuItemId: remover.menuItemId, reason: 'over_budget' });
      escolhas = escolhas.filter((e) => e !== remover);
    }
  }
}

/** 2ª chamada (fast): justificativa curta. Se falhar, texto padrão. */
async function justificar(
  proposal: Proposal,
  session: CoreSession,
  catalog: TimedCatalogSnapshot,
  llmOpcoes: { llm: LlmPort; timeoutMs?: number; registrar?: (record: LlmCallRecord) => void },
): Promise<string> {
  const nomeLoja = new Map(catalog.stores.map((s) => [s.id, s.name]));
  const nomeItem = new Map(catalog.menuItems.map((i) => [i.id, i.name]));
  const itens = proposal.orders.flatMap((o) => o.items);
  const resumo: ResumoEscolha = {
    lojas: proposal.orders.map((o) => nomeLoja.get(o.storeId) ?? o.storeId),
    pessoas: session.participants
      .filter((p) => itens.some((i) => i.participantId === p.id))
      .map((p) => ({
        nome: p.displayName,
        itens: itens
          .filter((i) => i.participantId === p.id)
          .map((i) => ({ item: nomeItem.get(i.menuItemId) ?? i.menuItemId, loja: nomeLoja.get(i.storeId) ?? i.storeId, substituto: Boolean(i.isSubstitute) })),
      })),
    semItem: proposal.uncoveredParticipantIds.map((id) => session.participants.find((p) => p.id === id)?.displayName ?? id),
  };

  try {
    const saida = await gerarEstruturado({
      ...llmOpcoes,
      phase: 'proposta_justificativa',
      tier: 'fast',
      system: SISTEMA_JUSTIFICATIVA,
      prompt: montarPromptJustificativa(resumo, session.pendingQuestions ?? []),
      outputName: 'proposta_justificativa',
      schema: JustificativaSchema,
    });
    return saida.justification;
  } catch (error) {
    if (!(error instanceof LlmSaidaInvalidaError)) throw error;
    return JUSTIFICATIVA_PADRAO;
  }
}

function unicos(problemas: readonly ProblemaProposta[]): ProblemaProposta[] {
  const vistos = new Set<string>();
  return problemas.filter((p) => {
    const chave = JSON.stringify(p);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}
