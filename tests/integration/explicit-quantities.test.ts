import { expect,it,vi } from 'vitest';
import { coletarLote } from '../../src/core/coleta.js';
import { criarSessao } from '../../src/core/sessao.js';
import { proporDescoberta } from '../../src/core/discovery-flow.js';
import { createPreparationAuthority,prepareCommercialProposal } from '../../src/core/commercial-flow.js';
import { createIfoodDiscoveryCatalog } from '../../src/ifood/discovery.js';
import { createIfoodCommercialPreparation } from '../../src/ifood/commercial.js';
import { textosItensPropostaPreliminar } from '../../src/telegram/services/card.js';
import { PreliminaryProposalSchema } from '../../src/core/schemas.js';
import type { ParticipantPreferences } from '../../src/core/contracts.js';
const address={id:'fixture-address',formatted:'Destino fictício'};
const envelope=(value:unknown)=>({content:[{type:'text',text:JSON.stringify(value)}]});
const products=[{itemId:'coxinha',itemName:'Coxinha'},{itemId:'croissant',itemName:'Croissant'},{itemId:'pao',itemName:'Pão de queijo'}];
async function prepare(messages:{participantId:string;displayName:string;text:string;wish:string}[]){
 const collected=await coletarLote(criarSessao({id:'group',organizerId:'a',participants:[]}),messages,{llm:{generate:async()=>({resultados:messages.map(m=>({participantId:m.participantId,kind:'preference',wishes:[m.wish],foodPreferences:[],dietaryRestrictions:[],avoids:[],budgetText:null,clarification:null}))})}});
 const session={...collected.session,address:{status:'confirmed' as const,confirmed:address}};
 const records=new Map<string,{cartId?:string}>();const journal={get:async(key:string)=>records.get(key),reserve:async(key:string)=>{if(records.has(key))return false;records.set(key,{});return true;},saveCart:async(key:string,cartId:string)=>{records.set(key,{cartId});}};
 let selected:{itemId:string;quantity:number}[]=[];
 const client={callReadTool:vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='listAddresses')return envelope({results:[{addressId:address.id,formattedAddress:address.formatted,coordinates:{latitude:0,longitude:0}}]});
  if(name==='getMerchant')return envelope({merchantId:'store',merchantName:'Padaria fictícia',isOpen:true});
  if(name==='getItem')return envelope({merchantId:'store',itemId:args.itemId,optionGroups:[]});
  if(args.resultKind==='MERCHANT')return envelope({results:[{merchantId:'store',merchantName:'Padaria fictícia',isOpen:true}],hasMore:false});
  return envelope({results:products.map(p=>({...p,merchant:{merchantId:'store'}})),hasMore:false});
 }),callCartTool:vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='createCart'){selected=structuredClone(args.items as typeof selected);return envelope({cartId:'fixture-cart'});}
  return envelope({cartId:'fixture-cart',merchant:{merchantId:'store'},items:selected.map(i=>({...i,unitPrice:10})),deliveryAddress:{addressId:address.id},deliveryMethod:{fee:0},fees:[],summary:{subtotalAmount:selected.reduce((s,i)=>s+10*i.quantity,0),deliveryFeeAmount:0,feeTotalAmount:0,benefitsTotalAmount:0,voucherTotalAmount:0,totalAmount:selected.reduce((s,i)=>s+10*i.quantity,0)}});
 })};
 const found=await proporDescoberta(session,{address,port:createIfoodDiscoveryCatalog(client),mode:'literal',proposalId:'proposal'});expect(found.proposal).toBeDefined();
 const proposal=found.proposal!;const authority=createPreparationAuthority();const port=createIfoodCommercialPreparation(client,{authority,journal,authenticatedUserId:'fixture-user',moneyUnit:'BRL'});
 const review=await prepareCommercialProposal(proposal,'a','fixture-user',authority,port);
 return {proposal,review,client,found,session};
}
it('três participantes: quantidade explícita chega à proposta, card e payload real controlado',async()=>{
 const result=await prepare([{participantId:'a',displayName:'Andrei',text:'quero uma coxinha',wish:'coxinha'},{participantId:'b',displayName:'Allan',text:'quero um croissant',wish:'croissant'},{participantId:'c',displayName:'Ana Paula',text:'quero 2 pães de queijo',wish:'pão de queijo'}]);
 expect(result.proposal.items.map(i=>[i.participantId,i.menuItemId,i.quantity])).toEqual([['a','coxinha',1],['b','croissant',1],['c','pao',2]]);
 expect(result.client.callCartTool.mock.calls[0]).toEqual(['createCart',{merchantId:'store',addressId:address.id,items:[{itemId:'coxinha',quantity:1},{itemId:'croissant',quantity:1},{itemId:'pao',quantity:2}]}]);
 expect(result.review.status).toBe('review_required');expect(result.review.observations[0]!.items.find(i=>i.menuItemId==='pao')?.quantity).toBe(2);
 const cards=textosItensPropostaPreliminar({proposal:result.proposal,items:result.found.items,stores:result.found.stores});expect(cards.find(c=>c.texto.includes('Ana Paula'))?.texto).toContain('Ana Paula: 2×');
 expect(PreliminaryProposalSchema.parse(result.proposal).participants[2]!.preferences.wishQuantities).toEqual([2]);
});
it.each([[1,1,2],[2,1,3]])('participantes com %i e %i unidades agregam %i sem perder associações',async(a,b,total)=>{
 const result=await prepare([{participantId:'a',displayName:'A',text:`quero ${a} pão de queijo`,wish:'pão de queijo'},{participantId:'b',displayName:'B',text:`quero ${b} pão de queijo`,wish:'pão de queijo'}]);
 expect(result.proposal.items.map(i=>i.quantity)).toEqual([a,b]);expect(result.client.callCartTool.mock.calls[0]![1].items).toEqual([{itemId:'pao',quantity:total}]);
 expect(result.review.observations[0]!.items).toEqual([{menuItemId:'pao',quantity:total,unitPriceCents:1000}]);
});
it('metadados desalinhados ou inválidos são recusados antes de produzir quantidade inventada',async()=>{
 const result=await prepare([{participantId:'a',displayName:'A',text:'quero 2 pães de queijo',wish:'pão de queijo'}]);
 for(const metadata of [[0],[11],[2,1],[]]){
  const proposal=structuredClone(result.proposal);proposal.participants[0]!.preferences.wishQuantities=metadata;
  expect(PreliminaryProposalSchema.safeParse(proposal).success).toBe(false);
 }
 const prefs:ParticipantPreferences={wishes:['pão de queijo'],wishQuantities:[11]};
 await expect(proporDescoberta({...result.session,participants:[{id:'a',displayName:'A',preferences:prefs}]},{address,port:createIfoodDiscoveryCatalog(result.client),mode:'literal',proposalId:'other'})).rejects.toThrow('Quantidade');
});
