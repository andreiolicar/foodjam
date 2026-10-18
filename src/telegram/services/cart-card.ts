import type { NomesCatalogo, Resposta } from '../../core/agente.js';
import { escapar, formatarBRL } from './card.js';
const pending: Record<string, string> = {
  address_binding_unconfirmed: 'Vínculo atual do endereço não comprovado; confira o destino no iFood.',
  address_binding_mismatch: 'Endereço divergente; não avance.',
  unit_unconfirmed: 'Unidade monetária não homologada; valores sem conversão.',
  commercial_fields_missing: 'Frete, taxas ou resumo comercial incompletos.',
  subtotal_mismatch: 'Subtotal divergente dos itens consultados.',
  delivery_mismatch: 'Frete divergente do método informado.',
  fees_mismatch: 'Taxas divergentes do resumo informado.',
  total_decomposition_mismatch: 'Benefícios e total não reconciliados; o total remoto foi preservado.',
};

export function textoRevisaoCarrinho(response: Resposta, names?: NomesCatalogo): string {
  const proposal = response.cartProposal; const review = response.cartReview;
  const lines = ['🛒 <b>Revisão do carrinho</b>'];
  if (!proposal || !review) return [...lines,
    'Preparação pendente ou incerta. Não repita a criação; consulte o registro e atualize a revisão.',
    'Nenhuma compra ou pagamento foi autorizado.'].join('\n');
  lines.push(review.status === 'blocked' ? 'Preparação incompleta ou com pendências. Não está pronta para confirmação.' : 'Composição e valores reconciliados; revisão comercial pendente.');
  for (const storeId of new Set(proposal.items.map(i => i.storeId))) {
    lines.push('', `🏪 <b>${escapar(names?.lojas[storeId] ?? 'Estabelecimento da proposta')}</b>`);
    const observation = review.observations.find(o => o.storeId === storeId);
    const chosen = proposal.items.filter(i => i.storeId === storeId);
    for (const itemId of new Set(chosen.map(i => i.menuItemId))) {
      lines.push(`<b>${escapar(names?.itens[itemId] ?? 'Produto da proposta')}</b>`);
      for (const item of chosen.filter(i => i.menuItemId === itemId)) {
        const person = proposal.participants.find(p => p.id === item.participantId);
        lines.push(`• ${escapar(person?.displayName ?? 'Participante')}: ${item.quantity}×`);
      }
      const actual = observation?.items.find(i => i.menuItemId === itemId);
      lines.push(actual ? `No carrinho: ${actual.quantity}× · ${actual.unitPriceCents === undefined ? 'preço a conferir' : `${formatarBRL(actual.unitPriceCents)} por unidade`}` : 'Inclusão/quantidade pendente de reconciliação.');
      const preliminary = response.items?.find(i => i.storeId === storeId && i.id === itemId)?.priceCents;
      if (preliminary !== undefined && actual?.unitPriceCents !== undefined && preliminary !== actual.unitPriceCents) lines.push('Preço alterado em relação à sugestão preliminar.');
    }
    const amounts = observation?.amounts;
    if (amounts) lines.push(`Subtotal consultado: ${formatarBRL(amounts.subtotalCents)}`,
      `Frete informado: ${formatarBRL(amounts.deliveryCents)} · Taxas: ${formatarBRL(amounts.feesCents)}`,
      `Benefícios informados: ${formatarBRL(amounts.benefitsCents)} · Voucher: ${formatarBRL(amounts.voucherCents)}`,
      `Total informado pelo iFood (a revisar): <b>${formatarBRL(amounts.totalCents)}</b>`);
    else lines.push('Valores comerciais pendentes; nenhum total foi estimado.');
    if (!observation || observation.issues.length) lines.push('Há pendências de composição, destino ou valores; confira no iFood antes de avançar.');
    else lines.push('Carrinho consultado; composição conferida.');
    for (const issue of observation?.issues ?? []) lines.push(pending[issue] ?? 'Pendência comercial não homologada.');
  }
  lines.push('', 'Entrega, mínimos, restrições e disponibilidade para compra ainda precisam de conferência comercial.',
    'Nenhuma seleção de entrega foi autorizada por esta ação. Nenhuma compra ou pagamento foi autorizado.');
  return lines.join('\n');
}
