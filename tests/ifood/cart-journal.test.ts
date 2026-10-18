import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as api from '../../src/ifood/index.js';
it('reserva é exclusiva e persistente entre instâncias, inclusive antes de receber cartId', async () => {
  const path = await mkdtemp(join(tmpdir(), 'foodjam-journal-'));
  try {
    const key = 'a'.repeat(64);
    const one = await api.createPrivateCartJournal(path);
    const two = await api.createPrivateCartJournal(path);
    expect(await one.reserve(key)).toBe(true);
    expect(await two.reserve(key)).toBe(false);
    expect(await two.get(key)).toEqual({});
    await one.saveCart(key, 'fixture-cart');
    expect(await two.get(key)).toEqual({ cartId: 'fixture-cart' });
    await expect(one.get('../escape')).rejects.toThrow();
  } finally { await rm(path, { recursive: true, force: true }); }
});
it('reserva pendente de qualquer loja bloqueia o mesmo escopo após reinício e mantém vínculo após salvar ID',async()=>{
 const path=await mkdtemp(join(tmpdir(),'foodjam-journal-'));try{
 const first=await api.createPrivateCartJournal(path);const key='b'.repeat(64);const scope='c'.repeat(64);
 await first.reserve(key,scope);const restarted=await api.createPrivateCartJournal(path);
 expect(await restarted.hasUnresolved!(scope)).toBe(true);expect(await restarted.hasUnresolved!('d'.repeat(64))).toBe(false);
 await first.saveCart(key,'real-returned-cart-id');expect(await restarted.hasUnresolved!(scope)).toBe(false);
 }finally{await rm(path,{recursive:true,force:true});}
});
