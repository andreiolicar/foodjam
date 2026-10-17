import { buscarCandidatas } from './catalogo.js';
import type { CoreAction, MenuItemId, ParticipantId, Proposal, ProposedItem } from './contracts.js';
import type { LlmCallRecord } from './llm.js';
import { LlmSaidaInvalidaError, gerarEstruturado } from './llm.js';
import type { CatalogPort, LlmPort } from './ports.js';
import { SISTEMA_PROPOSTA, montarPromptProposta } from './prompts/proposta.js';
import { idsElegiveis, itemIncerto, itensElegiveis } from './regras/elegibilidade.js';
import { montarPedidos } from './regras/montar-pedidos.js';
import { calcularRateio } from './regras/rateio.js';
import type { PickRejectionReason, TimedCatalogSnapshot } from './regras/validar-escolhas.js';
import { validarEscolhas } from './regras/validar-escolhas.js';
import type { ProblemaProposta } from './regras/verificar-proposta.js';
import { verificarProposta } from './regras/verificar-proposta.js';
import type { ModelOption } from './schemas.js';
import { ModelProposalSchema } from './schemas.js';
import type { CoreSession } from './sessao.js';
import { TransicaoInvalidaError, apresentarProposta } from './sessao.js';

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

/** Escolha do modelo descartada pelo código, com o motivo. */
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
      actions: CoreAction[];
    }
  | {
      ok: false;
      reason: 'no_participants' | 'no_candidates' | 'model_failed' | 'no_valid_option';
      catalog?: TimedCatalogSnapshot;
      problems?: ProblemaProposta[];
    };

interface OpcaoAvaliada {
  proposal?: Proposal;
  discarded: Descarte[];
  problems: ProblemaProposta[];
}

/**
 * Fase de proposta (sem tool calling):
 * 1. Recuperação em código pela CatalogPort.
 * 2. Filtro em código: cada pessoa só pode receber itens elegíveis
 *    (restrições, avoids, orçamento unitário, loja aberta, disponível).
 * 3. Modelo capable escolhe um item por pessoa, em até 2 lojas.
 * 4. Código valida cada opção, recalcula pedidos e rateio e escolhe a melhor
 *    por cobertura, depois menos lojas, depois menor total.
 */
export async function propor(session: CoreSession, deps: PropostaDeps): Promise<PropostaResult> {
  if (session.status !== 'collecting' && session.status !== 'reviewing') {
    throw new TransicaoInvalidaError(session.status, 'reviewing');
  }
  if (session.participants.length === 0) return { ok: false, reason: 'no_participants' };

  const catalog = await buscarCandidatas(deps.catalog, session.participants, deps.now);
  const participantes = session.participants.map((participant) => ({
    participant,
    itensPermitidos: itensElegiveis(participant, catalog),
  }));
  if (participantes.every((p) => p.itensPermitidos.length === 0)) {
    return { ok: false, reason: 'no_candidates', catalog };
  }

  let output;
  try {
    output = await gerarEstruturado({
      llm: deps.llm,
      phase: 'proposta',
      tier: 'capable',
      system: SISTEMA_PROPOSTA,
      prompt: montarPromptProposta(participantes, catalog.stores, session.pendingQuestions ?? []),
      outputName: 'proposta',
      schema: ModelProposalSchema,
      ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
      ...(deps.registrar && { registrar: deps.registrar }),
    });
  } catch (error) {
    if (!(error instanceof LlmSaidaInvalidaError)) throw error;
    return { ok: false, reason: 'model_failed', catalog };
  }

  const avaliadas = output.options.map((option) => avaliarOpcao(option, session, catalog, deps.proposalId));
  const melhor = avaliadas
    .filter((a): a is OpcaoAvaliada & { proposal: Proposal } => a.proposal !== undefined)
    .sort(compararPropostas)[0];
  if (!melhor) {
    return { ok: false, reason: 'no_valid_option', catalog, problems: avaliadas.flatMap((a) => a.problems) };
  }

  const uncertain = melhor.proposal.orders
    .flatMap((o) => o.items)
    .filter((item) => {
      const restricoes = session.participants.find((p) => p.id === item.participantId)?.preferences.dietaryRestrictions ?? [];
      const menuItem = catalog.menuItems.find((m) => m.id === item.menuItemId);
      return menuItem !== undefined && itemIncerto(menuItem, restricoes);
    })
    .map((item) => ({ participantId: item.participantId, menuItemId: item.menuItemId }));

  const next = apresentarProposta(session, melhor.proposal);
  return {
    ok: true,
    session: next,
    proposal: melhor.proposal,
    catalog,
    discarded: melhor.discarded,
    uncertain,
    actions: [{ type: 'session_updated', session: next }],
  };
}

/** Cobertura primeiro; empate: menos lojas; depois menor total. */
function compararPropostas(a: { proposal: Proposal }, b: { proposal: Proposal }): number {
  const cobertura = (p: Proposal) => p.split.shares.length;
  return (
    cobertura(b.proposal) - cobertura(a.proposal) ||
    a.proposal.orders.length - b.proposal.orders.length ||
    a.proposal.split.totalCents - b.proposal.split.totalCents
  );
}

/**
 * Valida uma opção do modelo: descarta escolhas fora dos itens elegíveis da
 * pessoa, repetidas ou fora do catálogo; preço sempre do catálogo. Quem
 * estoura o orçamento (item + parte da entrega) sai da opção e o rateio é
 * refeito. Outros problemas (pedido mínimo, 3ª loja...) invalidam a opção.
 */
function avaliarOpcao(option: ModelOption, session: CoreSession, catalog: TimedCatalogSnapshot, proposalId: string): OpcaoAvaliada {
  const discarded: Descarte[] = [];
  const elegiveis = new Map(session.participants.map((p) => [p.id, idsElegiveis(p, catalog)]));
  let items: ProposedItem[] = [];

  for (const pick of option.picks) {
    const descartar = (reason: DescarteReason) =>
      discarded.push({ participantId: pick.participantId, menuItemId: pick.menuItemId, reason });

    if (items.some((i) => i.participantId === pick.participantId)) {
      descartar('duplicate_pick');
      continue;
    }
    const { accepted, rejected } = validarEscolhas([pick], session, catalog);
    const [item] = accepted;
    if (!item) {
      descartar(rejected[0]?.reason ?? 'item_not_in_catalog');
    } else if (!elegiveis.get(pick.participantId)?.has(pick.menuItemId)) {
      descartar('not_eligible');
    } else {
      items.push(item);
    }
  }

  for (;;) {
    if (items.length === 0) return { discarded, problems: [] };

    const orders = montarPedidos(items, catalog.stores);
    const proposal: Proposal = {
      id: proposalId,
      sessionId: session.id,
      orders,
      split: calcularRateio(orders),
      uncoveredParticipantIds: session.participants.map((p) => p.id).filter((id) => !items.some((i) => i.participantId === id)),
      justification: option.justification,
    };

    const problems = verificarProposta(proposal, session, catalog);
    if (problems.length === 0) return { proposal, discarded, problems };

    if (!problems.every((p) => p.code === 'over_budget')) return { discarded, problems };
    const estouraram = new Set(problems.flatMap((p) => (p.code === 'over_budget' ? [p.participantId] : [])));

    for (const item of items.filter((i) => estouraram.has(i.participantId))) {
      discarded.push({ participantId: item.participantId, menuItemId: item.menuItemId, reason: 'over_budget' });
    }
    items = items.filter((i) => !estouraram.has(i.participantId));
  }
}
