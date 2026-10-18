import { MAX_MESSAGE_LENGTH, TEXTO_FALHA_MODELO, passaNoFiltro } from './coleta.js';
import type { CoreAction, IncomingMessage, MenuItemId, ParticipantId, Proposal, ProposedItem, StoreId } from './contracts.js';
import type { LlmCallRecord } from './llm.js';
import { LlmSaidaInvalidaError, gerarEstruturado } from './llm.js';
import type { LlmPort } from './ports.js';
import { SISTEMA_AJUSTE, montarPromptAjuste } from './prompts/ajuste.js';
import { itensElegiveis } from './regras/elegibilidade.js';
import { montarPedidos } from './regras/montar-pedidos.js';
import { calcularRateio } from './regras/rateio.js';
import type { CatalogSnapshot } from './regras/validar-escolhas.js';
import { validarEscolhas } from './regras/validar-escolhas.js';
import type { ProblemaProposta } from './regras/verificar-proposta.js';
import { verificarProposta } from './regras/verificar-proposta.js';
import { AjusteOutputSchema, MAX_QUANTITY } from './schemas.js';
import type { CoreSession } from './sessao.js';
import { TransicaoInvalidaError, apresentarProposta } from './sessao.js';

/** Troca pedida por um participante: o item novo entra no lugar de um item dele. */
export interface Troca {
  participantId: ParticipantId;
  storeId: StoreId;
  menuItemId: MenuItemId;
  /**
   * Item atual da pessoa que sai. Opcional se ela tem um item só (ou nenhum:
   * o novo é acrescentado). Com vários itens, sem ele o ajuste devolve which_item.
   */
  replaceMenuItemId?: MenuItemId;
  /** Padrão: 1. */
  quantity?: number;
}

export type AjusteResult =
  | { ok: true; session: CoreSession; proposal: Proposal; actions: CoreAction[] }
  | { ok: false; problems: ProblemaProposta[] };

/** "p1" → "p1-r1" → "p1-r2": nova revisão a cada ajuste, sem ler relógio nem gerar aleatório. */
export function proximaRevisao(id: string): string {
  const match = /^(.*)-r(\d+)$/.exec(id);
  return match ? `${match[1]}-r${Number(match[2]) + 1}` : `${id}-r1`;
}

/**
 * Troca o item de um participante e recalcula pedidos e rateio em código.
 * Funciona na revisão ou na confirmação; em ambos os casos a sessão volta
 * para reviewing, porque a proposta mudou e precisa de nova confirmação.
 * Se a nova proposta tiver problema (item inválido, 3ª loja, pedido mínimo,
 * orçamento...), nada muda e os problemas são devolvidos.
 */
export function ajustar(session: CoreSession, troca: Troca, catalog: CatalogSnapshot): AjusteResult {
  const current = session.proposal;
  if (!current || (session.status !== 'reviewing' && session.status !== 'awaiting_confirmation')) {
    throw new TransicaoInvalidaError(session.status, 'reviewing');
  }

  const quantity = troca.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new RangeError(`quantity deve ser inteiro de 1 a ${MAX_QUANTITY}; recebido: ${String(quantity)}`);
  }

  const pick = { participantId: troca.participantId, storeId: troca.storeId, menuItemId: troca.menuItemId, quantity };
  const { accepted, rejected } = validarEscolhas([pick], session, catalog);
  const [novoItem] = accepted;
  if (!novoItem) {
    return {
      ok: false,
      problems: rejected.map((r) => ({
        code: 'item_rejected' as const,
        participantId: r.pick.participantId,
        menuItemId: r.pick.menuItemId,
        reason: r.reason,
      })),
    };
  }

  // Qual item da pessoa sai: o indicado; sem indicação, o único que ela tem.
  const atuais = current.orders.flatMap((o) => o.items);
  const daPessoa = atuais.filter((i) => i.participantId === troca.participantId).map((i) => i.menuItemId);
  const sai = troca.replaceMenuItemId ?? (daPessoa.length === 1 ? daPessoa[0] : undefined);
  if (daPessoa.length > 0 && (sai === undefined || !daPessoa.includes(sai))) {
    return { ok: false, problems: [{ code: 'which_item', participantId: troca.participantId, menuItemIds: daPessoa }] };
  }

  // Substitui no lugar do item que sai, para não mudar a ordem do rateio; sem item, acrescenta.
  let substituido = false;
  const items: ProposedItem[] = atuais.map((item) => {
    if (substituido || item.participantId !== troca.participantId || item.menuItemId !== sai) return item;
    substituido = true;
    return novoItem;
  });
  if (!substituido) items.push(novoItem);

  const orders = montarPedidos(items, catalog.stores);
  const proposal: Proposal = {
    ...current,
    id: proximaRevisao(current.id),
    orders,
    split: calcularRateio(orders),
    uncoveredParticipantIds: current.uncoveredParticipantIds.filter((id) => id !== troca.participantId),
  };

  const problems = verificarProposta(proposal, session, catalog);
  if (problems.length > 0) return { ok: false, problems };

  const next = apresentarProposta(session, proposal);
  return { ok: true, session: next, proposal, actions: [{ type: 'session_updated', session: next }] };
}

// ---------------------------------------------------------------------------
// Ajuste em texto: o modelo aponta qual opção a pessoa quer; o código valida
// e chama ajustar. A pessoa só troca o próprio item.
// ---------------------------------------------------------------------------

export type InterpretacaoOutcome =
  | 'filtered'
  | 'not_participant'
  | 'not_adjustment'
  | 'clarification'
  | 'adjusted'
  | 'rejected'
  | 'model_failed';

export interface InterpretacaoAjusteResult {
  session: CoreSession;
  actions: CoreAction[];
  outcome: InterpretacaoOutcome;
  problems?: ProblemaProposta[];
}

export interface InterpretacaoDeps {
  llm: LlmPort;
  registrar?: (record: LlmCallRecord) => void;
  timeoutMs?: number;
}

const MOTIVOS: Record<ProblemaProposta['code'], string> = {
  wrong_session: 'a proposta é de outra sessão',
  invalid_proposal: 'a proposta ficaria inválida (por exemplo, com mais de 2 lojas)',
  item_rejected: 'esse item não está disponível para você',
  price_changed: 'o preço mudou no catálogo',
  delivery_fee_changed: 'a taxa de entrega mudou',
  below_minimum: 'a loja não atingiria o pedido mínimo',
  split_mismatch: 'o rateio não fechou',
  over_budget: 'passaria do seu orçamento',
  stale_catalog: 'o catálogo precisa ser consultado de novo',
  address_not_confirmed: 'o endereço de entrega ainda não foi confirmado',
  which_item: 'não ficou claro qual dos seus itens trocar',
};

/** Texto curto, sem valores, para explicar por que o ajuste não foi feito. */
export function descreverProblemas(problems: readonly ProblemaProposta[]): string {
  const motivos = [...new Set(problems.map((p) => MOTIVOS[p.code]))];
  return `Não consegui fazer essa troca: ${motivos.join('; ')}.`;
}

/** Pergunta escrita pelo código (não pelo modelo) quando não dá para saber qual item trocar. */
export function perguntarQualItem(nomes: readonly string[]): string {
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} ou ${nomes.at(-1)}` : (nomes[0] ?? '');
  return `Qual item você quer trocar: ${lista}?`;
}

export async function interpretarAjuste(
  session: CoreSession,
  message: IncomingMessage,
  catalog: CatalogSnapshot,
  deps: InterpretacaoDeps,
): Promise<InterpretacaoAjusteResult> {
  if (message.sessionId !== session.id) {
    throw new Error(`mensagem da sessão ${message.sessionId} enviada para a sessão ${session.id}`);
  }
  if (!session.proposal || (session.status !== 'reviewing' && session.status !== 'awaiting_confirmation')) {
    throw new TransicaoInvalidaError(session.status, 'reviewing');
  }

  const text = message.text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!passaNoFiltro(text)) return { session, actions: [], outcome: 'filtered' };

  const participant = session.participants.find((p) => p.id === message.participantId);
  if (!participant) return { session, actions: [], outcome: 'not_participant' };

  const privada = (texto: string): CoreAction => ({
    type: 'send_message',
    sessionId: session.id,
    participantId: participant.id,
    text: texto,
  });

  const opcoes = itensElegiveis(participant, catalog);
  const idsAtuais = session.proposal.orders.flatMap((o) => o.items).filter((i) => i.participantId === participant.id).map((i) => i.menuItemId);
  const itensAtuais = idsAtuais.flatMap((id) => catalog.menuItems.filter((m) => m.id === id));

  let output;
  try {
    output = await gerarEstruturado({
      llm: deps.llm,
      phase: 'ajuste',
      tier: 'fast',
      system: SISTEMA_AJUSTE,
      prompt: montarPromptAjuste(text, itensAtuais, opcoes, catalog.stores),
      outputName: 'ajuste',
      schema: AjusteOutputSchema,
      ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
      ...(deps.registrar && { registrar: deps.registrar }),
    });
  } catch (error) {
    if (!(error instanceof LlmSaidaInvalidaError)) throw error;
    return { session, actions: [privada(TEXTO_FALHA_MODELO)], outcome: 'model_failed' };
  }

  if (output.kind === 'not_adjustment') return { session, actions: [], outcome: 'not_adjustment' };
  if (output.kind === 'ambiguous' || output.menuItemId === null) {
    return { session, actions: [privada(output.clarification ?? TEXTO_FALHA_MODELO)], outcome: 'clarification' };
  }

  const escolhido = opcoes.find((i) => i.id === output.menuItemId);
  if (!escolhido) {
    const problems: ProblemaProposta[] = [
      { code: 'item_rejected', participantId: participant.id, menuItemId: output.menuItemId, reason: 'not_eligible' },
    ];
    return { session, actions: [privada(descreverProblemas(problems))], outcome: 'rejected', problems };
  }

  const result = ajustar(
    session,
    {
      participantId: participant.id,
      storeId: escolhido.storeId,
      menuItemId: escolhido.id,
      ...(output.replaceMenuItemId !== null && { replaceMenuItemId: output.replaceMenuItemId }),
      ...(output.quantity !== null && { quantity: output.quantity }),
    },
    catalog,
  );
  if (!result.ok) {
    // Vários itens e não ficou claro qual sai: pergunta em vez de adivinhar.
    const qualItem = result.problems.find((p) => p.code === 'which_item');
    if (qualItem) {
      const nomes = itensAtuais.map((i) => i.name);
      return { session, actions: [privada(perguntarQualItem(nomes))], outcome: 'clarification', problems: result.problems };
    }
    return { session, actions: [privada(descreverProblemas(result.problems))], outcome: 'rejected', problems: result.problems };
  }
  return { session: result.session, actions: result.actions, outcome: 'adjusted' };
}
