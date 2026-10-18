import { afterEach, expect, it, vi } from 'vitest';
import { criarAgenteDescoberta, SessoesEmMemoria } from '../../src/core/index.js';
import type { CommercialReview, PreliminaryProposal } from '../../src/core/contracts.js';
import type { CartPreparationService } from '../../src/core/cart-controller.js';
const proposal: PreliminaryProposal = { id:'p1',sessionId:'g',organizerId:'a',address:{id:'address',formatted:'Destino de teste'},participants:[{id:'a',displayName:'Andrei',preferences:{}},{id:'b',displayName:'Ana Paula',preferences:{}},{id:'c',displayName:'Allan',preferences:{}}],items:[{participantId:'a',storeId:'s',menuItemId:'coxinha',quantity:1},{participantId:'b',storeId:'s',menuItemId:'pao',quantity:1},{participantId:'c',storeId:'s',menuItemId:'pao',quantity:1}],status:'preliminary',pending:['commercial_validation'] };
const review: CommercialReview = {status:'blocked',observations:[],failures:['s'],overBudget:[],revision:'review'};
async function setup() {
 const sessions=new SessoesEmMemoria();
 await sessions.set({session:{id:'g',organizerId:'a',participants:proposal.participants,status:'collecting',address:{status:'confirmed',confirmed:proposal.address},preliminary:structuredClone(proposal)},proposalCount:1});
 const service={prepare:vi.fn<CartPreparationService['prepare']>(async()=>structuredClone(review)),read:vi.fn<CartPreparationService['read']>(async()=>structuredClone(review))};
 const catalog={listSavedAddresses:async()=>[proposal.address],searchStores:async()=>[],getStore:async()=>{throw new Error();},getMenu:async()=>({items:[],coverage:'offers_only' as const})};
 const agent=criarAgenteDescoberta({sessions,catalog,llm:{generate:async()=>{throw new Error('No AI');}},cartPreparation:service});
 return {agent,sessions,service};
}
afterEach(()=>vi.useRealTimers());
it('preparação existe apenas quando habilitada explicitamente e exige o organizador/revisão atual',async()=>{
 const {agent,service}=await setup();expect(agent.prepararCarrinho).toBeTypeOf('function');
 expect((await agent.prepararCarrinho!('g','b','p1')).outcome).toBe('not_authorized');
 expect((await agent.prepararCarrinho!('g','a','old')).outcome).toBe('proposal_stale');
 expect(service.prepare).not.toHaveBeenCalled();
 const result=await agent.prepararCarrinho!('g','a','p1');expect(result.cartReview).toEqual(review);expect(result.cartProposal).toEqual(proposal);
 expect(service.prepare).toHaveBeenCalledTimes(1);
});
it('cliques repetidos e concorrentes nunca repetem preparação; revisão faz apenas leitura',async()=>{
 const {agent,service}=await setup();let release!:(v:CommercialReview)=>void;
 service.prepare.mockImplementationOnce(()=>new Promise(done=>{release=done;}));
 const first=agent.prepararCarrinho!('g','a','p1');await vi.waitFor(()=>expect(service.prepare).toHaveBeenCalledTimes(1));
 expect((await agent.prepararCarrinho!('g','a','p1')).outcome).toBe('cart_preparing');release(review);await first;
 await agent.prepararCarrinho!('g','a','p1');expect(service.prepare).toHaveBeenCalledTimes(1);
 await agent.revisarCarrinho!('g','a','p1');expect(service.read).toHaveBeenCalledTimes(1);expect(service.prepare).toHaveBeenCalledTimes(1);
});
it.each(['cancelar','voltar_coleta','outra_opcao'] as const)('mudança %s durante operação invalida resposta e guarda independente do resultado remoto',async action=>{
 const {agent,service,sessions}=await setup();let release!:(v:CommercialReview)=>void;let current!:()=>Promise<boolean>;
 service.prepare.mockImplementationOnce(async(_p,_a,valid)=>{current=valid;return new Promise(done=>{release=done;});});
 const record=(await sessions.get('g'))!;record.session.preliminaryAlternative={...proposal,id:'alternative'};await sessions.set(record);
 const first=agent.prepararCarrinho!('g','a','p1');await vi.waitFor(()=>expect(service.prepare).toHaveBeenCalledTimes(1));
 await agent.agirNaPropostaPreliminar('g','a','p1',action);expect(await current()).toBe(false);release(review);
 const result=await first;expect(result.outcome).toBe('proposal_stale');expect(result.cartReview).toBeUndefined();
});
it('alteração de endereço invalida autorização mesmo preservando indevidamente o ID da proposta',async()=>{
 const {agent,service,sessions}=await setup();let release!:(v:CommercialReview)=>void;let current!:()=>Promise<boolean>;
 service.prepare.mockImplementationOnce(async(_p,_a,valid)=>{current=valid;return new Promise(done=>{release=done;});});
 const first=agent.prepararCarrinho!('g','a','p1');await vi.waitFor(()=>expect(service.prepare).toHaveBeenCalledTimes(1));
 const record=(await sessions.get('g'))!;record.session.address!.confirmed={id:'changed',formatted:'Outro'};await sessions.set(record);
 expect(await current()).toBe(false);release(review);expect((await first).outcome).toBe('proposal_stale');
});
it('prazo incerto termina espera sem liberar repetição nem concluir compra',async()=>{
 vi.useFakeTimers();const {agent,service}=await setup();service.prepare.mockImplementationOnce(()=>new Promise(()=>{}));
 const first=agent.prepararCarrinho!('g','a','p1');await vi.advanceTimersByTimeAsync(30_001);
 expect((await first).outcome).toBe('cart_uncertain');expect((await agent.prepararCarrinho!('g','a','p1')).outcome).toBe('cart_uncertain');
 expect(service.prepare).toHaveBeenCalledTimes(1);expect((await agent.obter('g'))?.status).not.toBe('closed');
});
it('revisão sem preparo não autoriza escrita e falha não é apresentada como sucesso',async()=>{
 const {agent,service}=await setup();expect((await agent.revisarCarrinho!('g','a','p1')).outcome).toBe('cart_not_prepared');
 service.prepare.mockRejectedValueOnce(new Error('Private'));expect((await agent.prepararCarrinho!('g','a','p1')).outcome).toBe('cart_uncertain');
 expect((await agent.prepararCarrinho!('g','a','p1')).cartReview).toBeUndefined();expect(service.prepare).toHaveBeenCalledTimes(1);
});
it('inspeção do checkout compartilha autorização/revisão e nunca prepara outro carrinho',async()=>{
 const {agent,service}=await setup();
 const checkout=vi.fn(async()=>({status:'blocked' as const,review:structuredClone(review),stores:[],blockers:['submission_result_unconfirmed']}));
 Object.assign(service,{checkout});
 expect((await agent.revisarCheckout!('g','a','p1')).outcome).toBe('cart_not_prepared');
 await agent.prepararCarrinho!('g','a','p1');
 expect((await agent.revisarCheckout!('g','b','p1')).outcome).toBe('not_authorized');
 expect((await agent.revisarCheckout!('g','a','old')).outcome).toBe('proposal_stale');
 expect((await agent.revisarCheckout!('g','a','p1')).checkout?.status).toBe('blocked');
 expect(checkout).toHaveBeenCalledOnce();expect(service.prepare).toHaveBeenCalledOnce();
});
it('troca durante inspeção não libera resposta tardia nem nova escrita',async()=>{
 const {agent,service,sessions}=await setup();await agent.prepararCarrinho!('g','a','p1');
 let release!:(value:{status:'blocked';review:CommercialReview;stores:[];blockers:string[]})=>void;
 Object.assign(service,{checkout:vi.fn(()=>new Promise(resolve=>{release=resolve;}))});
 const first=agent.revisarCheckout!('g','a','p1');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 expect((await agent.revisarCheckout!('g','a','p1')).outcome).toBe('cart_preparing');
 const record=(await sessions.get('g'))!;delete record.session.preliminary;await sessions.set(record);
 release({status:'blocked',review,stores:[],blockers:[]});expect((await first).outcome).toBe('proposal_stale');expect(service.prepare).toHaveBeenCalledOnce();
});
it('prazo da inspeção termina sem submissão nem repetição da preparação',async()=>{
 const {agent,service}=await setup();await agent.prepararCarrinho!('g','a','p1');vi.useFakeTimers();
 Object.assign(service,{checkout:vi.fn(()=>new Promise(()=>{}))});
 const result=agent.revisarCheckout!('g','a','p1');await vi.advanceTimersByTimeAsync(30_001);
 expect((await result).outcome).toBe('cart_uncertain');expect(service.prepare).toHaveBeenCalledOnce();
});
it('mesmo ID não reaproveita revisão se composição ou participantes mudarem',async()=>{
 const {agent,service,sessions}=await setup();await agent.prepararCarrinho!('g','a','p1');
 const record=(await sessions.get('g'))!;record.session.preliminary!.items[0]!.quantity=2;await sessions.set(record);
 expect((await agent.prepararCarrinho!('g','a','p1')).outcome).toBe('proposal_stale');expect(service.prepare).toHaveBeenCalledTimes(1);
});
it('resultado incerto impede nova proposta contornar reserva com outra loja',async()=>{
 const {agent,service,sessions}=await setup();service.prepare.mockRejectedValueOnce(new Error('Timeout'));await agent.prepararCarrinho!('g','a','p1');
 const record=(await sessions.get('g'))!;record.session.preliminary={...proposal,id:'p2',items:proposal.items.map(i=>({...i,storeId:'new-store'}))};await sessions.set(record);
 expect((await agent.prepararCarrinho!('g','a','p2')).outcome).toBe('cart_previous_pending');expect(service.prepare).toHaveBeenCalledTimes(1);
});
