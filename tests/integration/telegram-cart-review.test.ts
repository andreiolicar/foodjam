import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Update, UserFromGetMe } from 'grammy/types';
import { GrammyError } from 'grammy';
import type * as Ifood from '../../src/ifood/index.js';
import { validateToolSchema } from '../../src/ifood/tool-validation.js';
const transport=vi.hoisted(()=>({factory:vi.fn(),connect:vi.fn(),list:vi.fn(),read:vi.fn(),cart:vi.fn(),close:vi.fn(),payment:vi.fn()}));
vi.mock('../../src/ifood/index.js',async original=>({...await original<typeof Ifood>(),createIfoodMcpClient:transport.factory.mockImplementation(()=>({connect:transport.connect,listTools:transport.list,callReadTool:transport.read,callCartTool:transport.cart,callPaymentOrderTool:transport.payment,close:transport.close}))}));
import { criarAplicacaoReal } from '../../src/app.js';
const env={TELEGRAM_BOT_TOKEN:'123:fixture',AI_PROVIDER:'openai-compat',AI_BASE_URL:'https://api.groq.com/openai/v1',AI_API_KEY:'fixture',AI_MODEL_FAST:'openai/gpt-oss-20b',AI_MODEL_CAPABLE:'openai/gpt-oss-120b',AI_2_BASE_URL:'https://generativelanguage.googleapis.com/v1beta/openai',AI_2_API_KEY:'fixture',AI_2_MODEL_FAST:'fixture',AI_2_MODEL_CAPABLE:'fixture',AI_3_BASE_URL:'https://openrouter.ai/api/v1',AI_3_API_KEY:'fixture',AI_3_MODEL_FAST:'fixture',AI_3_MODEL_CAPABLE:'fixture',IFOOD_MCP_CLIENT_ID:'fixture',IFOOD_MCP_CLIENT_SECRET:'fixture',IFOOD_MCP_CALLBACK_URL:'http://localhost:3333/callback'};
const envelope=(data:unknown)=>({content:[{type:'text',text:JSON.stringify(data)}]});
let address:string;let stores:string[];let products:string[];let directory:string;let twoStores=false;let price=8;let quantityOffset=0;let missingSummary=false;
const remote=new Map<string,{store:string;items:{itemId:string;quantity:number}[]}>();
const uuid={type:'string',format:'uuid'};
const tools=[{name:'createCart',inputSchema:{type:'object',properties:{merchantId:uuid,addressId:uuid,items:{type:'array',items:{type:'object',properties:{itemId:uuid,quantity:{type:'integer',minimum:1}},required:['itemId','quantity'],additionalProperties:false}}},required:['merchantId','addressId','items'],additionalProperties:false}},{name:'getCart',inputSchema:{type:'object',properties:{cartId:uuid},required:['cartId'],additionalProperties:false}}];
beforeEach(async()=>{
 address=randomUUID();stores=[randomUUID(),randomUUID()];products=[randomUUID(),randomUUID()];directory=await mkdtemp(join(tmpdir(),'foodjam-cart-'));remote.clear();twoStores=false;price=8;quantityOffset=0;missingSummary=false;
 transport.connect.mockResolvedValue(undefined);transport.list.mockResolvedValue(tools);transport.close.mockResolvedValue(undefined);transport.payment.mockRejectedValue(new Error('Payment forbidden'));
 transport.read.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='getUser')return envelope({success:true,data:{email:'fixture@example.invalid'}});
  if(name==='listAddresses')return envelope({results:[{addressId:address,formattedAddress:'Destino de teste',coordinates:{latitude:0,longitude:0}}]});
  if(name==='getMerchant')return envelope({merchantId:args.merchantId,merchantName:'Padaria de teste',isOpen:true});
  if(name==='getItem')return envelope({merchantId:args.merchantId,itemId:args.itemId,optionGroups:[]});
  const rows=products.map((itemId,i)=>({itemId,itemName:i?'Pão de queijo':'Coxinha',unitPrice:7,merchant:{merchantId:stores[twoStores&&i?1:0],merchantName:i?'Padaria B':'Padaria A',isOpen:true}}));
  if(name==='searchOffers'&&args.resultKind==='MERCHANT')return envelope({results:(twoStores?stores:stores.slice(0,1)).map(merchantId=>({merchantId,merchantName:'Padaria',isOpen:true})),hasMore:false});
  const filter=(args.refinements as {merchantId?:string}|undefined)?.merchantId;
  return envelope({results:filter?rows.filter(i=>i.merchant.merchantId===filter):rows,hasMore:false});
 });
 transport.cart.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const schema=tools.find(t=>t.name===name);if(!schema)throw new Error('Forbidden tool');validateToolSchema(schema.inputSchema,args,'input','cart');
  if(name==='createCart'){const cartId=randomUUID();remote.set(cartId,{store:String(args.merchantId),items:structuredClone(args.items as {itemId:string;quantity:number}[])});return envelope({cartId});}
  const entry=remote.get(String(args.cartId))!;const items=entry.items.map(i=>({...i,cartItemId:randomUUID(),quantity:i.quantity+quantityOffset,unitPrice:price}));const subtotal=items.reduce((sum,i)=>sum+i.quantity*price,0);
  return envelope({cartId:args.cartId,merchant:{merchantId:entry.store},items,deliveryAddress:{addressId:address},...(missingSummary?{}:{deliveryMethod:{fee:2},fees:[{amount:1}],summary:{subtotalAmount:subtotal,deliveryFeeAmount:2,feeTotalAmount:1,benefitsTotalAmount:0,voucherTotalAmount:0,totalAmount:subtotal+3}})});
 });
 vi.spyOn(console,'info').mockImplementation(()=>undefined);
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(new URL(String(url)).hostname!=='api.groq.com')throw new Error('Unexpected network');const body=JSON.parse(String(init?.body));let output;
  if(body.response_format?.json_schema?.name==='coleta_lote'){const ids=body.response_format.json_schema.schema.properties.resultados.items.properties.participantId.enum as string[];output={resultados:ids.map(participantId=>({participantId,kind:'preference',wishes:[participantId==='71'?'coxinha':'pão de queijo'],foodPreferences:[],dietaryRestrictions:[],avoids:[],budgetText:null,clarification:null}))};}
  else {const people=JSON.parse(/<pessoas>(.*?)<\/pessoas>/s.exec(body.messages[1].content)![1]!);output={pessoas:people.map((p:{participantId:string})=>({participantId:p.participantId,desejos:[{atende:[products[p.participantId==='71'?0:1]],substitutos:[]}]}))};}
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
 }));
});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks();await rm(directory,{recursive:true,force:true});});
async function setup(enabled=true){
 const runtime=await criarAplicacaoReal({...env,...enabled?{FOODJAM_CART_PREPARATION_ENABLED:'true',FOODJAM_CART_JOURNAL_DIR:directory,FOODJAM_CART_MONEY_UNIT:'BRL'}:{}});
 runtime.bot.botInfo={id:999,is_bot:true,first_name:'Bot',username:'fixture_bot'} as UserFromGetMe;
 const sent:{id:number;chatId:string;text:string;buttons:{text:string;callback_data?:string}[]}[]=[];const removed:number[]=[];const alerts:string[]=[];let sequence=100;let rejectReview=false;
 runtime.bot.api.config.use(async(_prev,method,payload)=>{
  const p=payload as Record<string,unknown>;
  if(method==='answerCallbackQuery'){alerts.push(String(p.text??''));return {ok:true,result:true} as never;}
  if(method==='deleteMessage')removed.push(Number(p.message_id));
  if(method==='editMessageText'){const m=sent.find(m=>m.id===p.message_id);if(m)m.text=String(p.text);return {ok:true,result:true} as never;}
  if(method==='sendMessage'){if(rejectReview&&String(p.text).includes('Revisão do carrinho')){rejectReview=false;throw new GrammyError('Controlled rejection',{ok:false,error_code:400,description:'Controlled rejection'},'sendMessage',{});}const id=++sequence;sent.push({id,chatId:String(p.chat_id),text:String(p.text),buttons:(p.reply_markup as {inline_keyboard?:{text:string;callback_data?:string}[][]})?.inline_keyboard?.flat()??[]});return {ok:true,result:{message_id:id,date:0,chat:{id:Number(p.chat_id)},text:p.text}} as never;}
  return {ok:true,result:true} as never;
 });
 const from=(id:number)=>({id,is_bot:false,first_name:{71:'Andrei',72:'Ana Paula',73:'Allan'}[id]??'Pessoa'});
 const text=(id:number,value:string)=>runtime.bot.handleUpdate({update_id:++sequence,message:{message_id:sequence,date:0,from:from(id),chat:{id:-501,type:'supergroup',title:'Teste'},text:value,...value.startsWith('/')?{entities:[{type:'bot_command',offset:0,length:value.length}]}:{}}} as Update);
 const click=(id:number,data:string,messageId:number)=>runtime.bot.handleUpdate({update_id:++sequence,callback_query:{id:String(sequence),from:from(id),chat_instance:'fixture',data,message:{message_id:messageId,date:0,chat:{id:-501,type:'supergroup'},text:''}}} as Update);
 const button=(name:string)=>{const m=sent.findLast(m=>m.buttons.some(b=>b.text.includes(name)));expect(m,`button ${name}`).toBeDefined();return {id:m!.id,data:m!.buttons.find(b=>b.text.includes(name))!.callback_data!};};
 await text(71,'/iniciar');const b=button('Confirmar endereço');await click(71,b.data,b.id);await text(71,'coxinha');await text(72,'pão de queijo');await text(73,'pão de queijo');await text(71,'/montar');
 const privateText=(id:number,value:string)=>runtime.bot.handleUpdate({update_id:++sequence,message:{message_id:sequence,date:0,from:from(id),chat:{id,type:'private',first_name:'Pessoa'},text:value,entities:[{type:'bot_command',offset:0,length:value.length}]}} as Update);
 return {runtime,sent,removed,alerts,text,privateText,click,button,rejectReview:()=>{rejectReview=true;},prepare:()=>{const b=button('Preparar carrinho');return click(71,b.data,b.id);}};
}
it('checkout privado na composição real relê carrinho e Pix, sem configurar pagamento ou submeter',async()=>{
 transport.list.mockResolvedValue([...tools,{name:'listPaymentMethods',inputSchema:{type:'object',properties:{merchantId:uuid},required:['merchantId']}}]);
 const method=randomUUID();transport.payment.mockResolvedValue(envelope({paymentMethods:[{paymentMethodId:method,kind:'PIX',displayName:'Pix',cardTokenId:'private-card-token'}]}));
 const h=await setup();try{
  await h.privateText(71,'/checkout');expect(transport.payment).not.toHaveBeenCalled();
  await h.prepare();expect(transport.payment).not.toHaveBeenCalled();
  await h.privateText(72,'/checkout');expect(transport.payment).not.toHaveBeenCalled();
  price=9;
  await h.privateText(71,'/checkout');expect(transport.payment).toHaveBeenCalledExactlyOnceWith('listPaymentMethods',{merchantId:stores[0]});
  const message=h.sent.findLast(m=>m.text.includes('Conferência do checkout'))!;expect(message).toBeDefined();expect(message.chatId).toBe('71');expect(message.text).toContain('Pix disponível');expect(message.text).toContain('bloqueado');expect(message.text).not.toMatch(/private-card-token|[a-f0-9]{8}-[a-f0-9]{4}/);
  expect(message.text).toContain('R$ 30,00');expect(message.text).toContain('não confirmado para compra');
  expect(transport.cart.mock.calls.map(c=>c[0])).toEqual(['createCart','getCart','getCart']);
 }finally{await h.runtime.close();}
});
it('composição real controlada: três pessoas, duas linhas consolidadas, preço do carrinho e revisão sem compra',async()=>{
 const h=await setup();try{
 expect(transport.cart).not.toHaveBeenCalled();const b=h.button('Preparar carrinho');await h.click(72,b.data,b.id);expect(transport.cart).not.toHaveBeenCalled();
 await h.prepare();expect(transport.cart.mock.calls.map(c=>c[0])).toEqual(['createCart','getCart']);
 expect(transport.cart.mock.calls[0]![1]).toEqual({merchantId:stores[0],addressId:address,items:[{itemId:products[0],quantity:1},{itemId:products[1],quantity:2}]});
 const card=h.sent.findLast(m=>m.text.includes('Revisão do carrinho'))!.text;expect(card).toContain('Andrei: 1×');expect(card).toContain('Ana Paula: 1×');expect(card).toContain('Allan: 1×');expect(card).toContain('R$ 8,00 por unidade');expect(card).toContain('R$ 27,00');expect(card).toContain('Nenhuma compra');expect(card).not.toMatch(/Pedido confirmado|fixture@example|[a-f0-9]{8}-[a-f0-9]{4}/);
 await h.prepare();expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1);
 const r=h.button('Atualizar revisão');await h.click(71,r.data,r.id);expect(transport.cart.mock.calls.map(c=>c[0])).toEqual(['createCart','getCart','getCart']);
 expect(h.sent.filter(m=>m.text.includes('Revisão do carrinho'))).toHaveLength(1);expect(transport.payment).not.toHaveBeenCalled();expect(h.runtime.diagnostico().providers).toEqual(['groq','gemini','openrouter']);
 }finally{await h.runtime.close();}
});
it('duas lojas usam carrinhos separados; falha parcial nunca é sucesso completo',async()=>{
 twoStores=true;const original=transport.cart.getMockImplementation()!;transport.cart.mockImplementation(async(name,args)=>name==='createCart'&&args.merchantId===stores[1]?{...envelope({}),isError:true}:original(name,args));
 const h=await setup();try{await h.prepare();expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(2);const text=h.sent.findLast(m=>m.text.includes('Revisão do carrinho'))!.text;expect(text).toContain('Preparação incompleta');expect(text).toContain('pendente');expect(text).not.toContain('Total consolidado');expect(remote.size).toBe(1);}finally{await h.runtime.close();}
});
it.each(['quantidade','resumo'])('reconciliação bloqueia %s divergente ou ausente sem inventar valor',async(kind)=>{
 const h=await setup();try{if(kind==='quantidade')quantityOffset=1;else missingSummary=true;await h.prepare();const text=h.sent.findLast(m=>m.text.includes('Revisão do carrinho'))!.text;expect(text).toContain('pendente');expect(text).not.toContain('Total consolidado');}finally{await h.runtime.close();}
});
it('callback obsoleto não cria; voltar limpa revisão comercial; flag ausente mantém mutações desligadas',async()=>{
 const h=await setup();try{const old=h.button('Preparar carrinho');await h.prepare();const review=h.sent.findLast(m=>m.text.includes('Revisão do carrinho'))!;const back=h.button('Voltar para a coleta');await h.click(71,back.data,back.id);await h.click(71,old.data,old.id);expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1);expect(h.removed).toContain(review.id);}finally{await h.runtime.close();}
 const disabled=await setup(false);try{expect(disabled.sent.flatMap(m=>m.buttons).some(b=>b.text.includes('Preparar carrinho'))).toBe(false);expect(transport.factory).toHaveBeenLastCalledWith(expect.anything(),{allowCartMutations:false,allowPaymentConfiguration:false});}finally{await disabled.runtime.close();}
});
it('sem createCart homologado não envia escrita',async()=>{
 transport.list.mockResolvedValue(tools.filter(t=>t.name!=='createCart'));const h=await setup();try{await h.prepare();expect(transport.cart).not.toHaveBeenCalled();expect(h.sent.at(-1)?.text).toMatch(/pendente|incert/);}finally{await h.runtime.close();}
});
it('rejeição explícita da revisão permite reapresentação pelo usuário sem repetir criação',async()=>{
 const h=await setup();try{h.rejectReview();await h.prepare();expect(h.sent.some(m=>m.text.includes('Revisão do carrinho'))).toBe(false);await h.prepare();expect(h.sent.some(m=>m.text.includes('Revisão do carrinho'))).toBe(true);expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1);}finally{await h.runtime.close();}
});
it('escrita incerta bloqueia outra loja mesmo com nova composição e nova instância',async()=>{
 const original=transport.cart.getMockImplementation()!;transport.cart.mockImplementationOnce(async()=>{throw new Error('Unknown transport outcome');});
 const first=await setup();try{await first.prepare();expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1);}finally{await first.runtime.close();}
 stores=[randomUUID(),randomUUID()];transport.cart.mockImplementation(original);
 const second=await setup();try{await second.prepare();expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1);expect(second.sent.at(-1)?.text).toContain('pendente');}finally{await second.runtime.close();}
});
it('timeout de criação e resposta tardia nunca repetem escrita; revisão reconcilia ID salvo posteriormente',async()=>{
 const h=await setup();const original=transport.cart.getMockImplementation()!;let release!:()=>void;const wait=new Promise<void>(done=>{release=done;});
 transport.cart.mockImplementationOnce(async(name,args)=>{await wait;return original(name,args);});
 try{vi.useFakeTimers();const pending=h.prepare();await vi.waitFor(()=>expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1));await vi.advanceTimersByTimeAsync(30_001);await pending;
 expect(h.sent.at(-1)?.text).toContain('incerta');await h.prepare();expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1);
 release();vi.useRealTimers();await vi.waitFor(()=>expect(remote.size).toBe(1));await vi.waitFor(()=>expect(transport.cart.mock.calls.some(c=>c[0]==='getCart')).toBe(true));
 const r=h.button('Atualizar revisão');await h.click(71,r.data,r.id);expect(h.sent.at(-1)?.text).toContain('Andrei: 1×');expect(transport.cart.mock.calls.filter(c=>c[0]==='createCart')).toHaveLength(1);
 }finally{release?.();vi.useRealTimers();await h.runtime.close();}
});
it('schema comercial com exigência não atendida não reserva nem envia criação',async()=>{
 transport.list.mockResolvedValue(tools.map(t=>t.name==='createCart'?{...t,inputSchema:{...t.inputSchema,required:['merchantId','addressId','items','deliveryMethod']}}:t));
 const h=await setup();try{await h.prepare();expect(transport.cart).not.toHaveBeenCalled();expect(h.sent.at(-1)?.text).toContain('pendente');}finally{await h.runtime.close();}
});
it('criação com inclusão parcial é recusada na leitura, sem adicionar itens cegamente',async()=>{
 const original=transport.cart.getMockImplementation()!;transport.cart.mockImplementation(async(name,args)=>{const result=await original(name,args);if(name==='getCart'){const data=JSON.parse(result.content[0]!.text);data.items.pop();return envelope(data);}return result;});
 const h=await setup();try{await h.prepare();expect(h.sent.at(-1)?.text).toContain('Inclusão/quantidade pendente');await h.prepare();expect(transport.cart.mock.calls.map(c=>c[0])).toEqual(['createCart','getCart']);}finally{await h.runtime.close();}
});
it('proposta cancelada durante preflight não executa escrita nem apresenta revisão antiga',async()=>{
 const h=await setup();const read=transport.read.getMockImplementation()!;let release!:()=>void;let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});const wait=new Promise<void>(done=>{release=done;});
 transport.read.mockImplementation(async(name,args)=>{if(name==='getItem'){entered();await wait;}return read(name,args);});
 try{const preparing=h.prepare();await ready;const back=h.button('Voltar para a coleta');await h.click(71,back.data,back.id);release();await preparing;
 expect(transport.cart).not.toHaveBeenCalled();expect(h.sent.some(m=>m.text.includes('Revisão do carrinho'))).toBe(false);
 }finally{release?.();await h.runtime.close();}
});
it('duas lojas reconciliadas preservam produtos e quantidades próprios sem inventar total consolidado',async()=>{
 twoStores=true;const h=await setup();try{await h.prepare();const creates=transport.cart.mock.calls.filter(c=>c[0]==='createCart');
 expect(creates.map(c=>c[1])).toEqual([{merchantId:stores[0],addressId:address,items:[{itemId:products[0],quantity:1}]},{merchantId:stores[1],addressId:address,items:[{itemId:products[1],quantity:2}]}]);
 expect(transport.cart.mock.calls.filter(c=>c[0]==='getCart')).toHaveLength(2);const text=h.sent.at(-1)!.text;expect(text).toContain('Composição e valores reconciliados');expect(text).toContain('R$ 11,00');expect(text).toContain('R$ 19,00');expect(text).toContain('Preço alterado');expect(text).not.toContain('Total consolidado');expect(transport.payment).not.toHaveBeenCalled();
 }finally{await h.runtime.close();}
});
