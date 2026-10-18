import { expect,it } from 'vitest';
import { textoRevisaoCarrinho } from '../../src/telegram/services/cart-card.js';
import type { Resposta } from '../../src/core/agente.js';
const response:Resposta={outcome:'cart_review',actions:[],cartProposal:{id:'private-proposal',sessionId:'private-session',organizerId:'a',address:{formatted:'Destino privado'},participants:[{id:'a',displayName:'Ana <teste>',preferences:{}}],items:[{participantId:'a',storeId:'private-store',menuItemId:'private-item',quantity:1}],status:'preliminary',pending:['commercial_validation']},cartReview:{status:'blocked',observations:[{cartId:'private-cart',storeId:'private-store',items:[{menuItemId:'private-item',quantity:1,unitPriceCents:800}],issues:[]}],failures:['private-store'],overBudget:[],revision:'private-revision'}};
it.each([
 ['address_binding_unconfirmed','Vínculo atual do endereço não comprovado'],
 ['address_binding_mismatch','Endereço divergente'],
 ['commercial_fields_missing','Frete, taxas ou resumo comercial incompletos'],
 ['total_decomposition_mismatch','Benefícios e total não reconciliados'],
 ['unit_unconfirmed','Unidade monetária não homologada'],
])('revisão comunica a pendência real %s sem expor IDs nem inventar total', (issue, text)=>{
 const input=structuredClone(response);input.cartReview!.observations[0]!.issues=[issue];
 const card=textoRevisaoCarrinho(input,{lojas:{'private-store':'Loja & teste'},itens:{'private-item':'Pão <teste>'}});
 expect(card).toContain(text);expect(card).toContain('Ana &lt;teste&gt;: 1×');expect(card).toContain('Loja &amp; teste');expect(card).toContain('Pão &lt;teste&gt;');
 expect(card).not.toMatch(/private-|R\$ 0,00|Pedido confirmado/);expect(card).toContain('Nenhuma compra ou pagamento foi autorizado.');
});
