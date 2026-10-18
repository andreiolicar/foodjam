import { expect, it } from 'vitest';
import { preliminaryFixture } from './preliminary-fixture.js';
async function prepared() {
  const f = preliminaryFixture();
  await f.iris.iniciar('g', { id: 'a', displayName: 'A' }); await f.iris.confirmarEndereco('g', 'a', f.address);
  await f.iris.mensagens('g', [{ participantId: 'a', text: 'Hambúrguer' }]);
  const first = (await f.iris.propor('g', 'a')).preliminary!;
  return { ...f, first };
}

it('identidade ausente não contorna o guard da ação preliminar', async () => {
  const f = await prepared();
  const result = await f.iris.agirNaPropostaPreliminar('g', 'a', undefined as unknown as string, 'cancelar');
  expect(result.outcome).toBe('proposal_stale');
  expect((await f.iris.obter('g'))?.preliminary).toEqual(f.first);
});

it('a identidade não reaparece depois de alternar duas vezes', async () => {
  const f = await prepared();
  await f.iris.outraOpcao('g', 'a'); await f.iris.outraOpcao('g', 'a');
  const current = (await f.iris.obter('g'))?.preliminary;
  expect(current?.items).toEqual(f.first.items); expect(current?.id).not.toBe(f.first.id);
  expect((await f.iris.agirNaPropostaPreliminar('g', 'a', f.first.id, 'cancelar')).outcome).toBe('proposal_stale');
  expect((await f.iris.obter('g'))?.preliminary).toEqual(current);
});

it('nova sessão não reutiliza a identidade de proposta cancelada', async () => {
  const f = await prepared(); await f.iris.cancelar('g', 'a');
  await f.iris.iniciar('g', { id: 'a', displayName: 'A' }); await f.iris.confirmarEndereco('g', 'a', f.address);
  await f.iris.mensagens('g', [{ participantId: 'a', text: 'Hambúrguer' }]);
  const next = (await f.iris.propor('g', 'a')).preliminary;
  expect(next?.id).not.toBe(f.first.id);
  expect((await f.iris.agirNaPropostaPreliminar('g', 'a', f.first.id, 'cancelar')).outcome).toBe('proposal_stale');
  expect((await f.iris.obter('g'))?.preliminary).toEqual(next);
});
