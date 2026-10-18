import { afterEach, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import type { Agente, DiscoveryItem, Resposta } from '../../src/core/index.js';
import { atualizarCard, exibirProposta, propostaDoCard, retirarBotoesDoCard, type ApiCard } from '../../src/telegram/services/proposta-tela.js';
let sequence = 0;
const image = (id: string) => `https://static.ifood-static.com.br/${id}.jpg?signature=keep`;
function setup(chosen = ['a', 'b']) {
  const group = `item-cards-${++sequence}`;
  const items: DiscoveryItem[] = ['a','b','c','rejected'].map(id => ({ id, storeId: id === 'b' ? 's2' : 's1', name: `Produto <${id}>`, itemImageUrl: image(id), priceCents: 2590 }));
  const participants = [{ id: 'p1', displayName: 'Ana & Bia', preferences: {} }, { id: 'p2', displayName: 'Bruno', preferences: {} }];
  const proposal: NonNullable<Resposta['preliminary']> = { id:'p1', sessionId:group, organizerId:'p1', address:{formatted:'Privado'}, participants, items:chosen.map((menuItemId,n)=>({participantId:participants[n%2]!.id,storeId:menuItemId==='b'?'s2':'s1',menuItemId,quantity:1})), status:'preliminary',pending:['commercial_validation'], coverage:{terms:2,stores:2,items:4,requests:10,limited:true,classificationLimited:true} };
  let current = proposal;
  const stores = [{id:'s1',name:'Loja <A>',isOpen:true,reviewRating:4.7,ratingCount:850},{id:'s2',name:'Loja & B',isOpen:true,reviewRating:3.9,ratingCount:12}];
  const response: Resposta = { outcome:'preliminary_ready',preliminary:proposal,items,stores,actions:[] };
  const iris = {obter:vi.fn<Agente['obter']>(async()=>({id:group,organizerId:'p1',participants,status:'collecting',preliminary:current,preliminaryAlternative:{...proposal,id:'alternative'}})),nomes:vi.fn(async()=>({lojas:Object.fromEntries(stores.map(s=>[s.id,s.name])),itens:Object.fromEntries(items.map(i=>[i.id,i.name]))}))};
  let id=10;const delivered:{id:number;type:'text'|'photo';text:string;options:Record<string,unknown>}[]=[];
  const sendMessage=vi.fn(async(...args:Parameters<Api['sendMessage']>)=>{const message_id=++id;delivered.push({id:message_id,type:'text',text:args[1],options:args[2] as Record<string,unknown>??{}});return {message_id};});
  const sendPhoto=vi.fn(async(...args:Parameters<Api['sendPhoto']>)=>{const message_id=++id;delivered.push({id:message_id,type:'photo',text:args[2]?.caption??'',options:args[2] as Record<string,unknown>??{}});return {message_id};});
  const deleteMessage=vi.fn(async(..._args:Parameters<Api['deleteMessage']>)=>{void _args;return true;});
  const editMessageReplyMarkup=vi.fn(async(..._args:Parameters<Api['editMessageReplyMarkup']>)=>{void _args;return true;});
  const editMessageText=vi.fn(async(..._args:Parameters<Api['editMessageText']>)=>{void _args;return true;});
  const editMessageCaption=vi.fn(async(..._args:Parameters<Api['editMessageCaption']>)=>{void _args;return true;});
  const api={sendMessage,sendPhoto,deleteMessage,editMessageReplyMarkup,editMessageText,editMessageCaption} as unknown as ApiCard;
  const fetchImage=vi.fn<typeof fetch>(async()=>new Response(new Uint8Array([255,216,255]),{headers:{'content-type':'image/jpeg'}}));vi.stubGlobal('fetch',fetchImage);
  return {group,response,iris,api,items,stores,delivered,sendMessage,sendPhoto,deleteMessage,editMessageReplyMarkup,editMessageText,editMessageCaption,fetchImage,
    replace(chosen=['c']){current={...proposal,id:'p2',items:chosen.map(menuItemId=>({participantId:'p1',storeId:'s1',menuItemId,quantity:1}))};return {...response,preliminary:current};}};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('duas pessoas e dois produtos recebem resumo único com botões e duas fotos individuais, sem duplicação',async()=>{
 const f=setup();await exibirProposta(f.api,f.iris,f.group,f.response,'bot');
 expect(f.delivered.map(m=>m.type)).toEqual(['text','photo','photo']);
 const [main,a,b]=f.delivered;
 expect(main!.text).toContain('Sugestão preliminar');expect(main!.text).toContain('2 de 2');expect(main!.text).toContain('Amostra');expect(main!.text).toContain('Classificação limitada');expect(main!.text).toContain('Nenhum carrinho, pagamento ou compra');
 expect(main!.text).not.toMatch(/Produto|Loja|R\$|[Ss]ubtotal|[Tt]otal/);expect(main!.options.reply_markup).toBeDefined();
 expect(a!.text).toContain('Produto &lt;a&gt;');expect(a!.text).toContain('Ana &amp; Bia');expect(a!.text).not.toContain('Bruno');expect(a!.text).toContain('Loja &lt;A&gt;');expect(a!.text).toContain('⭐ 4,7 (850 avaliações)');expect(a!.text).not.toContain('3,9');
 expect(b!.text).toContain('Produto &lt;b&gt;');expect(b!.text).toContain('Bruno');expect(b!.text).toContain('Loja &amp; B');expect(b!.text).toContain('⭐ 3,9 (12 avaliações)');expect(b!.text).not.toContain('4,7');
 for(const m of [a!,b!]){expect(m.text).toContain('R$ 25,90 por unidade');expect(m.text).toContain('disponibilidade não confirmada');expect(m.options.reply_markup).toBeUndefined();expect(m.options.reply_parameters).toEqual({message_id:11});expect(m.options.parse_mode).toBe('HTML');expect(propostaDoCard(f.group,m.id)).toBeUndefined();}
 expect(propostaDoCard(f.group,main!.id)).toBe('p1');expect(f.fetchImage.mock.calls.map(([url])=>String(url))).toEqual([image('a'),image('b')]);
});
it('uma pessoa com um item recebe exatamente um resumo e uma mensagem de item',async()=>{
 const f=setup(['a']);f.response.preliminary!.participants.splice(1);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.delivered).toHaveLength(2);expect(f.delivered[0]!.text).toContain('1 de 1');expect(f.sendPhoto).toHaveBeenCalledTimes(1);
});
it.each(['missing','unsafe','foreign'])('imagem %s usa texto individual sem incorporar item ao resumo',async mode=>{
 const f=setup(['a']);if(mode==='missing')delete f.items[0]!.itemImageUrl;if(mode==='unsafe')f.items[0]!.itemImageUrl='http://localhost/a';if(mode==='foreign')f.items[0]!.storeId='other';
 await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.delivered.map(m=>m.type)).toEqual(['text','text']);expect(f.delivered[0]!.text).not.toContain('Produto');expect(f.delivered[1]!.text).toContain('Produto &lt;a&gt;');expect(f.delivered[1]!.options.reply_markup).toBeUndefined();expect(f.delivered[1]!.options.reply_parameters).toEqual({message_id:11});expect(f.fetchImage).not.toHaveBeenCalled();
});
it.each(['download','telegram','redirect','size','mime'])('falha %s em um item mantém texto individual e não bloqueia o próximo',async failure=>{
 const f=setup();if(failure==='download')f.fetchImage.mockRejectedValueOnce(new Error('PRIVATE_URL'));if(failure==='telegram')f.sendPhoto.mockRejectedValueOnce(new Error('PRIVATE_TOKEN'));
 if(failure==='redirect')f.fetchImage.mockResolvedValueOnce(new Response(null,{status:302}));if(failure==='size')f.fetchImage.mockResolvedValueOnce(new Response(new Uint8Array(5_000_001),{headers:{'content-type':'image/jpeg'}}));if(failure==='mime')f.fetchImage.mockResolvedValueOnce(new Response('html',{headers:{'content-type':'text/html'}}));
 const log=vi.spyOn(console,'error');await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.delivered.map(m=>m.type)).toEqual(['text','text','photo']);expect(f.delivered[1]!.text).toContain('Produto &lt;a&gt;');expect(f.delivered[2]!.text).toContain('Produto &lt;b&gt;');expect(log).not.toHaveBeenCalled();
});
it('produto compartilhado ou registro duplicado gera uma mensagem com as pessoas e quantidades correspondentes',async()=>{
 const f=setup(['a','a']);f.response.preliminary!.items.push({...f.response.preliminary!.items[0]!});await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendPhoto).toHaveBeenCalledTimes(1);expect(f.delivered[1]!.text).toContain('Ana &amp; Bia');expect(f.delivered[1]!.text).toContain('Bruno');expect(f.delivered[1]!.text.match(/Ana &amp; Bia/g)).toHaveLength(1);
});
it('dois produtos com a mesma URL continuam com mensagens individuais, sem candidatos rejeitados',async()=>{
 const f=setup();f.items[1]!.itemImageUrl=image('a');await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendPhoto).toHaveBeenCalledTimes(2);expect(f.delivered).toHaveLength(3);expect(f.delivered.map(m=>m.text).join('\n')).not.toContain('rejected');
});
it('atualizar ou revisar a mesma proposta não reenvia mensagens dos itens',async()=>{
 const f=setup();await exibirProposta(f.api,f.iris,f.group,f.response,'bot');await atualizarCard(f.api,f.iris,f.group,f.response);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(f.sendPhoto).toHaveBeenCalledTimes(2);expect(propostaDoCard(f.group,11)).toBe('p1');
});
it('atualização de metadados edita legenda do item e mantém resumo textual',async()=>{
 const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.editMessageCaption).toHaveBeenCalledWith(f.group,12,expect.objectContaining({caption:expect.stringContaining('R$ 32,90 por unidade'),parse_mode:'HTML'}),expect.any(AbortSignal));expect(f.sendPhoto).toHaveBeenCalledTimes(1);expect(propostaDoCard(f.group,11)).toBe('p1');
});
it('atualiza item textual sem promover para foto e sem criar outro resumo',async()=>{
 const f=setup(['a']);delete f.items[0]!.itemImageUrl;await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;f.items[0]!.itemImageUrl=image('a');await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.editMessageText).toHaveBeenCalledWith(f.group,12,expect.stringContaining('R$ 32,90'),expect.objectContaining({parse_mode:'HTML'}),expect.any(AbortSignal));expect(f.sendMessage).toHaveBeenCalledTimes(2);expect(f.sendPhoto).not.toHaveBeenCalled();
});
it('legenda longa usa texto individual completo e não bloqueia outro produto',async()=>{
 const f=setup();f.items[0]!.name='Nome '+ 'Z'.repeat(1100);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.delivered.map(m=>m.type)).toEqual(['text','text','photo']);expect(f.delivered[1]!.text).toContain(f.items[0]!.name);expect(f.fetchImage.mock.calls.map(([url])=>String(url))).toEqual([image('b')]);
});
it('legenda que cresce demais substitui somente a mensagem do item por texto completo',async()=>{
 const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.name='Z'.repeat(1100);await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.delivered).toHaveLength(3);expect(f.delivered[2]!.text).toContain(f.items[0]!.name);expect(f.deleteMessage).toHaveBeenCalledWith(f.group,12,expect.any(AbortSignal));expect(propostaDoCard(f.group,11)).toBe('p1');
});
it.each(['download','telegram'])('timeout de %s não atrasa o resumo e termina com fallback individual',async phase=>{
 vi.useFakeTimers();const f=setup();if(phase==='download')f.fetchImage.mockImplementationOnce(()=>new Promise(()=>{}));else f.sendPhoto.mockImplementationOnce(()=>new Promise(()=>{}));const task=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await vi.advanceTimersByTimeAsync(0);expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(propostaDoCard(f.group,11)).toBe('p1');await vi.advanceTimersByTimeAsync(2500);await task;expect(f.delivered.map(m=>m.type)).toEqual(['text','text','photo']);
});
it('foto tardia depois do timeout é removida e não duplica o fallback individual',async()=>{
 vi.useFakeTimers();const f=setup(['a']);let resolve!:(value:{message_id:number})=>void;f.sendPhoto.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const task=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await vi.advanceTimersByTimeAsync(2500);await task;resolve({message_id:90});await vi.advanceTimersByTimeAsync(0);expect(f.deleteMessage).toHaveBeenCalledWith(f.group,90,expect.any(AbortSignal));expect(f.delivered.map(m=>m.type)).toEqual(['text','text']);expect(propostaDoCard(f.group,11)).toBe('p1');
});
it('alternativa remove resumo e itens antigos, mostrando somente os novos selecionados',async()=>{
 const f=setup();await exibirProposta(f.api,f.iris,f.group,f.response,'bot');await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');for(const id of [11,12,13])expect(f.deleteMessage).toHaveBeenCalledWith(f.group,id,expect.any(AbortSignal));expect(propostaDoCard(f.group,11)).toBeUndefined();expect(propostaDoCard(f.group,14)).toBe('p2');expect(f.delivered.at(-1)!.text).toContain('Produto &lt;c&gt;');
});
it('volta para coleta invalida e remove resumo, fotos e itens textuais',async()=>{
 const f=setup();delete f.items[1]!.itemImageUrl;await exibirProposta(f.api,f.iris,f.group,f.response,'bot');await retirarBotoesDoCard(f.api,f.group);expect(propostaDoCard(f.group,11)).toBeUndefined();for(const id of [11,12,13])expect(f.deleteMessage).toHaveBeenCalledWith(f.group,id,expect.any(AbortSignal));
});
it('foto antiga em voo é removida sem apresentar os demais itens da revisão substituída',async()=>{
 const f=setup();let resolve!:(v:{message_id:number})=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});f.sendPhoto.mockImplementationOnce(()=>{entered();return new Promise(done=>{resolve=done;});});const old=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await ready;await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');resolve({message_id:90});await old;expect(f.sendPhoto).toHaveBeenCalledTimes(2);expect(f.deleteMessage).toHaveBeenCalledWith(f.group,90,expect.any(AbortSignal));expect(propostaDoCard(f.group,12)).toBe('p2');expect(f.delivered.filter(m=>m.text.includes('Produto &lt;b&gt;'))).toHaveLength(0);
});
it('cancelamento durante download não envia fotos nem fallback tardio',async()=>{
 const f=setup();f.fetchImage.mockImplementationOnce(async()=>{await retirarBotoesDoCard(f.api,f.group);return new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg'}});});await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.delivered).toHaveLength(1);expect(propostaDoCard(f.group,11)).toBeUndefined();
});
it('resumo que chega após cancelamento é removido sem registrar callbacks nem enviar itens',async()=>{
 const f=setup();f.sendMessage.mockImplementationOnce(async()=>{await retirarBotoesDoCard(f.api,f.group);return {message_id:90};});await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(propostaDoCard(f.group,90)).toBeUndefined();expect(f.deleteMessage).toHaveBeenCalledWith(f.group,90,expect.any(AbortSignal));expect(f.sendPhoto).not.toHaveBeenCalled();
});
it('falha ao enviar texto de um item não bloqueia os outros ou o card principal',async()=>{
 const f=setup();delete f.items[0]!.itemImageUrl;const send=f.sendMessage.getMockImplementation()!;f.sendMessage.mockImplementationOnce(send).mockRejectedValueOnce(new Error('PRIVATE_TEXT_FAILURE'));await expect(exibirProposta(f.api,f.iris,f.group,f.response,'bot')).resolves.toBe(true);expect(f.delivered.map(m=>m.type)).toEqual(['text','photo']);expect(propostaDoCard(f.group,11)).toBe('p1');
});
it.each([['photo','cancelar'],['photo','substituir'],['text','cancelar'],['text','substituir']] as const)('edição tardia de item %s após %s não reapresenta mensagem antiga',async(kind,action)=>{
 const f=setup(['a']);if(kind==='text')delete f.items[0]!.itemImageUrl;await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;let release!:()=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});const delay=new Promise<void>(done=>{release=done;});const edit=async()=>{entered();await delay;return true;};if(kind==='photo')f.editMessageCaption.mockImplementationOnce(edit);else f.editMessageText.mockImplementation(async(_chat,id)=>id===12?edit():true);
 const pending=atualizarCard(f.api,f.iris,f.group,f.response);await ready;if(action==='cancelar')await retirarBotoesDoCard(f.api,f.group);else await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');const before=f.deleteMessage.mock.calls.filter(([,id])=>id===12).length;release();await pending;expect(f.deleteMessage.mock.calls.filter(([,id])=>id===12).length).toBeGreaterThan(before);expect(propostaDoCard(f.group,11)).toBeUndefined();
});
it('callback de mensagem de item não é callback do resumo; revisão divergente não é atualizada',async()=>{
 const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');await atualizarCard(f.api,f.iris,f.group,f.replace());expect(propostaDoCard(f.group,12)).toBeUndefined();expect(propostaDoCard(f.group,11)).toBe('p1');expect(f.editMessageText).not.toHaveBeenCalled();
});
it('reapresentação concorrente da mesma revisão não duplica mensagens de item em envio',async()=>{
 const f=setup(['a']);let release!:(v:{message_id:number})=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});f.sendPhoto.mockImplementationOnce(()=>{entered();return new Promise(done=>{release=done;});});const pending=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await ready;await exibirProposta(f.api,f.iris,f.group,f.response,'bot');release({message_id:12});await pending;expect(f.sendPhoto).toHaveBeenCalledTimes(1);expect(f.sendMessage).toHaveBeenCalledTimes(1);
});
it('edição de legenda recusada substitui somente o item por texto, preservando resumo e botões',async()=>{
 const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;f.editMessageCaption.mockRejectedValueOnce(new Error('PRIVATE_REJECTION'));await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.delivered.at(-1)!.type).toBe('text');expect(f.delivered.at(-1)!.text).toContain('R$ 32,90');expect(f.deleteMessage).toHaveBeenCalledWith(f.group,12,expect.any(AbortSignal));expect(propostaDoCard(f.group,11)).toBe('p1');
});
it('download depois do timeout não envia foto após fallback do item',async()=>{
 vi.useFakeTimers();const f=setup(['a']);let resolve!:(v:Response)=>void;f.fetchImage.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const task=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await vi.advanceTimersByTimeAsync(2500);await task;resolve(new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg'}}));await vi.advanceTimersByTimeAsync(0);expect(f.sendPhoto).not.toHaveBeenCalled();expect(f.delivered.map(m=>m.type)).toEqual(['text','text']);
});
it('resposta textual de item depois do timeout é removida sem alterar resumo ou próximos itens',async()=>{
 vi.useFakeTimers();const f=setup();delete f.items[0]!.itemImageUrl;const send=f.sendMessage.getMockImplementation()!;let resolve!:(v:{message_id:number})=>void;f.sendMessage.mockImplementationOnce(send).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const task=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await vi.advanceTimersByTimeAsync(2500);await task;resolve({message_id:90});await vi.advanceTimersByTimeAsync(0);expect(f.deleteMessage).toHaveBeenCalledWith(f.group,90,expect.any(AbortSignal));expect(propostaDoCard(f.group,11)).toBe('p1');expect(f.delivered.at(-1)!.text).toContain('Produto &lt;b&gt;');
});
it.each(['cancelar','substituir'])('edição tardia do resumo após %s não restaura callbacks, mesmo se exclusão falhar',async action=>{
 const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');let release!:()=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});const delay=new Promise<void>(done=>{release=done;});let buttons=true;f.editMessageText.mockImplementationOnce(async()=>{entered();await delay;buttons=true;return true;});f.editMessageReplyMarkup.mockImplementation(async(_chat,id)=>{if(id===11)buttons=false;return true;});f.deleteMessage.mockRejectedValue(new Error('PRIVATE_DELETE_FAILURE'));
 const task=atualizarCard(f.api,f.iris,f.group,f.response);await ready;if(action==='cancelar')await retirarBotoesDoCard(f.api,f.group);else await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');release();await task;expect(buttons).toBe(false);expect(propostaDoCard(f.group,11)).toBeUndefined();
});
it('duas atualizações da mesma revisão preservam o resumo e suas mensagens de item',async()=>{
 const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');await Promise.all([atualizarCard(f.api,f.iris,f.group,f.response),atualizarCard(f.api,f.iris,f.group,f.response)]);expect(f.deleteMessage).not.toHaveBeenCalled();expect(propostaDoCard(f.group,11)).toBe('p1');expect(f.delivered).toHaveLength(2);
});
it('IDs de produto iguais em lojas distintas não são fundidos nem recebem nota ou foto alheia',async()=>{
 const f=setup();f.items[1]!.id='a';f.items[1]!.name='Outro produto';f.response.preliminary!.items[1]!.menuItemId='a';await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendPhoto).toHaveBeenCalledTimes(2);expect(f.delivered[2]!.text).toContain('Outro produto');expect(f.delivered[2]!.text).toContain('⭐ 3,9');expect(f.delivered[2]!.text).not.toContain('⭐ 4,7');
});
it('legenda individual respeita o limite de 1024 sem truncar na fronteira',async()=>{
 const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');const first=f.sendPhoto.mock.calls[0]![2]!.caption!;f.items[0]!.name+='Z'.repeat(1024-first.length);await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.editMessageCaption.mock.calls.at(-1)?.[2]?.caption?.length).toBe(1024);f.items[0]!.name+='Z';await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.delivered.at(-1)!.type).toBe('text');expect(f.delivered.at(-1)!.text).toContain(f.items[0]!.name.replace('<','&lt;').replace('>','&gt;'));
});
it('metadados atualizados enquanto a foto está em voo são aplicados ao item sem duplicar',async()=>{
 const f=setup(['a']);let resolve!:(v:{message_id:number})=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});f.sendPhoto.mockImplementationOnce(()=>{entered();return new Promise(done=>{resolve=done;});});const task=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await ready;f.items[0]!.priceCents=3290;await atualizarCard(f.api,f.iris,f.group,f.response);resolve({message_id:12});await task;expect(f.sendPhoto).toHaveBeenCalledTimes(1);expect(f.editMessageCaption).toHaveBeenCalledWith(f.group,12,expect.objectContaining({caption:expect.stringContaining('R$ 32,90')}),expect.any(AbortSignal));
});
it('catchup de legenda pendurado não impede a apresentação do segundo produto',async()=>{
 vi.useFakeTimers();const f=setup();let resolve!:(v:{message_id:number})=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});f.sendPhoto.mockImplementationOnce(()=>{entered();return new Promise(done=>{resolve=done;});});f.editMessageCaption.mockImplementationOnce(()=>new Promise(()=>{}));let finished=false;const task=exibirProposta(f.api,f.iris,f.group,f.response,'bot').then(()=>{finished=true;});await ready;f.items[0]!.priceCents=3290;await atualizarCard(f.api,f.iris,f.group,f.response);resolve({message_id:90});await vi.advanceTimersByTimeAsync(4500);expect(finished).toBe(true);await task;expect(f.sendPhoto).toHaveBeenCalledTimes(2);expect(f.delivered.some(m=>m.text.includes('Produto &lt;b&gt;'))).toBe(true);
});
it.each(['photo','text'])('edição %s pendurada tem prazo e não segura a atualização do próximo item',async kind=>{
 vi.useFakeTimers();const f=setup();if(kind==='text')delete f.items[0]!.itemImageUrl;await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;f.items[1]!.priceCents=4290;if(kind==='photo')f.editMessageCaption.mockImplementationOnce(()=>new Promise(()=>{}));else f.editMessageText.mockImplementation(async(_chat,id)=>id===12?new Promise(()=>{}):true);let finished=false;const task=atualizarCard(f.api,f.iris,f.group,f.response).then(()=>{finished=true;});await vi.advanceTimersByTimeAsync(4500);expect(finished).toBe(true);await task;expect(f.editMessageCaption).toHaveBeenCalledWith(f.group,13,expect.objectContaining({caption:expect.stringContaining('R$ 42,90')}),expect.any(AbortSignal));
});
it('reapresentação tenta novamente só o item cujo envio falhou, sem duplicar os entregues',async()=>{
 const f=setup();delete f.items[0]!.itemImageUrl;const send=f.sendMessage.getMockImplementation()!;f.sendMessage.mockImplementationOnce(send).mockRejectedValueOnce(new Error('PRIVATE_TEXT_FAILURE'));await exibirProposta(f.api,f.iris,f.group,f.response,'bot');await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendPhoto).toHaveBeenCalledTimes(1);expect(f.delivered.filter(m=>m.text.includes('Produto &lt;a&gt;'))).toHaveLength(1);expect(f.delivered.filter(m=>m.text.includes('Produto &lt;b&gt;'))).toHaveLength(1);expect(f.delivered.filter(m=>m.text.includes('Sugestão preliminar'))).toHaveLength(1);
});
it('edição que termina depois do timeout limpa somente o item antigo, mantendo seu substituto textual',async()=>{
 vi.useFakeTimers();const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;let release!:(v:true)=>void;f.editMessageCaption.mockImplementationOnce(()=>new Promise(done=>{release=done;}));let finished=false;const task=atualizarCard(f.api,f.iris,f.group,f.response).then(()=>{finished=true;});await vi.advanceTimersByTimeAsync(4500);expect(finished).toBe(true);await task;expect(f.delivered.at(-1)!.type).toBe('text');const replacement=f.delivered.at(-1)!.id;release(true);await vi.advanceTimersByTimeAsync(0);expect(f.deleteMessage).toHaveBeenCalledWith(f.group,12,expect.any(AbortSignal));expect(f.deleteMessage.mock.calls.some(([,id])=>id===replacement)).toBe(false);f.items[0]!.priceCents=4290;await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.editMessageText).toHaveBeenCalledWith(f.group,replacement,expect.stringContaining('R$ 42,90'),expect.anything(),expect.any(AbortSignal));
});

it('edição pendurada do resumo preserva seus botões e não bloqueia atualizações dos itens',async()=>{
 vi.useFakeTimers();const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;f.editMessageText.mockImplementationOnce(()=>new Promise(()=>{}));let finished=false;const task=atualizarCard(f.api,f.iris,f.group,f.response).then(()=>{finished=true;});await vi.advanceTimersByTimeAsync(2500);expect(finished).toBe(true);await task;expect(propostaDoCard(f.group,11)).toBe('p1');expect(f.editMessageCaption).toHaveBeenCalledWith(f.group,12,expect.objectContaining({caption:expect.stringContaining('R$ 32,90')}),expect.any(AbortSignal));expect(f.delivered).toHaveLength(2);
});
it('edição tardia após fallback recusado não apaga nem sobrescreve o item atualizado depois',async()=>{
 vi.useFakeTimers();const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');const live=new Map(f.delivered.map(m=>[m.id,m.text]));let release!:(v:true)=>void;const delayed=new Promise<true>(done=>{release=done;});
 f.deleteMessage.mockImplementation(async(_chat,id)=>{live.delete(id);return true;});
 f.editMessageCaption.mockImplementation(async(_chat,id,options)=>{if(live.has(id))live.set(id,options?.caption??'');return true;});
 f.editMessageCaption.mockImplementationOnce(async(_chat,id,options)=>{await delayed;if(live.has(id))live.set(id,options?.caption??'');return true;});
 const send=f.sendPhoto.getMockImplementation()!;f.sendPhoto.mockImplementation(async(...args)=>{const result=await send(...args);live.set(result.message_id,args[2]?.caption??'');return result;});
 f.sendMessage.mockRejectedValueOnce(new Error('PRIVATE_FALLBACK_REJECTION'));f.items[0]!.priceCents=3290;const first=atualizarCard(f.api,f.iris,f.group,f.response);await vi.advanceTimersByTimeAsync(4500);await first;f.items[0]!.priceCents=4290;await atualizarCard(f.api,f.iris,f.group,f.response);release(true);await vi.advanceTimersByTimeAsync(0);expect([...live.values()].some(text=>text.includes('R$ 42,90 por unidade'))).toBe(true);expect(propostaDoCard(f.group,11)).toBe('p1');
});
