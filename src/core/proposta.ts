import { buscarCandidatas } from './catalogo.js';
import { MAX_ITENS_POR_PESSOA } from './coleta.js';
import type { CoreAction, MenuItem, MenuItemId, Participant, ParticipantId, Proposal, ProposedItem, StoreId } from './contracts.js';
import type { LlmCallRecord } from './llm.js';
import { LlmSaidaInvalidaError, gerarEstruturado } from './llm.js';
import type { CatalogPort, LlmPort } from './ports.js';
import type { PessoaPrompt, ResumoEscolha } from './prompts/proposta.js';
import {
  SISTEMA_CLASSIFICACAO,
  SISTEMA_JUSTIFICATIVA,
  justificativaPadrao,
  montarPromptClassificacao,
  montarPromptJustificativa,
} from './prompts/proposta.js';
import type { DesejoClassificado, Escolha, Metricas, PessoaClassificada } from './regras/combinacoes.js';
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

/** Texto provisório só para validar a proposta antes da justificativa final. */
export const JUSTIFICATIVA_PADRAO = 'Combinação de lojas que melhor atende o pedido de cada um.';

export interface PropostaDeps {
  catalog: CatalogPort;
  llm: LlmPort;
  /** ISO 8601 da consulta ao catálogo. */
  now: string;
  /** Id da nova proposta, gerado por quem chama. A alternativa recebe o sufixo "-b". */
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
      /** Segunda melhor combinação, com itens diferentes ("Outra opção"). */
      alternative?: Proposal;
      catalog: TimedCatalogSnapshot;
      discarded: Descarte[];
      uncertain: ItemIncerto[];
      metricas: Metricas;
      metricasAlternativa?: Metricas;
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

interface OpcaoValida {
  proposal: Proposal;
  metricas: Metricas;
  escolhas: Escolha[];
  descartes: Descarte[];
}

/**
 * Fase de proposta:
 * 1. Recuperação em código pela CatalogPort e filtro de itens elegíveis por
 *    pessoa (restrições, avoids, orçamento unitário, loja aberta, disponível).
 * 2. Modelo capable (1 chamada): para cada desejo de cada pessoa, classifica
 *    itens elegíveis em "atende", "substituto" ou "não serve".
 * 3. Código enumera todas as combinações de 1 e 2 lojas, escolhe o melhor
 *    item por desejo, confere pedido mínimo e orçamento, ordena as
 *    combinações (compararMetricas) e fica com a melhor e a alternativa.
 * 4. Modelo fast (1 chamada): uma frase objetiva para cada uma, a partir
 *    dos motivos que o código calculou. Se falhar, o código escreve a frase.
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

  const validas: OpcaoValida[] = [];
  const problemas: ProblemaProposta[] = [];
  for (const combinacao of combinacoes) {
    const escolhas = escolherNaCombinacao(combinacao, classificadas, lojaDoItem);
    const avaliada = avaliarCombinacao(escolhas, session, catalog, classificadas, itemPorId, deps.proposalId);
    if (avaliada.opcao) validas.push(avaliada.opcao);
    else problemas.push(...avaliada.problems);
  }
  validas.sort((a, b) => compararMetricas(a.metricas, b.metricas));
  const [melhor] = validas;
  if (!melhor) return { ok: false, reason: 'no_valid_option', catalog, problems: unicos(problemas) };

  // Alternativa: a próxima combinação com um conjunto de itens diferente.
  const assinatura = (o: OpcaoValida) =>
    o.escolhas.map((e) => `${e.participantId}:${e.menuItemId}`).sort().join('|');
  const alternativa = validas.find((o) => assinatura(o) !== assinatura(melhor));
  discarded.push(...melhor.descartes);

  // Resumo factual de cada opção (quem ficou com substituto ou sem item, e por quê).
  const nomeLoja = new Map(catalog.stores.map((s) => [s.id, s.name]));
  const nomeDe = (id: ParticipantId) => session.participants.find((p) => p.id === id)?.displayName ?? id;
  const resumir = (opcao: OpcaoValida): ResumoEscolha => {
    const lojasEscolhidas = new Set(opcao.proposal.orders.map((o) => o.storeId));
    const motivoSubstituto = (desejo: DesejoClassificado | undefined): string => {
      if (!desejo || desejo.atende.length === 0) return 'nenhum item do cardápio atende o pedido';
      const fora = [...new Set(desejo.atende.map((id) => lojaDoItem.get(id)).filter((s): s is StoreId => !!s && !lojasEscolhidas.has(s)))];
      return fora.length > 0
        ? `o item pedido só existe em ${fora.map((s) => nomeLoja.get(s) ?? s).join(' ou ')}, fora das lojas escolhidas`
        : 'o item pedido não está disponível nas lojas escolhidas';
    };
    return {
      lojas: opcao.proposal.orders.map((o) => nomeLoja.get(o.storeId) ?? o.storeId),
      pessoas: session.participants
        .filter((p) => opcao.escolhas.some((e) => e.participantId === p.id))
        .map((p) => ({
          nome: p.displayName,
          itens: opcao.escolhas
            .filter((e) => e.participantId === p.id)
            .map((e) => ({
              item: itemPorId.get(e.menuItemId)?.name ?? e.menuItemId,
              loja: nomeLoja.get(e.storeId) ?? e.storeId,
              substituto: e.isSubstitute,
              ...(e.isSubstitute && {
                motivo: motivoSubstituto(classificadas.find((c) => c.participantId === p.id)?.desejos[e.desejo]),
              }),
            })),
        })),
      semItem: opcao.proposal.uncoveredParticipantIds.map((id) => ({
        nome: nomeDe(id),
        motivo: opcao.descartes.some((d) => d.participantId === id && d.reason === 'over_budget')
          ? 'passaria do orçamento'
          : classificadas.some((c) => c.participantId === id)
            ? 'nenhuma opção nas lojas escolhidas'
            : 'nenhum item do catálogo respeita as restrições e o orçamento',
      })),
    };
  };

  const resumoMelhor = resumir(melhor);
  const resumoAlternativa = alternativa ? resumir(alternativa) : null;
  const textos = await justificar(resumoMelhor, resumoAlternativa, session, llmOpcoes);

  const proposal: Proposal = { ...melhor.proposal, justification: textos.principal };
  const alternative: Proposal | undefined =
    alternativa && resumoAlternativa
      ? { ...alternativa.proposal, id: `${deps.proposalId}-b`, justification: textos.alternativa ?? justificativaPadrao(resumoAlternativa) }
      : undefined;

  const uncertain = proposal.orders
    .flatMap((o) => o.items)
    .filter((item) => {
      const restricoes = session.participants.find((p) => p.id === item.participantId)?.preferences.dietaryRestrictions ?? [];
      const menuItem = itemPorId.get(item.menuItemId);
      return menuItem !== undefined && itemIncerto(menuItem, restricoes);
    })
    .map((item) => ({ participantId: item.participantId, menuItemId: item.menuItemId }));

  const next = apresentarProposta(session, proposal, alternative);
  return {
    ok: true,
    session: next,
    proposal,
    ...(alternative && alternativa && { alternative, metricasAlternativa: alternativa.metricas }),
    catalog,
    discarded,
    uncertain,
    metricas: melhor.metricas,
    combinacoesAvaliadas: combinacoes.length,
    actions: [{ type: 'session_updated', session: next }],
  };
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
): { opcao?: OpcaoValida; problems: ProblemaProposta[] } {
  let escolhas = [...escolhasIniciais];
  const descartes: Descarte[] = [];

  for (;;) {
    if (escolhas.length === 0) return { problems: [] };
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
      return {
        opcao: { proposal, metricas: medir(escolhas, classificadas, orders.length, proposal.split.totalCents), escolhas, descartes },
        problems,
      };
    }
    if (!problems.every((p) => p.code === 'over_budget')) return { problems };

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

/** 2ª chamada (fast): uma frase por opção. Se falhar, o código escreve a frase. */
async function justificar(
  escolha: ResumoEscolha,
  alternativa: ResumoEscolha | null,
  session: CoreSession,
  llmOpcoes: { llm: LlmPort; timeoutMs?: number; registrar?: (record: LlmCallRecord) => void },
): Promise<{ principal: string; alternativa: string | null }> {
  try {
    const saida = await gerarEstruturado({
      ...llmOpcoes,
      phase: 'proposta_justificativa',
      tier: 'fast',
      system: SISTEMA_JUSTIFICATIVA,
      prompt: montarPromptJustificativa(escolha, alternativa, session.pendingQuestions ?? []),
      outputName: 'proposta_justificativa',
      schema: JustificativaSchema,
    });
    return { principal: saida.justification, alternativa: alternativa ? saida.alternativeJustification : null };
  } catch (error) {
    if (!(error instanceof LlmSaidaInvalidaError)) throw error;
    return { principal: justificativaPadrao(escolha), alternativa: alternativa ? justificativaPadrao(alternativa) : null };
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
