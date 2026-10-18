import type {
  AuthorizedOrder,
  PreliminaryProposal,
  DiscoveryItem,
  DiscoveryStore,
  MoneyCents,
  NomesCatalogo,
  Participant,
  ParticipantId,
  Proposal,
  ProposedItem,
  Split,
  StoreOrder,
} from '../../core/index.js';
import type { Botao } from './envios.js';

// Card da proposta em HTML do Telegram. Só formata: todos os valores vêm
// prontos do core (subtotal, total, rateio); o bot nunca soma dinheiro.

export function formatarBRL(cents: MoneyCents): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface DadosCard {
  proposal: Proposal;
  participantes: readonly Participant[];
  nomes?: NomesCatalogo;
  /** Quem ainda precisa responder sobre o valor no privado (sem valores no grupo). */
  pendentes?: readonly ParticipantId[];
}

function nomeDe(participantes: readonly Participant[], id: ParticipantId): string {
  return participantes.find((p) => p.id === id)?.displayName ?? id;
}

interface Contexto {
  participantes: readonly Participant[];
  nomes?: NomesCatalogo;
}

function linhaItem(item: ProposedItem, dados: Contexto): string {
  const pessoa = escapar(nomeDe(dados.participantes, item.participantId));
  const nomeItem = escapar(dados.nomes?.itens[item.menuItemId] ?? item.menuItemId);
  const quantidade = item.quantity > 1 ? `${item.quantity}× ` : '';
  const preco = item.quantity > 1 ? `${formatarBRL(item.unitPriceCents)} cada` : formatarBRL(item.unitPriceCents);
  const parecida = item.isSubstitute ? ' <i>(sugestão parecida)</i>' : '';
  return `• ${pessoa}: ${quantidade}${nomeItem} — ${preco}${parecida}`;
}

// Itens agrupados por pessoa, na ordem em que entraram no pedido.
function itensPorPessoa(items: readonly ProposedItem[], participantes: readonly Participant[]): ProposedItem[] {
  const ordem = (id: ParticipantId) => {
    const i = participantes.findIndex((p) => p.id === id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...items].sort((a, b) => ordem(a.participantId) - ordem(b.participantId));
}

// Lojas, itens por pessoa, entrega, taxa e total de cada loja.
function linhasLojas(orders: readonly StoreOrder[], dados: Contexto): string[] {
  return orders.flatMap((order) => {
    const taxa = order.serviceFeeCents !== undefined ? formatarBRL(order.serviceFeeCents) : 'não cotada';
    return [
      '',
      `🏪 <b>${escapar(dados.nomes?.lojas[order.storeId] ?? order.storeId)}</b>`,
      ...itensPorPessoa(order.items, dados.participantes).map((item) => linhaItem(item, dados)),
      `Entrega: ${formatarBRL(order.deliveryFeeCents)} · Taxa de serviço: ${taxa}`,
      `Total da loja: <b>${formatarBRL(order.totalCents)}</b>`,
    ];
  });
}

// Quanto cada pessoa paga e o total, como o core calculou.
function linhasRateio(split: Split, participantes: readonly Participant[]): string[] {
  return [
    '',
    '💰 <b>Quanto cada um paga</b>',
    ...split.shares.map(
      (share) =>
        `• ${escapar(nomeDe(participantes, share.participantId))}: <b>${formatarBRL(share.totalCents)}</b> ` +
        `(itens ${formatarBRL(share.itemsCents)} + entrega ${formatarBRL(share.deliveryCents)} + taxa ${formatarBRL(share.serviceCents)})`,
    ),
    `Total do pedido: <b>${formatarBRL(split.totalCents)}</b>`,
  ];
}

export function textoProposta(dados: DadosCard): string {
  const { proposal, participantes } = dados;
  const linhas: string[] = ['🍽️ <b>Sugestão da Íris</b>'];

  if (proposal.justification.trim()) linhas.push(`<i>${escapar(proposal.justification.trim())}</i>`);

  linhas.push(...linhasLojas(proposal.orders, dados), ...linhasRateio(proposal.split, participantes));

  if (proposal.uncoveredParticipantIds.length > 0) {
    const nomes = proposal.uncoveredParticipantIds.map((id) => escapar(nomeDe(participantes, id)));
    linhas.push('', `🙋 Sem item nesta sugestão: ${nomes.join(', ')}`);
  }

  if (dados.pendentes && dados.pendentes.length > 0) {
    const nomes = dados.pendentes.map((id) => escapar(nomeDe(participantes, id)));
    linhas.push('', `⏳ Aguardando confirmação de valor no privado: ${nomes.join(', ')}`);
  }

  return linhas.join('\n');
}

export interface DadosPedido {
  order: AuthorizedOrder;
  participantes: readonly Participant[];
  nomes?: NomesCatalogo;
  /** Clique repetido em Confirmar: mesmo pedido, nada novo foi executado. */
  repetido?: boolean;
}

/** Resumo do pedido autorizado (fechamento): endereço, lojas, rateio e a chave do pedido. */
export function textoPedido(dados: DadosPedido): string {
  const { order, participantes } = dados;
  const autorizou = escapar(nomeDe(participantes, order.authorization.authorizedBy));
  return [
    dados.repetido ? '✅ <b>Este pedido já estava confirmado</b>' : '✅ <b>Pedido confirmado!</b>',
    `📍 Entrega em: ${escapar(order.deliveryAddress.formatted)}`,
    ...linhasLojas(order.orders, dados),
    ...linhasRateio(order.split, participantes),
    '',
    `Autorizado por ${autorizou} · pedido <code>${escapar(order.proposalId)}</code>`,
  ].join('\n');
}

export const DADOS_CARD = {
  confirmar: 'proposta:confirmar',
  preparar: 'proposta:preparar_carrinho',
  outra: 'proposta:outra',
  voltar: 'proposta:voltar',
  cancelar: 'proposta:cancelar',
} as const;

/** Botões do card: "Outra opção" só quando o core guardou uma alternativa. */
export function botoesCard(temAlternativa: boolean): Botao[][] {
  return [
    [{ texto: '✅ Confirmar pedido', data: DADOS_CARD.confirmar }],
    ...(temAlternativa ? [[{ texto: '🔄 Outra opção', data: DADOS_CARD.outra }]] : []),
    [{ texto: '↩️ Voltar para a coleta', data: DADOS_CARD.voltar }],
    [{ texto: '❌ Cancelar pedido', data: DADOS_CARD.cancelar }],
  ];
}


/** Exploração sem cotação: valores ausentes não recebem zero ou disponibilidade implícita. */
export interface DadosPropostaPreliminar {
  proposal: PreliminaryProposal; nomes?: NomesCatalogo; items?: readonly DiscoveryItem[]; stores?: readonly DiscoveryStore[];
  collection?: readonly { participantId: string; displayName: string; included: boolean }[];
}

/** Resumo da sessão: detalhes de produto pertencem somente às mensagens individuais. */
export function textoPropostaPreliminar(dados: DadosPropostaPreliminar): string {
  const { proposal } = dados;
  const people = new Set([...proposal.participants.map(p => p.id), ...(dados.collection ?? []).map(p => p.participantId)]);
  const withItem = new Set(proposal.items.map(i => i.participantId));
  const withAlternative = new Set(proposal.items.filter(i => i.isSubstitute).map(i => i.participantId));
  const lines = ['🍽️ <b>Sugestão preliminar da Íris</b>',
    `Cobertura: ${withItem.size} de ${people.size} pessoas com item.`,
    `Do pedido: ${withItem.size - withAlternative.size}; com alternativa compatível: ${withAlternative.size}; sem item adequado: ${people.size - withItem.size}.`];
  for (const person of proposal.participants.filter(p => !proposal.items.some(i => i.participantId === p.id))) lines.push(`🙋 ${escapar(person.displayName)}: sem item compatível nesta amostra.`);
  for (const person of dados.collection ?? []) if (!person.included) lines.push(`🙋 ${escapar(person.displayName)}: preferência ainda não reconhecida; sem item nesta proposta.`);
  if (proposal.coverage?.classificationLimited) lines.push('Classificação limitada por pessoa aos candidatos da amostra priorizados por desejo.');
  if (proposal.coverage) lines.push(`Amostra pesquisada: ${proposal.coverage.terms} buscas por desejo, ${proposal.coverage.stores} lojas, ${proposal.coverage.items} produtos.${proposal.coverage.limited ? ' Cobertura limitada.' : ''}`);
  lines.push('', 'Disponibilidade e valores comerciais ainda precisam de confirmação.',
    'Frete, taxas, descontos e valores finais não confirmados.',
    'Catálogo consultado por amostra; o cardápio completo não foi comprovado. Nenhum carrinho, pagamento ou compra foi autorizado.');
  return lines.join('\n');
}

export interface ItemPropostaPreliminar {
  key: string;
  texto: string;
  itemImageUrl?: string;
}

/** Uma mensagem por par produto/loja selecionado; compartilha a foto entre suas pessoas. */
export function textosItensPropostaPreliminar(dados: DadosPropostaPreliminar): ItemPropostaPreliminar[] {
  const groups = new Map<string, typeof dados.proposal.items>();
  for (const chosen of dados.proposal.items) {
    const key = JSON.stringify([chosen.storeId, chosen.menuItemId]);
    const group = groups.get(key) ?? [];
    if (!group.some(row => row.participantId === chosen.participantId && row.quantity === chosen.quantity && Boolean(row.isSubstitute) === Boolean(chosen.isSubstitute))) group.push(chosen);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, chosen]) => {
    const first = chosen[0]!;
    const item = dados.items?.find(i => i.id === first.menuItemId && i.storeId === first.storeId);
    const store = dados.stores?.find(s => s.id === first.storeId);
    const name = item?.name ?? dados.nomes?.itens[first.menuItemId];
    const storeName = dados.nomes?.lojas[first.storeId] ?? store?.name;
    if (!name || !storeName) throw new Error('Produto ou estabelecimento não confirmado.');
    const lines = [`🍽️ <b>${escapar(name)}</b>`];
    for (const row of chosen) {
      const person = dados.proposal.participants.find(p => p.id === row.participantId);
      if (!person) throw new Error('Participante não confirmado.');
      lines.push(`👤 ${escapar(person.displayName)}: ${row.quantity}×${row.isSubstitute ? ' <i>(sugestão parecida)</i>' : ''}`);
    }
    lines.push(`🏪 <b>${escapar(storeName)}</b>`);
    const rating = store?.reviewRating;
    if (typeof rating === 'number' && Number.isFinite(rating) && rating >= 0 && rating <= 5) {
      const count = store?.ratingCount;
      const votes = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? ` (${count} ${count === 1 ? 'avaliação' : 'avaliações'})` : '';
      lines.push(`⭐ ${rating.toFixed(1).replace('.', ',')}${votes}`);
    }
    const price = item?.priceCents === undefined ? item?.basePriceCents === undefined ? 'preço a confirmar' : `preço base ${formatarBRL(item.basePriceCents)} por unidade; promoção/valor aplicável a confirmar` : `${formatarBRL(item.priceCents)} por unidade`;
    lines.push(price);
    if (item?.available === false) lines.push('indisponível');
    return { key, texto: lines.join('\n'), ...(item?.itemImageUrl === undefined ? {} : { itemImageUrl: item.itemImageUrl }) };
  });
}

export function botoesPreliminares(temAlternativa: boolean, podePrepararCarrinho = false): Botao[][] {
  return [...(podePrepararCarrinho ? [[{ texto: '🛒 Preparar carrinho', data: DADOS_CARD.preparar }]] : []),
    ...botoesCard(temAlternativa).slice(1)];
}
