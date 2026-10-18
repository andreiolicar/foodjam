import { describe, expect, it } from 'vitest';
import { MAX_CANDIDATE_STORES, atualizarCatalogo, buscarCandidatas, termosDeBusca } from '../../src/core/catalogo.js';
import type { Participant } from '../../src/core/contracts.js';
import { CatalogoFake, LOJAS } from '../../src/core/fakes/catalogo-fake.js';
import { AGORA, ENDERECO } from './fixtures.js';

const pessoa = (foodPreferences: string[]): Participant => ({ id: foodPreferences.join(), displayName: 'P', preferences: { foodPreferences } });

describe('termosDeBusca', () => {
  it('tira palavras genéricas e duplicados', () => {
    expect(termosDeBusca([pessoa(['algo leve', 'barato', 'qualquer coisa']), pessoa(['hambúrguer', 'algo leve'])])).toEqual([
      'leve',
      'hambúrguer',
    ]);
  });
});

describe('buscarCandidatas', () => {
  it('ordena lojas por quantos termos atendem e baixa os cardápios', async () => {
    const port = new CatalogoFake();
    const snapshot = await buscarCandidatas(port, [pessoa(['bolo de cenoura']), pessoa(['lanche'])], AGORA, ENDERECO);

    expect(snapshot.stores.map((s) => s.id)).toEqual([LOJAS.padaria, LOJAS.doceria]);
    expect(snapshot.menuItems.every((i) => [LOJAS.padaria, LOJAS.doceria].includes(i.storeId as never))).toBe(true);
    expect(snapshot.fetchedAt).toBe(AGORA);
  });

  it('ignora lojas fechadas', async () => {
    const snapshot = await buscarCandidatas(new CatalogoFake(), [pessoa(['sushi'])], AGORA, ENDERECO);
    expect(snapshot.stores.some((s) => s.id === LOJAS.japones)).toBe(false);
  });

  it('sem termo útil, usa a busca vazia e limita a quantidade de lojas', async () => {
    const port = new CatalogoFake();
    const snapshot = await buscarCandidatas(port, [pessoa(['qualquer coisa'])], AGORA, ENDERECO);
    expect(port.calls[0]).toEqual({ operation: 'searchStores', input: '', address: ENDERECO.formatted });
    expect(snapshot.stores.length).toBeLessThanOrEqual(MAX_CANDIDATE_STORES);
    expect(snapshot.stores.length).toBeGreaterThan(0);
  });

  it('só usa operações de leitura da porta', async () => {
    const port = new CatalogoFake();
    await buscarCandidatas(port, [pessoa(['hambúrguer', 'pizza'])], AGORA, ENDERECO);
    expect(new Set(port.calls.map((c) => c.operation))).toEqual(new Set(['searchStores', 'getMenu']));
  });
});

describe('atualizarCatalogo', () => {
  it('reconsulta as lojas pelo nome, confere o id e marca o horário novo', async () => {
    const port = new CatalogoFake();
    const antigo = await buscarCandidatas(port, [pessoa(['bolo de cenoura'])], '2026-10-18T11:00:00.000Z', ENDERECO);
    const novo = await atualizarCatalogo(port, antigo, [LOJAS.padaria], AGORA, ENDERECO);

    expect(novo.stores.map((s) => s.id)).toEqual([LOJAS.padaria]);
    expect(novo.menuItems.every((i) => i.storeId === LOJAS.padaria)).toBe(true);
    expect(novo.fetchedAt).toBe(AGORA);
  });

  it('loja que não volta na busca fica de fora', async () => {
    const vazio = new CatalogoFake({ stores: [], menuItems: [] });
    const antigo = { stores: [{ id: 'x', name: 'X', isOpen: true, deliveryFeeCents: 0 }], menuItems: [] };
    expect((await atualizarCatalogo(vazio, antigo, ['x'], AGORA, ENDERECO)).stores).toEqual([]);
  });
});
