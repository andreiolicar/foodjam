import { describe, expect, it } from 'vitest';
import { assertMoneyCents, somarCents } from '../../../src/core/regras/dinheiro.js';

describe('assertMoneyCents', () => {
  it.each([0, 1, 2590, Number.MAX_SAFE_INTEGER])('aceita %s', (valor) => {
    expect(() => assertMoneyCents(valor)).not.toThrow();
  });

  it.each([-1, 25.9, 0.1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2590', null, undefined])(
    'rejeita %s',
    (valor) => {
      expect(() => assertMoneyCents(valor)).toThrow(RangeError);
    },
  );

  it('inclui o nome do campo na mensagem', () => {
    expect(() => assertMoneyCents(-5, 'entregaCents')).toThrow(/entregaCents/);
  });
});

describe('somarCents', () => {
  it('soma centavos', () => {
    expect(somarCents([2590, 1000, 10])).toBe(3600);
    expect(somarCents([])).toBe(0);
  });

  it('rejeita parcela inválida', () => {
    expect(() => somarCents([100, 1.5])).toThrow(RangeError);
  });

  it('rejeita soma que estoura inteiro seguro', () => {
    expect(() => somarCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});
