import type { NomesCatalogo, Resposta } from '../../core/agente.js';
import { escapar, formatarBRL } from './card.js';

/** Somente para DM do organizador. Não transporta IDs, tokens ou dados Pix. */
export function textoConferenciaCheckout(response: Resposta, names?: NomesCatalogo): string {
  const inspection = response.checkout;
  if (!inspection) return 'Checkout indisponível ou revisão substituída. Prepare e confira o carrinho da proposta vigente. Nenhuma compra ou pagamento foi executado.';
  const lines = ['🔎 <b>Conferência do checkout</b>', 'Checkout bloqueado. Consulta somente leitura; não é confirmação de compra.'];
  for (const store of inspection.stores) {
    lines.push('', `🏪 <b>${escapar(names?.lojas[store.storeId] ?? 'Estabelecimento da proposta')}</b>`,
      store.pixAvailable === true ? 'Pix disponível nesta loja; ainda não selecionado.' : store.pixAvailable === false ? 'Pix não encontrado entre os métodos retornados.' : 'Métodos de pagamento não comprovados nesta consulta.');
    const cart = inspection.review.observations.find(o => o.storeId === store.storeId);
    if (cart?.amounts) lines.push(`Total remoto informado: ${formatarBRL(cart.amounts.totalCents)} (não confirmado para compra).`);
    if (cart?.issues.includes('address_binding_unconfirmed') || cart?.issues.includes('address_binding_mismatch')) lines.push('Vínculo do endereço pendente de comprovação.');
    if (cart?.issues.includes('total_decomposition_mismatch')) lines.push('Benefícios e total ainda não reconciliados.');
  }
  if (inspection.blockers.includes('commercial_pending')) lines.push('', 'Há pendências na revisão comercial; valores e condições não estão confirmados.');
  if (inspection.blockers.includes('missing_capability')) lines.push('Uma capacidade necessária não está disponível no catálogo atual.');
  lines.push('', 'Retorno da submissão, código Pix e vencimento ainda precisam de contrato homologado.', 'Nenhuma configuração de pagamento ou submissão foi executada.');
  return lines.join('\n');
}
