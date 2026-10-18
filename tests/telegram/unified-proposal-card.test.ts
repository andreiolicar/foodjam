import { afterEach, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import type { Agente, DiscoveryItem, PreliminaryProposal, Resposta } from '../../src/core/index.js';
import { atualizarCard, exibirProposta, propostaDoCard, retirarBotoesDoCard, type ApiCard } from '../../src/telegram/services/proposta-tela.js';
import { textoPropostaPreliminar, legendaPropostaPreliminar } from '../../src/telegram/services/card.js';
let sequence = 0;
const image = (id: string) => `https://static.ifood-static.com.br/${id}.jpg?signature=keep`;
function setup(chosen = ['a', 'b']) {
  const group = `unified-${++sequence}`;
  const items: DiscoveryItem[] = ['a','b','c','rejected'].map(id => ({ id, storeId: id === 'c' ? 's2' : 's1', name: `Produto <${id}>`, itemImageUrl: image(id), priceCents: 2590, available: true }));
  const participants = [{ id: 'p', displayName: 'Ana & Bia', preferences: {} }];
  const proposal: PreliminaryProposal = { id: 'p1', sessionId: group, organizerId: 'p', address: { formatted: 'Privado' }, participants, items: chosen.map(menuItemId => ({ participantId: 'p', storeId: menuItemId === 'c' ? 's2' : 's1', menuItemId, quantity: 1 })), status: 'preliminary', pending: ['commercial_validation'] };
  let current = proposal;
  const stores = [{ id:'s1', name:'Loja <A>', isOpen:true, reviewRating:4.7, ratingCount:850 }, { id:'s2', name:'Loja & B', isOpen:true, reviewRating:3.9, ratingCount:12 }];
  const response: Resposta = { outcome:'preliminary_ready', preliminary:proposal, items, stores, actions:[] };
  const names = () => ({ lojas:Object.fromEntries(stores.map(s=>[s.id,s.name])), itens:Object.fromEntries(items.map(i=>[i.id,i.name])) });
  const iris = { obter: vi.fn<Agente['obter']>(async () => ({ id:group, organizerId:'p', participants, status:'collecting', preliminary:current, preliminaryAlternative:{...proposal,id:'alternative'} })), nomes: vi.fn(async () => names()) };
  const delivered: {type:'photo'|'text';id:number}[] = []; let id=10;
  const sendPhoto = vi.fn(async (..._args: Parameters<Api['sendPhoto']>) => { void _args; const message_id=++id; delivered.push({type:'photo',id:message_id}); return {message_id}; });
  const sendMessage = vi.fn(async (..._args: Parameters<Api['sendMessage']>) => { void _args; const message_id=++id; delivered.push({type:'text',id:message_id}); return {message_id}; });
  const deleteMessage = vi.fn(async (..._args: Parameters<Api['deleteMessage']>) => { void _args; return true; });
  const editMessageReplyMarkup = vi.fn(async (..._args: Parameters<Api['editMessageReplyMarkup']>) => { void _args; return true; });
  const editMessageText = vi.fn(async (..._args: Parameters<Api['editMessageText']>) => { void _args; return true; });
  const editMessageCaption = vi.fn(async (..._args: Parameters<Api['editMessageCaption']>) => { void _args; return true; });
  const api={sendPhoto,sendMessage,deleteMessage,editMessageReplyMarkup,editMessageText,editMessageCaption} as unknown as ApiCard;
  const fetchImage = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([255,216,255]),{headers:{'content-type':'image/jpeg'}}));
  vi.stubGlobal('fetch',fetchImage);
  return {group,response,iris,api,items,stores,names,sendPhoto,sendMessage,deleteMessage,editMessageReplyMarkup,editMessageText,editMessageCaption,fetchImage,delivered,
    replace(chosen=['c']) { current={...proposal,id:'p2',items:chosen.map(menuItemId=>({participantId:'p',storeId:menuItemId==='c'?'s2':'s1',menuItemId,quantity:1}))};return {...response,preliminary:current}; }};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('envia uma única foto principal com descrição HTML e botões, registrando a própria mensagem como card', async()=>{
  const f=setup(['b','a','c']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');
  expect(f.delivered).toEqual([{type:'photo',id:11}]);expect(f.sendPhoto).toHaveBeenCalledTimes(1);expect(f.sendMessage).not.toHaveBeenCalled();
  expect(f.fetchImage.mock.calls.map(([url])=>String(url))).toEqual([image('b')]);
  const options=f.sendPhoto.mock.calls[0]![2]!;expect(options.parse_mode).toBe('HTML');expect(options.reply_parameters).toBeUndefined();
  const caption=options.caption!;expect(caption.length).toBeLessThanOrEqual(1024);
  expect(caption).toContain('Loja &lt;A&gt;');expect(caption).toContain('⭐ 4,7 (850 avaliações)');expect(caption).toContain('Loja &amp; B');expect(caption).toContain('⭐ 3,9 (12 avaliações)');
  for(const id of ['a','b','c'])expect(caption).toContain(`Produto &lt;${id}&gt;`);
  expect(caption).toContain('Ana &amp; Bia');expect(caption).toContain('R$ 25,90');expect(caption).toContain('1 de 1');
  expect(caption).toMatch(/Frete, taxas, descontos, total e orçamento final/);expect(caption).toContain('carrinho');expect(caption).toMatch(/disponibilidade|Disponibilidade/);expect(caption).toMatch(/Nenhum carrinho, pagamento ou compra/);
  const keyboard=options.reply_markup as {inline_keyboard:{callback_data?:string}[][]};
  expect(keyboard.inline_keyboard.flat().map(b=>b.callback_data)).toEqual(['proposta:revisar','proposta:outra','proposta:voltar','proposta:cancelar']);
  expect(propostaDoCard(f.group,11)).toBe('p1');expect(caption).not.toContain('rejected');
});
it.each(['missing','unsafe','foreign'])('sem foto válida (%s), envia um único card textual completo com botões',async mode=>{
  const f=setup(['a']);if(mode==='missing')delete f.items[0]!.itemImageUrl;if(mode==='unsafe')f.items[0]!.itemImageUrl='https://localhost/a.jpg';if(mode==='foreign')f.items[0]!.storeId='foreign';
  await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendPhoto).not.toHaveBeenCalled();expect(f.fetchImage).not.toHaveBeenCalled();expect(f.delivered).toEqual([{type:'text',id:11}]);
  expect(f.sendMessage.mock.calls[0]![1]).toBe(textoPropostaPreliminar({proposal:f.response.preliminary!,nomes:f.names(),items:f.items,stores:f.stores}));
  expect(f.sendMessage.mock.calls[0]![2]?.reply_markup).toBeDefined();expect(propostaDoCard(f.group,11)).toBe('p1');
});
it.each(['download','telegram','redirect','size','mime'])('falha de %s usa card textual completo sem perder botões',async failure=>{
  const f=setup(['a']);
  if(failure==='download')f.fetchImage.mockRejectedValueOnce(new Error('PRIVATE_URL'));
  if(failure==='telegram')f.sendPhoto.mockRejectedValueOnce(new Error('PRIVATE_TELEGRAM'));
  if(failure==='redirect')f.fetchImage.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}}));
  if(failure==='size')f.fetchImage.mockResolvedValueOnce(new Response(new Uint8Array(5_000_001),{headers:{'content-type':'image/jpeg'}}));
  if(failure==='mime')f.fetchImage.mockResolvedValueOnce(new Response('html',{headers:{'content-type':'text/html'}}));
  const error=vi.spyOn(console,'error');await expect(exibirProposta(f.api,f.iris,f.group,f.response,'bot')).resolves.toBe(true);
  expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(f.sendMessage.mock.calls[0]![1]).toContain('Frete, taxas, descontos, total e orçamento final');expect(f.sendMessage.mock.calls[0]![2]?.reply_markup).toBeDefined();expect(error).not.toHaveBeenCalled();
  expect(f.fetchImage).toHaveBeenCalledWith(image('a'),expect.objectContaining({redirect:'error',signal:expect.any(AbortSignal)}));
});
it('legenda longa faz fallback completo antes de qualquer download, sem truncar produto ou avisos',async()=>{
  const f=setup(['a']);f.items[0]!.name='Produto longo '+ 'Z'.repeat(1100);
  await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.fetchImage).not.toHaveBeenCalled();expect(f.sendPhoto).not.toHaveBeenCalled();
  expect(f.sendMessage.mock.calls[0]![1]).toContain(f.items[0]!.name);expect(f.sendMessage.mock.calls[0]![1]).toContain('Nenhum carrinho, pagamento ou compra foi autorizado.');
});
it.each(['download','telegram'])('timeout em %s entrega texto em prazo finito e mantém identidade correta',async phase=>{
  vi.useFakeTimers();const f=setup(['a']);if(phase==='download')f.fetchImage.mockImplementationOnce(()=>new Promise(()=>{}));else f.sendPhoto.mockImplementationOnce(()=>new Promise(()=>{}));
  const pending=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await vi.advanceTimersByTimeAsync(2500);await pending;
  expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(propostaDoCard(f.group,11)).toBe('p1');
});
it('edita legenda de foto na mesma revisão e não reenvia foto nem texto',async()=>{
  const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.priceCents=3290;
  await atualizarCard(f.api,f.iris,f.group,f.response);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');
  expect(f.sendPhoto).toHaveBeenCalledTimes(1);expect(f.sendMessage).not.toHaveBeenCalled();expect(f.editMessageText).not.toHaveBeenCalled();
  expect(f.editMessageCaption.mock.calls.at(-1)?.[2]).toMatchObject({caption:expect.stringContaining('R$ 32,90'),parse_mode:'HTML',reply_markup:expect.anything()});expect(propostaDoCard(f.group,11)).toBe('p1');
});
it('atualiza texto quando card usou fallback e não tenta promover para foto',async()=>{
  const f=setup(['a']);delete f.items[0]!.itemImageUrl;await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.itemImageUrl=image('a');
  await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.editMessageText).toHaveBeenCalledTimes(1);expect(f.editMessageCaption).not.toHaveBeenCalled();expect(f.sendPhoto).not.toHaveBeenCalled();
});
it('legenda que cresce acima do limite substitui foto por texto completo e invalida mensagem anterior',async()=>{
  const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.items[0]!.name='W'.repeat(1100);
  await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.editMessageCaption).not.toHaveBeenCalled();expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(propostaDoCard(f.group,11)).toBeUndefined();expect(propostaDoCard(f.group,12)).toBe('p1');expect(f.deleteMessage).toHaveBeenCalledWith(f.group,11,expect.any(AbortSignal));
});
it('alternativa envia só o produto da nova revisão e retira card antigo',async()=>{
  const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');
  expect(f.sendPhoto).toHaveBeenCalledTimes(2);expect(f.sendMessage).not.toHaveBeenCalled();expect(f.fetchImage.mock.calls.map(([url])=>String(url))).toEqual([image('a'),image('c')]);expect(propostaDoCard(f.group,11)).toBeUndefined();expect(propostaDoCard(f.group,12)).toBe('p2');
});
it('revisão muda durante download: não envia foto nem fallback da revisão antiga',async()=>{
  const f=setup(['a']);f.fetchImage.mockImplementationOnce(async()=>{f.replace();return new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg'}});});
  await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendPhoto).not.toHaveBeenCalled();expect(f.sendMessage).not.toHaveBeenCalled();expect(propostaDoCard(f.group,11)).toBeUndefined();
});
it('foto tardia após timeout é removida sem substituir identidade do fallback textual',async()=>{
  vi.useFakeTimers();const f=setup(['a']);let resolve!:(v:{message_id:number})=>void;
  f.sendPhoto.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const pending=exibirProposta(f.api,f.iris,f.group,f.response,'bot');
  await vi.advanceTimersByTimeAsync(2500);await pending;expect(propostaDoCard(f.group,11)).toBe('p1');
  resolve({message_id:90});await vi.advanceTimersByTimeAsync(0);
  expect(f.deleteMessage).toHaveBeenCalledWith(f.group,90,expect.any(AbortSignal));expect(f.editMessageReplyMarkup).toHaveBeenCalledWith(f.group,90,expect.anything(),expect.any(AbortSignal));expect(propostaDoCard(f.group,90)).toBeUndefined();expect(propostaDoCard(f.group,11)).toBe('p1');
});
it('foto de apresentação substituída é removida e não aciona fallback nem altera card novo',async()=>{
  const f=setup(['a']);let resolve!:(v:{message_id:number})=>void;let entered!:()=>void;const started=new Promise<void>(done=>{entered=done;});
  f.sendPhoto.mockImplementationOnce(()=>{entered();return new Promise(done=>{resolve=done;});});
  const old=exibirProposta(f.api,f.iris,f.group,f.response,'bot');await started;await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');resolve({message_id:90});await old;
  expect(propostaDoCard(f.group,11)).toBe('p2');expect(propostaDoCard(f.group,90)).toBeUndefined();expect(f.sendMessage).not.toHaveBeenCalled();expect(f.deleteMessage).toHaveBeenCalledWith(f.group,90,expect.any(AbortSignal));
});
it('cancelamento durante envio impede registro e elimina botões da resposta tardia',async()=>{
  const f=setup(['a']);f.sendPhoto.mockImplementationOnce(async()=>{await retirarBotoesDoCard(f.api,f.group);return {message_id:90};});
  await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(propostaDoCard(f.group,90)).toBeUndefined();expect(f.sendMessage).not.toHaveBeenCalled();expect(f.deleteMessage).toHaveBeenCalledWith(f.group,90,expect.any(AbortSignal));
});
it('aceita legenda conservadora de 1024 caracteres e usa texto completo ao acrescentar um caractere',async()=>{
  const f=setup(['a']);const dados={proposal:f.response.preliminary!,nomes:f.names(),items:f.items,stores:f.stores};
  const initial=legendaPropostaPreliminar(dados)!;f.items[0]!.name+='Z'.repeat(1024-initial.length);
  await exibirProposta(f.api,f.iris,f.group,f.response,'bot');expect(f.sendPhoto.mock.calls[0]![2]!.caption!.length).toBe(1024);expect(f.sendMessage).not.toHaveBeenCalled();
  f.items[0]!.name+='Z';await atualizarCard(f.api,f.iris,f.group,f.response);
  expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(f.sendMessage.mock.calls[0]![1]).toContain(f.items[0]!.name.replace('<','&lt;').replace('>','&gt;'));expect(f.editMessageCaption).not.toHaveBeenCalled();
});
it('legenda recusada durante atualização usa novo card textual e invalida callbacks da foto',async()=>{
  const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');f.editMessageCaption.mockRejectedValueOnce(new Error('Controlled rejection'));
  await atualizarCard(f.api,f.iris,f.group,f.response);expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(propostaDoCard(f.group,11)).toBeUndefined();expect(propostaDoCard(f.group,12)).toBe('p1');
});
it('atualização pendente da legenda antiga não edita nem registra a revisão substituta',async()=>{
  const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');
  let release!:()=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});const delay=new Promise<void>(done=>{release=done;});
  f.iris.nomes.mockImplementationOnce(async()=>{entered();await delay;return f.names();});
  const pending=atualizarCard(f.api,f.iris,f.group,f.response);await ready;await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');release();await pending;
  expect(f.editMessageCaption).not.toHaveBeenCalled();expect(propostaDoCard(f.group,11)).toBeUndefined();expect(propostaDoCard(f.group,12)).toBe('p2');
});
it('download que termina depois do timeout não envia foto após o fallback',async()=>{
  vi.useFakeTimers();const f=setup(['a']);let resolve!:(value:Response)=>void;
  f.fetchImage.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const pending=exibirProposta(f.api,f.iris,f.group,f.response,'bot');
  await vi.advanceTimersByTimeAsync(2500);await pending;resolve(new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg'}}));await vi.advanceTimersByTimeAsync(0);
  expect(f.sendMessage).toHaveBeenCalledTimes(1);expect(f.sendPhoto).not.toHaveBeenCalled();expect(propostaDoCard(f.group,11)).toBe('p1');
});
it.each([['photo','cancelar'],['photo','substituir'],['text','cancelar'],['text','substituir']] as const)('edição tardia de %s não restaura botões após %s, mesmo com falha de exclusão',async(kind,action)=>{
  const f=setup(['a']);if(kind==='text')delete f.items[0]!.itemImageUrl;await exibirProposta(f.api,f.iris,f.group,f.response,'bot');
  let oldButtons=true;let release!:()=>void;let entered!:()=>void;
  const started=new Promise<void>(done=>{entered=done;});const pendingEdit=new Promise<void>(done=>{release=done;});
  const edit=async()=>{entered();await pendingEdit;oldButtons=true;return true;};
  if(kind==='photo')f.editMessageCaption.mockImplementationOnce(edit);else f.editMessageText.mockImplementationOnce(edit);
  f.editMessageReplyMarkup.mockImplementation(async(_chat,messageId)=>{if(messageId===11)oldButtons=false;return true;});
  f.deleteMessage.mockRejectedValue(new Error('Controlled delete failure'));
  const updating=atualizarCard(f.api,f.iris,f.group,f.response);await started;
  if(action==='cancelar')await retirarBotoesDoCard(f.api,f.group);else await exibirProposta(f.api,f.iris,f.group,f.replace(),'bot');
  expect(oldButtons).toBe(false);release();await updating;
  expect(oldButtons).toBe(false);expect(propostaDoCard(f.group,11)).toBeUndefined();
  if(action==='substituir')expect(propostaDoCard(f.group,12)).toBe('p2');
});
it('duas edições na mesma revisão não removem a mensagem ainda vigente',async()=>{
  const f=setup(['a']);await exibirProposta(f.api,f.iris,f.group,f.response,'bot');
  let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(done=>{entered=done;});const delay=new Promise<void>(done=>{release=done;});
  f.editMessageCaption.mockImplementationOnce(async()=>{entered();await delay;return true;});
  const older=atualizarCard(f.api,f.iris,f.group,f.response);await started;await atualizarCard(f.api,f.iris,f.group,f.response);release();await older;
  expect(propostaDoCard(f.group,11)).toBe('p1');expect(f.deleteMessage).not.toHaveBeenCalled();expect(f.sendPhoto).toHaveBeenCalledTimes(1);
});
