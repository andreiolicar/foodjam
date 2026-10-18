import { expect, it, vi } from 'vitest';
import { createIfoodCheckoutInspection } from '../../src/ifood/checkout-inspection.js';
import type { CommercialReview, PreliminaryProposal } from '../../src/core/contracts.js';
import type { IfoodMcpClient } from '../../src/ifood/client.js';
const store = '11111111-1111-4111-8111-111111111111';
const payment = '22222222-2222-4222-8222-222222222222';
const proposal: PreliminaryProposal = { id:'p', sessionId:'g', organizerId:'a', address:{id:'address',formatted:'Destino fictício'}, participants:[{id:'a',displayName:'Pessoa',preferences:{}}], items:[{participantId:'a',storeId:store,menuItemId:'item',quantity:2}],status:'preliminary',pending:['commercial_validation'] };
const review: CommercialReview = { status:'blocked',observations:[{cartId:'cart',storeId:store,items:[{menuItemId:'item',quantity:2}],issues:['address_binding_unconfirmed','total_decomposition_mismatch']}], failures:[store],overBudget:[],revision:'r' };
const tools = ['listPaymentMethods','setCartPayment','submitOrder','getOrder','trackOrder'].map(name=>({name,inputSchema:name==='listPaymentMethods'?{type:'object',properties:{merchantId:{type:'string',format:'uuid'}},required:['merchantId']}:{type:'object'}}));
const envelope=(data:unknown)=>({content:[{type:'text',text:JSON.stringify(data)}]});
function setup() {
 const client={callPaymentOrderTool:vi.fn<IfoodMcpClient['callPaymentOrderTool']>(async()=>envelope({paymentMethods:[{paymentMethodId:payment,kind:'PIX',displayName:'Pix',brand:'PIX',cardTokenId:'must-not-escape'}]}))};
 const read=vi.fn(async()=>structuredClone(review));
 return {client,read,inspect:createIfoodCheckoutInspection(client,tools,read)};
}
it('relê carrinho registrado e identifica Pix por kind/UUID reais, sem expor IDs ou selecionar pagamento',async()=>{
 const s=setup();const result=await s.inspect(proposal,'a',async()=>true);
 expect(result.status).toBe('blocked');expect(result.stores).toEqual([{storeId:store,pixAvailable:true,issues:[]}]);
 expect(result.review).toEqual(review);expect(result.blockers).toContain('commercial_pending');
 expect(result.blockers).toContain('submission_result_unconfirmed');expect(result.blockers).toContain('pix_result_unconfirmed');
 expect(s.client.callPaymentOrderTool).toHaveBeenCalledExactlyOnceWith('listPaymentMethods',{merchantId:store});
 expect(JSON.stringify(result)).not.toMatch(/must-not-escape|22222222/);expect(s.read).toHaveBeenCalledOnce();
});
it.each([
 {paymentMethods:[{paymentMethodId:'PIX',kind:'PIX'}]},
 {paymentMethods:[{paymentMethodId:payment,kind:'CREDIT_CARD',displayName:'Pix'}]},
 {paymentMethods:[{paymentMethodId:payment,kind:'PIX'},{paymentMethodId:payment,kind:'CREDIT_CARD'}]},
 {paymentMethods:[]},
])('resposta sem Pix inequívoco não inventa método: %j',async data=>{
 const s=setup();s.client.callPaymentOrderTool.mockResolvedValue(envelope(data));
 const result=await s.inspect(proposal,'a',async()=>true);expect(result.stores[0]?.pixAvailable).not.toBe(true);expect(result.status).toBe('blocked');
});
it('isError e falha de transporte permanecem pendências; não executam outra ferramenta',async()=>{
 const s=setup();s.client.callPaymentOrderTool.mockResolvedValueOnce({...envelope({}),isError:true} as never).mockRejectedValueOnce(new Error('private'));
 for(let i=0;i<2;i++){const r=await s.inspect(proposal,'a',async()=>true);expect(r.stores[0]?.issues).toContain('payment_methods_failed');}
 expect(s.client.callPaymentOrderTool.mock.calls.map(c=>c[0])).toEqual(['listPaymentMethods','listPaymentMethods']);
});
it('ausência de capacidade não fabrica submissão nem Pix',async()=>{
 const s=setup();const inspect=createIfoodCheckoutInspection(s.client,[],s.read);
 const r=await inspect(proposal,'a',async()=>true);expect(r.blockers).toContain('missing_capability');expect(s.client.callPaymentOrderTool).not.toHaveBeenCalled();
});
it.each(['actor','stale'] as const)('autorização %s inválida não chega ao transporte',async kind=>{
 const s=setup();await expect(s.inspect(proposal,kind==='actor'?'other':'a',async()=>kind!=='stale')).rejects.toThrow();
 expect(s.read).not.toHaveBeenCalled();expect(s.client.callPaymentOrderTool).not.toHaveBeenCalled();
});
it('proposta substituída durante leitura não produz resposta para a revisão nova',async()=>{
 const s=setup();let current=true;s.read.mockImplementation(async()=>{current=false;return structuredClone(review);});
 await expect(s.inspect(proposal,'a',async()=>current)).rejects.toThrow();expect(s.client.callPaymentOrderTool).not.toHaveBeenCalled();
});
it('duas lojas são inspecionadas separadamente, sem misturar disponibilidade de Pix',async()=>{
 const s=setup();const other='33333333-3333-4333-8333-333333333333';const p=structuredClone(proposal);p.items.push({...p.items[0]!,storeId:other});
 const both=structuredClone(review);both.observations.push({...both.observations[0]!,storeId:other,cartId:'other-cart'});s.read.mockResolvedValue(both);
 s.client.callPaymentOrderTool.mockResolvedValueOnce(envelope({paymentMethods:[]}));
 const r=await s.inspect(p,'a',async()=>true);expect(r.stores.map(x=>[x.storeId,x.pixAvailable])).toEqual([[store,false],[other,true]]);
 expect(s.client.callPaymentOrderTool.mock.calls.map(c=>c[1])).toEqual([{merchantId:store},{merchantId:other}]);
});
it('loja sem carrinho comprovado na releitura não consulta métodos como se estivesse validada',async()=>{
 const s=setup();s.read.mockResolvedValue({...review,observations:[]});const r=await s.inspect(proposal,'a',async()=>true);
 expect(s.client.callPaymentOrderTool).not.toHaveBeenCalled();expect(r.stores[0]?.issues).toContain('cart_unconfirmed');
});
it('mesmo carrinho reconciliado e capacidade de submissão presente não liberam resposta desconhecida',async()=>{
 const s=setup();s.read.mockResolvedValue({...review,status:'review_required',failures:[]});const r=await s.inspect(proposal,'a',async()=>true);
 expect(r.status).toBe('blocked');expect(r.blockers).not.toContain('commercial_pending');expect(r.blockers).toContain('submission_result_unconfirmed');
 expect(s.client.callPaymentOrderTool.mock.calls.every(c=>c[0]==='listPaymentMethods')).toBe(true);
});
