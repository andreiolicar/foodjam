import { proximaRevisao } from './ajuste.js';
import type { CoreAction, DeliveryAddress, MenuItemId, MoneyCents, ParticipantId, Proposal, ProposedItem, StoreId } from './contracts.js';
import type { CatalogPort } from './ports.js';
import type { PessoaClassificada } from './regras/combinacoes.js';
import { formatarBRL } from './regras/dinheiro.js';
import { montarPedidos } from './regras/montar-pedidos.js';
import { calcularRateio } from './regras/rateio.js';
import type { CatalogSnapshot } from './regras/validar-escolhas.js';
import type { CoreSession, EstadoOrcamento, PerguntaOrcamento } from './sessao.js';
import { apresentarProposta, voltarParaColeta } from './sessao.js';
import { comTaxas, cotarTaxas, taxasDa } from './taxas.js';

// ---------------------------------------------------------------------------
// Orçamento: "até 30 reais" cobre itens + parte da entrega + parte da taxa de
// serviço. Quem passa (de qualquer valor) é perguntado no privado:
//   [Aceito] [Quero outro] → em "Quero outro", o core sugere o item mais
//   próximo do pedido que caiba: [Aceito a sugestão] [Fico sem].
// Só a própria pessoa responde. O fechamento fica bloqueado com pendências.
// Respostas valem para a proposta (id sem as revisões -rN); mudanças feitas
// pelas respostas mantêm as outras respostas, e quem passar a estourar (efeito
// em cascata na entrega e na taxa) é perguntado também.
// ---------------------------------------------------------------------------

export type RespostaOrcamento = 'aceito' | 'quero_outro' | 'aceito_sugestao' | 'fico_sem';

export const TEXTOS_ORCAMENTO = {
  pergunta: (total: MoneyCents) =>
    `Seu pedido fica em ${formatarBRL(total)} com entrega e taxa de serviço, acima do seu orçamento. Pode ser?`,
  sugestao: (item: string, total: MoneyCents) =>
    `Que tal ${item}? Fica em ${formatarBRL(total)} com entrega e taxa, dentro do seu orçamento.`,
  semSugestao: 'Não encontrei outro item que caiba no seu orçamento nas lojas deste pedido.',
  aceito: 'Combinado: valor confirmado.',
  trocado: 'Trocado! Atualizei o seu item no pedido.',
  semItem: 'Tudo bem, você fica de fora deste pedido.',
  aguardando: (nomes: readonly string[]) => `Aguardando ${nomes.join(', ')} confirmar o valor do pedido.`,
  nadaPendente: 'Não há nenhuma pergunta de valor esperando a sua resposta.',
  respostaInvalida: 'Essa opção não vale para a pergunta atual.',
  taxaIndisponivel: 'Não consegui consultar a taxa de serviço agora; ela será conferida no fechamento.',
  pedidoVazio: 'Ninguém ficou com item no pedido; ele voltou para a coleta.',
} as const;

/** "chat-p1-r2" → "chat-p1": as respostas valem para todas as revisões da mesma proposta. */
export function baseDaProposta(id: string): string {
  return id.replace(/(-r\d+)+$/, '');
}

/** Quem passa do orçamento com itens + entrega + taxa de serviço. */
export function acimaDoOrcamento(session: CoreSession, proposal: Proposal): { participantId: ParticipantId; totalCents: MoneyCents }[] {
  return proposal.split.shares.flatMap((share) => {
    const budget = session.participants.find((p) => p.id === share.participantId)?.preferences.budgetCents;
    return budget !== undefined && share.totalCents > budget ? [{ participantId: share.participantId, totalCents: share.totalCents }] : [];
  });
}

/** Quem ainda bloqueia o fechamento: pergunta pendente ou acima do orçamento sem aceite que cubra o valor. */
export function pendenciasOrcamento(session: CoreSession): ParticipantId[] {
  const proposal = session.proposal;
  if (!proposal) return [];
  const estado = estadoDa(session, proposal);
  const ids = new Set(estado.pendentes.map((p) => p.participantId));
  for (const acima of acimaDoOrcamento(session, proposal)) {
    if (!aceitou(estado, acima.participantId, acima.totalCents)) ids.add(acima.participantId);
  }
  return [...ids];
}

function estadoDa(session: CoreSession, proposal: Proposal): EstadoOrcamento {
  const base = baseDaProposta(proposal.id);
  return session.budget?.proposalBaseId === base ? session.budget : { proposalBaseId: base, pendentes: [], aceitos: [] };
}

const aceitou = (estado: EstadoOrcamento, participantId: ParticipantId, total: MoneyCents) =>
  estado.aceitos.some((a) => a.participantId === participantId && a.totalCents >= total);

const pergunta = (session: CoreSession, proposalId: string, p: PerguntaOrcamento): CoreAction => ({
  type: 'budget_question',
  sessionId: session.id,
  participantId: p.participantId,
  proposalId,
  totalCents: p.totalCents,
  text: TEXTOS_ORCAMENTO.pergunta(p.totalCents),
});

const privada = (session: CoreSession, participantId: ParticipantId, text: string): CoreAction => ({
  type: 'send_message',
  sessionId: session.id,
  participantId,
  text,
});

/**
 * Confere o orçamento de todos na proposta atual e pergunta a quem passou e
 * ainda não aceitou esse valor. Mantém as respostas da mesma proposta; tira
 * pendências de quem voltou a caber. Sem proposta, limpa o estado.
 */
export function avaliarOrcamentos(session: CoreSession): { session: CoreSession; actions: CoreAction[] } {
  const proposal = session.proposal;
  if (!proposal) {
    const next: CoreSession = { ...session };
    delete next.budget;
    return { session: next, actions: [] };
  }

  const estado = estadoDa(session, proposal);
  const acima = acimaDoOrcamento(session, proposal);
  const actions: CoreAction[] = [];
  const pendentes: PerguntaOrcamento[] = [];

  for (const { participantId, totalCents } of acima) {
    if (aceitou(estado, participantId, totalCents)) continue;
    const atual = estado.pendentes.find((p) => p.participantId === participantId);
    if (atual?.etapa === 'sugestao' || (atual && atual.totalCents === totalCents)) {
      pendentes.push(atual);
      continue;
    }
    const nova: PerguntaOrcamento = { participantId, etapa: 'valor', totalCents };
    pendentes.push(nova);
    actions.push(pergunta(session, proposal.id, nova));
  }

  const presentes = new Set(proposal.split.shares.map((s) => s.participantId));
  const next: CoreSession = {
    ...session,
    budget: { proposalBaseId: estado.proposalBaseId, pendentes, aceitos: estado.aceitos.filter((a) => presentes.has(a.participantId)) },
  };
  return { session: next, actions };
}

export interface ContextoOrcamento {
  /** Catálogo da proposta (preços e lojas). */
  catalog: CatalogSnapshot;
  /** Classificação da proposta (atende/substitutos por desejo), para sugerir outro item. */
  classificacao: readonly PessoaClassificada[];
}

export interface RespostaOrcamentoResult {
  session: CoreSession;
  actions: CoreAction[];
  outcome:
    | 'budget_accepted'
    | 'budget_suggested'
    | 'budget_no_suggestion'
    | 'budget_item_swapped'
    | 'budget_left_out'
    | 'budget_nothing_pending'
    | 'budget_invalid_answer';
  /** Os itens da proposta mudaram: é preciso recotar a taxa de serviço e reavaliar todos. */
  itensMudaram: boolean;
}

/**
 * Aplica a resposta da própria pessoa à pergunta pendente dela. Puro: quando os
 * itens mudam, a taxa de serviço anterior fica como estimativa e quem chama
 * recota (atualizarTaxasEOrcamento) e reavalia todos.
 */
export function responderOrcamento(
  session: CoreSession,
  participantId: ParticipantId,
  resposta: RespostaOrcamento,
  ctx: ContextoOrcamento,
): RespostaOrcamentoResult {
  const proposal = session.proposal;
  const estado = proposal ? estadoDa(session, proposal) : undefined;
  const pendente = estado?.pendentes.find((p) => p.participantId === participantId);
  if (!proposal || !estado || !pendente) {
    return { session, actions: [privada(session, participantId, TEXTOS_ORCAMENTO.nadaPendente)], outcome: 'budget_nothing_pending', itensMudaram: false };
  }
  const outros = estado.pendentes.filter((p) => p !== pendente);
  const comEstado = (budget: EstadoOrcamento, base: CoreSession = session): CoreSession => ({ ...base, budget });
  const invalida: RespostaOrcamentoResult = {
    session,
    actions: [privada(session, participantId, TEXTOS_ORCAMENTO.respostaInvalida)],
    outcome: 'budget_invalid_answer',
    itensMudaram: false,
  };

  switch (resposta) {
    case 'aceito': {
      if (pendente.etapa !== 'valor') return invalida;
      const budget = { ...estado, pendentes: outros, aceitos: [...estado.aceitos, { participantId, totalCents: pendente.totalCents }] };
      return { session: comEstado(budget), actions: [privada(session, participantId, TEXTOS_ORCAMENTO.aceito)], outcome: 'budget_accepted', itensMudaram: false };
    }

    case 'quero_outro': {
      if (pendente.etapa !== 'valor') return invalida;
      const sugestao = sugerirItem(session, proposal, participantId, ctx);
      const nova: PerguntaOrcamento = {
        participantId,
        etapa: 'sugestao',
        totalCents: sugestao?.totalCents ?? pendente.totalCents,
        ...(sugestao && { sugestao }),
      };
      const nome = sugestao ? (ctx.catalog.menuItems.find((i) => i.id === sugestao.menuItemId)?.name ?? sugestao.menuItemId) : '';
      const action: CoreAction = {
        type: 'item_suggestion',
        sessionId: session.id,
        participantId,
        proposalId: proposal.id,
        ...(sugestao && { menuItemId: sugestao.menuItemId, totalCents: sugestao.totalCents }),
        text: sugestao ? TEXTOS_ORCAMENTO.sugestao(nome, sugestao.totalCents) : TEXTOS_ORCAMENTO.semSugestao,
      };
      return {
        session: comEstado({ ...estado, pendentes: [...outros, nova] }),
        actions: [action],
        outcome: sugestao ? 'budget_suggested' : 'budget_no_suggestion',
        itensMudaram: false,
      };
    }

    case 'aceito_sugestao': {
      const sugestao = pendente.etapa === 'sugestao' ? pendente.sugestao : undefined;
      if (!sugestao) return invalida;
      const itens = trocarItem(proposal, participantId, sugestao, ctx.catalog);
      const nova = refazer(proposal, itens, ctx.catalog);
      const next = comEstado({ ...estado, pendentes: outros }, apresentarProposta(session, nova));
      return { session: next, actions: [privada(session, participantId, TEXTOS_ORCAMENTO.trocado)], outcome: 'budget_item_swapped', itensMudaram: true };
    }

    case 'fico_sem': {
      const itens = proposal.orders.flatMap((o) => o.items).filter((i) => i.participantId !== participantId);
      const acoes = [privada(session, participantId, TEXTOS_ORCAMENTO.semItem)];
      if (itens.length === 0) {
        const vazio = voltarParaColeta(session);
        return {
          session: vazio,
          actions: [...acoes, { type: 'send_message', sessionId: session.id, text: TEXTOS_ORCAMENTO.pedidoVazio }],
          outcome: 'budget_left_out',
          itensMudaram: false,
        };
      }
      const nova = refazer(proposal, itens, ctx.catalog, participantId);
      const next = comEstado({ ...estado, pendentes: outros }, apresentarProposta(session, nova));
      return { session: next, actions: acoes, outcome: 'budget_left_out', itensMudaram: true };
    }
  }
}

/** Nova revisão da proposta com estes itens, mantendo a taxa de serviço anterior como estimativa. */
function refazer(proposal: Proposal, itens: ProposedItem[], catalog: CatalogSnapshot, saiu?: ParticipantId): Proposal {
  const taxas = new Map([...taxasDa(proposal)].filter(([storeId]) => itens.some((i) => i.storeId === storeId)));
  const orders = montarPedidos(itens, catalog.stores, taxas);
  return {
    ...proposal,
    id: proximaRevisao(proposal.id),
    orders,
    split: calcularRateio(orders),
    uncoveredParticipantIds: saiu ? [...new Set([...proposal.uncoveredParticipantIds, saiu])] : proposal.uncoveredParticipantIds,
  };
}

function trocarItem(
  proposal: Proposal,
  participantId: ParticipantId,
  sugestao: NonNullable<PerguntaOrcamento['sugestao']>,
  catalog: CatalogSnapshot,
): ProposedItem[] {
  const preco = catalog.menuItems.find((i) => i.id === sugestao.menuItemId)?.priceCents ?? 0;
  let trocado = false;
  return proposal.orders
    .flatMap((o) => o.items)
    .map((item) => {
      if (trocado || item.participantId !== participantId || item.menuItemId !== sugestao.replaceMenuItemId) return item;
      trocado = true;
      return { participantId, storeId: sugestao.storeId, menuItemId: sugestao.menuItemId, quantity: 1, unitPriceCents: preco };
    });
}

/**
 * Item mais próximo do pedido que deixa a pessoa dentro do orçamento: troca o
 * item mais caro dela pelo primeiro candidato (os que "atendem" os desejos,
 * depois os substitutos, na ordem do modelo) das lojas que já estão no pedido.
 * O total usa a taxa de serviço atual como estimativa; a recotação confirma.
 */
export function sugerirItem(
  session: CoreSession,
  proposal: Proposal,
  participantId: ParticipantId,
  ctx: ContextoOrcamento,
): NonNullable<PerguntaOrcamento['sugestao']> | undefined {
  const budget = session.participants.find((p) => p.id === participantId)?.preferences.budgetCents;
  if (budget === undefined) return undefined;
  const daPessoa = proposal.orders.flatMap((o) => o.items).filter((i) => i.participantId === participantId);
  const maisCaro = [...daPessoa].sort((a, b) => b.unitPriceCents * b.quantity - a.unitPriceCents * a.quantity)[0];
  if (!maisCaro) return undefined;

  const lojas = new Set(proposal.orders.map((o) => o.storeId));
  const atuais = new Set(daPessoa.map((i) => i.menuItemId));
  const classificada = ctx.classificacao.find((c) => c.participantId === participantId);
  const candidatos: MenuItemId[] = [
    ...new Set([...(classificada?.desejos.flatMap((d) => d.atende) ?? []), ...(classificada?.desejos.flatMap((d) => d.substitutos) ?? [])]),
  ];

  for (const menuItemId of candidatos) {
    if (atuais.has(menuItemId)) continue;
    const item = ctx.catalog.menuItems.find((i) => i.id === menuItemId);
    if (!item || !item.available || !lojas.has(item.storeId)) continue;
    const sugestao = { menuItemId, storeId: item.storeId as StoreId, replaceMenuItemId: maisCaro.menuItemId, totalCents: 0 };
    const nova = comTaxas({ ...proposal, orders: montarPedidos(trocarItem(proposal, participantId, sugestao, ctx.catalog), ctx.catalog.stores) }, ctx.catalog, taxasDa(proposal));
    const total = nova.split.shares.find((s) => s.participantId === participantId)?.totalCents;
    if (total !== undefined && total <= budget) return { ...sugestao, totalCents: total };
  }
  return undefined;
}

/**
 * Recota a taxa de serviço da proposta atual (os itens mudaram) e reavalia o
 * orçamento de todos. Se a cotação falhar numa loja, a taxa anterior é mantida
 * como estimativa e o grupo é avisado.
 */
export async function atualizarTaxasEOrcamento(
  session: CoreSession,
  port: CatalogPort,
  address: DeliveryAddress,
  catalog: CatalogSnapshot,
): Promise<{ session: CoreSession; actions: CoreAction[] }> {
  const proposal = session.proposal;
  if (!proposal) return avaliarOrcamentos(session);
  const cotada = await cotarTaxas(proposal, port, address, catalog);
  const anteriores = taxasDa(proposal);
  const taxas = new Map(cotada.taxas);
  for (const storeId of cotada.falhas) {
    const anterior = anteriores.get(storeId);
    if (anterior !== undefined) taxas.set(storeId, anterior);
  }
  const atualizada: CoreSession = { ...session, proposal: comTaxas(proposal, catalog, taxas) };
  const avaliada = avaliarOrcamentos(atualizada);
  const aviso: CoreAction[] =
    cotada.falhas.length > 0 ? [{ type: 'send_message', sessionId: session.id, text: TEXTOS_ORCAMENTO.taxaIndisponivel }] : [];
  return { session: avaliada.session, actions: [...aviso, ...avaliada.actions] };
}
