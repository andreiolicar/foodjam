import type {
  AuthorizedOrder,
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
