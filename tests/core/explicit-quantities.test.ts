import { expect,it } from 'vitest';
import { coletar,coletarLote } from '../../src/core/coleta.js';
import { criarSessao } from '../../src/core/sessao.js';
import type { ColetaOutput } from '../../src/core/schemas.js';
const empty=()=>criarSessao({id:'group',organizerId:'a',participants:[{id:'a',displayName:'Ana',preferences:{}}]});
const output=(wishes:string[]):ColetaOutput=>({kind:'preference',wishes,foodPreferences:[],dietaryRestrictions:[],avoids:[],budgetText:null,clarification:null});
const collect=(text:string,wishes:string[],session=empty())=>coletar(session,{sessionId:'group',participantId:'a',text},{llm:{generate:async()=>output(wishes)}});
const quantities=(r:Awaited<ReturnType<typeof collect>>)=>r.session.participants[0]!.preferences.wishQuantities??r.session.participants[0]!.preferences.wishes?.map(()=>1);
it.each([
 ['quero 2 pães de queijo',['pão de queijo'],[2]],
 ['quero dois pães de queijo',['pão de queijo'],[2]],
 ['quero 2 unidades de pão de queijo',['pão de queijo'],[2]],
 ['quero 2x pão de queijo',['pão de queijo'],[2]],
 ['quero uma coxinha',['coxinha'],[1]],
 ['quero um croissant',['croissant'],[1]],
 ['quero 2 pães de queijo e um croissant',['pão de queijo','croissant'],[2,1]],
 ['café com leite até R$ 15',['café com leite'],[1]],
 ['quero açaí 500ml',['açaí 500ml'],[1]],
 ['quero pizza 4 queijos',['pizza 4 queijos'],[1]],
 ['pão de queijo 2 unidades',['pão de queijo'],[2]],
] as const)('quantidade da mensagem %s é independente do modelo omitir números',async(text,wishes,expected)=>{
 const result=await collect(text,[...wishes]);expect(result.outcome).toBe('preference_updated');expect(quantities(result)).toEqual(expected);
});
it.each(['quero 0 pães de queijo','quero -1 pão de queijo','quero 1,5 pães de queijo','quero 11 pães de queijo','quero alguns pães de queijo','quero 2 ou 3 pães de queijo','quero uma dúzia de pães de queijo','agora quero 2','quero mais 2 pães de queijo'])(
 'quantidade inválida ou ambígua %s não produz quantidade inventada',async text=>{
 const result=await collect(text,['pão de queijo']);expect(result.outcome).toBe('clarification');expect(result.session).toEqual(empty());expect(result.actions[0]).toMatchObject({type:'send_message',participantId:'a'});
});
it('mudança para quantidade um ou outro produto não carrega a quantidade anterior',async()=>{
 const two=await collect('quero 2 pães de queijo',['pão de queijo']);expect(quantities(two)).toEqual([2]);
 const one=await collect('agora quero um pão de queijo',['pão de queijo'],two.session);expect(quantities(one)).toEqual([1]);
 const changed=await collect('na verdade quero um croissant',['croissant'],two.session);expect(changed.session.participants[0]!.preferences.wishes).toEqual(['croissant']);expect(quantities(changed)).toEqual([1]);
});
it('atualização apenas de restrição não perde a quantidade comprovada do mesmo desejo',async()=>{
 const two=await collect('quero 2 pães de queijo',['pão de queijo']);
 const result=await coletar(two.session,{sessionId:'group',participantId:'a',text:'sem lactose'},{llm:{generate:async()=>({...output(['pão de queijo']),dietaryRestrictions:['sem lactose']})}});
 expect(quantities(result)).toEqual([2]);expect(result.session.participants[0]!.preferences.dietaryRestrictions).toEqual(['sem lactose']);
});
it('coleta em lote associa quantidade à pessoa e mensagem mais recente',async()=>{
 const result=await coletarLote(empty(),[{participantId:'a',text:'quero 2 pães de queijo'},{participantId:'b',displayName:'Bia',text:'quero um croissant'}],{llm:{generate:async()=>({resultados:[{participantId:'a',...output(['pão de queijo'])},{participantId:'b',...output(['croissant'])}]})}});
 expect(result.session.participants.map(p=>p.preferences.wishQuantities??[1])).toEqual([[2],[1]]);
 const changed=await coletarLote(result.session,[{participantId:'a',text:'quero 2 pães de queijo'},{participantId:'a',text:'na verdade quero 3 pães de queijo'}],{llm:{generate:async()=>({resultados:[{participantId:'a',...output(['pão de queijo'])}]})}});
 expect(changed.session.participants[0]!.preferences.wishQuantities).toEqual([3]);
});
it.each(['quero .5 pães de queijo','quero −1 pão de queijo','quero 1e2 pães de queijo','quero onze pães de queijo','quero 2% pães de queijo'])(
 'notação de quantidade insegura %s exige esclarecimento',async text=>{expect((await collect(text,['pão de queijo'])).outcome).toBe('clarification');});
it.each(['quero zero pães de queijo','quero doze pães de queijo','quero até 2 pães de queijo','quero no máximo 2 pães de queijo','quero cerca de 2 pães de queijo'])(
 'quantidade não exata %s não vira uma unidade nem limite escolhido',async text=>{expect((await collect(text,['pão de queijo'])).outcome).toBe('clarification');});
it.each([
 ['gostaria de 3 croissants',['croissant'],[3]],
 ['gostaria de 3 pastéis',['pastel'],[3]],
 ['quero 2 pães de queijo e também 3 croissants',['pão de queijo','croissant'],[2,3]],
] as const)('plurais e conjunções em %s preservam contagens, sem depender do nome singular literal',async(text,wishes,expected)=>{expect(quantities(await collect(text,[...wishes]))).toEqual(expected);});
it('alteração só de restrição que menciona o produto conserva sua quantidade comprovada',async()=>{
 const four=await collect('quero 4 pães de queijo',['pão de queijo']);
 const result=await coletar(four.session,{sessionId:'group',participantId:'a',text:'sem lactose no pão de queijo'},{llm:{generate:async()=>({...output(['pão de queijo']),dietaryRestrictions:['sem lactose']})}});
 expect(quantities(result)).toEqual([4]);expect(result.session.participants[0]!.preferences.dietaryRestrictions).toEqual(['sem lactose']);
});
it('contagem avulsa um sem produto ou vínculo não mantém quantidade antiga por engano',async()=>{
 const two=await collect('quero 2 pães de queijo',['pão de queijo']);expect((await collect('agora quero um',['pão de queijo'],two.session)).outcome).toBe('clarification');
});
it.each(['2','11','0','-1','.5','onze'])('contagem %s mantida indevidamente no nome pelo modelo não vira uma unidade',async count=>{
 const result=await collect(`quero ${count} pães de queijo`,[`${count} pães de queijo`]);
 expect(result.outcome).toBe('clarification');expect(result.session).toEqual(empty());
});
it('mais um sem quantidade final exige esclarecimento',async()=>{
 expect((await collect('quero pão de queijo e mais um',['pão de queijo'])).outcome).toBe('clarification');
});
it.each(['pão de queijo 11 unidades','pão de queijo 0 unidades','pão de queijo 2 unidades','pão de queijo x 2','pão de queijo x2'])('sufixo de contagem no nome %s não é tratado como identidade do produto',async wish=>{
 expect((await collect(wish,[wish])).outcome).toBe('clarification');
});
it('orçamento com moeda antes do produto não é contagem nem limite de unidades',async()=>{
 expect((await collect('R$ 25,90 no máximo, lanche',['lanche'])).outcome).toBe('preference_updated');
});
it('atualização sem desejos não interpreta números de outros assuntos como quantidade',async()=>{
 expect((await collect('até 25 reais, orçamento de todos como 0',[])).outcome).toBe('preference_updated');
});
