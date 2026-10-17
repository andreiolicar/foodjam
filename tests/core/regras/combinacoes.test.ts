import { describe, expect, it } from 'vitest';
import type { Metricas, PessoaClassificada } from '../../../src/core/regras/combinacoes.js';
import { compararMetricas, enumerarCombinacoes, escolherNaCombinacao, medir } from '../../../src/core/regras/combinacoes.js';

const lojaDoItem = new Map([
  ['a1', 'A'],
  ['a2', 'A'],
  ['b1', 'B'],
  ['c1', 'C'],
]);

describe('enumerarCombinacoes', () => {
  it('todas as de 1 loja e depois todas as de 2, sem repetir', () => {
    expect(enumerarCombinacoes(['A', 'B', 'C', 'A'])).toEqual([['A'], ['B'], ['C'], ['A', 'B'], ['A', 'C'], ['B', 'C']]);
    expect(enumerarCombinacoes(['A', 'B', 'C', 'D'])).toHaveLength(10);
    expect(enumerarCombinacoes([])).toEqual([]);
  });
});

describe('escolherNaCombinacao', () => {
  const pessoas: PessoaClassificada[] = [
    { participantId: 'p', desejos: [{ atende: ['b1', 'a1'], substitutos: ['c1'] }] },
    { participantId: 'q', desejos: [{ atende: ['a1'], substitutos: [] }, { atende: ['a1', 'a2'], substitutos: [] }] },
  ];

  it('pega o primeiro "atende" dentro das lojas; senão o primeiro substituto', () => {
    expect(escolherNaCombinacao(['A'], pessoas, lojaDoItem)).toEqual([
      { participantId: 'p', menuItemId: 'a1', storeId: 'A', isSubstitute: false, desejo: 0 },
      { participantId: 'q', menuItemId: 'a1', storeId: 'A', isSubstitute: false, desejo: 0 },
      { participantId: 'q', menuItemId: 'a2', storeId: 'A', isSubstitute: false, desejo: 1 },
    ]);
    expect(escolherNaCombinacao(['C'], pessoas, lojaDoItem)).toEqual([
      { participantId: 'p', menuItemId: 'c1', storeId: 'C', isSubstitute: true, desejo: 0 },
    ]);
  });

  it('a mesma pessoa não recebe o mesmo item duas vezes; desejo sem opção fica sem item', () => {
    const escolhas = escolherNaCombinacao(['A'], [{ participantId: 'q', desejos: [{ atende: ['a1'], substitutos: [] }, { atende: ['a1'], substitutos: [] }] }], lojaDoItem);
    expect(escolhas.map((e) => e.menuItemId)).toEqual(['a1']);
  });
});

describe('medir e compararMetricas', () => {
  const pessoas: PessoaClassificada[] = [
    { participantId: 'p', desejos: [{ atende: [], substitutos: [] }] },
    { participantId: 'q', desejos: [{ atende: [], substitutos: [] }, { atende: [], substitutos: [] }] },
  ];

  it('atendido só com todos os desejos sem substituto; conta faltando e substitutos', () => {
    const m = medir(
      [
        { participantId: 'p', menuItemId: 'a1', storeId: 'A', isSubstitute: false, desejo: 0 },
        { participantId: 'q', menuItemId: 'a2', storeId: 'A', isSubstitute: true, desejo: 0 },
      ],
      pessoas,
      1,
      2000,
    );
    expect(m).toEqual({ atendidos: 1, faltando: 1, substitutos: 1, lojas: 1, totalCents: 2000 });
  });

  const m = (atendidos: number, faltando: number, substitutos: number, lojas: number, totalCents: number): Metricas => ({
    atendidos,
    faltando,
    substitutos,
    lojas,
    totalCents,
  });

  it.each([
    ['mais atendidos', m(2, 1, 1, 2, 9000), m(1, 0, 0, 1, 1000)],
    ['menos desejos sem item (substituto vence ficar sem nada)', m(1, 0, 1, 2, 9000), m(1, 1, 0, 1, 1000)],
    ['menos substitutos', m(1, 0, 0, 2, 9000), m(1, 0, 1, 1, 1000)],
    ['menos lojas', m(1, 0, 0, 1, 9000), m(1, 0, 0, 2, 1000)],
    ['menor total', m(1, 0, 0, 1, 1000), m(1, 0, 0, 1, 1001)],
  ])('%s vence', (_nome, melhor, pior) => {
    expect(compararMetricas(melhor, pior)).toBeLessThan(0);
    expect(compararMetricas(pior, melhor)).toBeGreaterThan(0);
  });
});
