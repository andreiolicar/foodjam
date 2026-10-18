import { expect, it } from 'vitest';
import { preliminaryFixture } from './preliminary-fixture.js';

async function collecting() {
  const f = preliminaryFixture();
  await f.iris.iniciar('g', { id: 'a', displayName: 'A' });
  await f.iris.confirmarEndereco('g', 'a', f.address);
  return f;
}
const pair = [{ participantId: 'a', text: 'Hambúrguer' }, { participantId: 'b', text: 'Açaí' }];

it.each(['irrelevant', 'question'] as const)('mantém desejos persistidos depois de mensagens %s', async kind => {
  const f = await collecting();
  f.collection('preference', { a: ['hambúrguer'], b: ['açaí'] });
  await f.iris.mensagens('g', pair);
  f.collection(kind, { a: [], b: [] });
  await f.iris.mensagens('g', pair.map(p => ({ ...p, text: kind === 'question' ? 'Vai demorar?' : 'Obrigado' })));
  const result = await f.iris.propor('g', 'a');
  expect(result.outcome).toBe('preliminary_ready');
  expect(result.preliminary?.items.map(i => [i.participantId, i.menuItemId])).toEqual([['a', 'burger-a'], ['b', 'acai-a']]);
  expect(result.session?.participants.map(p => p.preferences.wishes)).toEqual([['hambúrguer'], ['açaí']]);
});

it.each(['sem mensagens', 'irrelevant', 'question'] as const)('recusa sessão realmente sem preferências: %s', async kind => {
  const f = await collecting();
  if (kind !== 'sem mensagens') { f.collection(kind, { a: [], b: [] }); await f.iris.mensagens('g', pair); }
  const result = await f.iris.propor('g', 'a');
  expect(result.outcome).toBe('preferences_required');
  expect(result.preliminary).toBeUndefined();
});

it('não classifica organizador sem perfil quando apenas outra pessoa informou preferências', async () => {
  const f = await collecting();
  f.collection('preference', { b: ['açaí'] });
  await f.iris.mensagens('g', [{ participantId: 'b', text: 'Açaí' }]);
  const result = await f.iris.propor('g', 'a');
  expect(result.preliminary?.items.map(i => i.participantId)).toEqual(['b']);
  expect(result.preliminary?.participants.map(p => p.id)).toEqual(['a', 'b']);
});

it('atualização explícita substitui desejos anteriores e invalida sua proposta', async () => {
  const f = await collecting();
  f.collection('preference', { a: ['hambúrguer'], b: ['açaí'] });
  await f.iris.mensagens('g', pair);
  const first = await f.iris.propor('g', 'a');
  f.collection('preference', { a: ['açaí'] });
  const updated = await f.iris.mensagens('g', [{ participantId: 'a', text: 'Agora açaí' }]);
  expect(updated.preliminary?.id).not.toBe(first.preliminary?.id);
  expect(updated.preliminary?.items.map(i => i.menuItemId)).toEqual(['acai-a', 'acai-a']);
  expect(updated.session?.participants[0]?.preferences.wishes).toEqual(['açaí']);
});

it('aceita indiferença alimentar explicitamente reconhecida pela coleta', async () => {
  const f = await collecting();
  f.collection('preference', { a: [] });
  await f.iris.mensagens('g', [{ participantId: 'a', text: 'Qualquer comida serve' }]);
  expect((await f.iris.propor('g', 'a')).outcome).toBe('preliminary_ready');
});
