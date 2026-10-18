import { describe, expect, it } from 'vitest';
import type { StoreOrder } from '../../../src/core/contracts.js';
import { calcularRateio, dividirIgual } from '../../../src/core/regras/rateio.js';

const amounts = (portions: { amountCents: number }[]) => portions.map((p) => p.amountCents);

describe('dividirIgual', () => {
  it('divide 700 entre 3 com o centavo extra para o primeiro', () => {
    expect(dividirIgual(700, ['ana', 'bia', 'caio'])).toEqual([
      { participantId: 'ana', amountCents: 234 },
      { participantId: 'bia', amountCents: 233 },
      { participantId: 'caio', amountCents: 233 },
    ]);
  });

  it('distribui o resto aos primeiros na ordem recebida', () => {
    expect(amounts(dividirIgual(1001, ['a', 'b', 'c', 'd']))).toEqual([251, 250, 250, 250]);
    expect(amounts(dividirIgual(1003, ['a', 'b', 'c', 'd']))).toEqual([251, 251, 251, 250]);
    expect(dividirIgual(1001, ['d', 'c', 'b', 'a'])[0]).toEqual({ participantId: 'd', amountCents: 251 });
  });

  it('divide valor exato sem resto', () => {
    expect(amounts(dividirIgual(900, ['a', 'b', 'c']))).toEqual([300, 300, 300]);
  });

  it('lida com total menor que o número de pessoas e com zero', () => {
    expect(amounts(dividirIgual(2, ['a', 'b', 'c']))).toEqual([1, 1, 0]);
    expect(amounts(dividirIgual(0, ['a', 'b']))).toEqual([0, 0]);
  });

  it('uma pessoa paga tudo', () => {
    expect(amounts(dividirIgual(2590, ['a']))).toEqual([2590]);
  });

  it('rejeita lista vazia, repetidos e total inválido', () => {
    expect(() => dividirIgual(100, [])).toThrow(RangeError);
    expect(() => dividirIgual(100, ['a', 'a'])).toThrow(RangeError);
    expect(() => dividirIgual(-1, ['a'])).toThrow(RangeError);
    expect(() => dividirIgual(10.5, ['a'])).toThrow(RangeError);
  });

  it('a soma sempre bate com o total e as partes diferem no máximo 1 centavo', () => {
    const totals = [0, 1, 2, 7, 99, 100, 101, 700, 999, 1001, 2590, 12_345, 99_999, 1_000_003, Number.MAX_SAFE_INTEGER];
    for (const total of totals) {
      for (let people = 1; people <= 13; people++) {
        const ids = Array.from({ length: people }, (_, i) => `p${i}`);
        const parts = amounts(dividirIgual(total, ids));
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
        expect(parts).toEqual([...parts].sort((a, b) => b - a));
      }
    }
  });
});

describe('calcularRateio', () => {
  it('cada pessoa paga seus itens e parte da entrega da sua loja', () => {
    const split = calcularRateio([
      {
        storeId: 'burger',
        deliveryFeeCents: 700,
        items: [
          { participantId: 'ana', unitPriceCents: 2590, quantity: 1 },
          { participantId: 'bia', unitPriceCents: 3000, quantity: 1 },
          { participantId: 'caio', unitPriceCents: 1000, quantity: 2 },
        ],
      },
    ]);

    expect(split).toEqual({
      shares: [
        { participantId: 'ana', itemsCents: 2590, deliveryCents: 234, serviceCents: 0, totalCents: 2824 },
        { participantId: 'bia', itemsCents: 3000, deliveryCents: 233, serviceCents: 0, totalCents: 3233 },
        { participantId: 'caio', itemsCents: 2000, deliveryCents: 233, serviceCents: 0, totalCents: 2233 },
      ],
      totalCents: 8290,
    });
  });

  it('aceita StoreOrder completo do contrato', () => {
    const order: StoreOrder = {
      storeId: 'padaria',
      items: [
        { participantId: 'ana', storeId: 'padaria', menuItemId: 'lanche', quantity: 1, unitPriceCents: 1500 },
        { participantId: 'bia', storeId: 'padaria', menuItemId: 'bolo', quantity: 1, unitPriceCents: 900, isSubstitute: true },
      ],
      subtotalCents: 2400,
      deliveryFeeCents: 501,
      totalCents: 2901,
    };
    expect(calcularRateio([order]).shares.map((s) => s.totalCents)).toEqual([1751, 1150]);
  });

  it('entrega de cada loja é dividida só entre quem pediu nela', () => {
    const split = calcularRateio([
      {
        storeId: 'padaria',
        deliveryFeeCents: 500,
        items: [
          { participantId: 'ana', unitPriceCents: 1200, quantity: 1 },
          { participantId: 'bia', unitPriceCents: 800, quantity: 1 },
        ],
      },
      {
        storeId: 'doceria',
        deliveryFeeCents: 999,
        items: [{ participantId: 'caio', unitPriceCents: 4500, quantity: 1 }],
      },
    ]);

    expect(split.shares).toEqual([
      { participantId: 'ana', itemsCents: 1200, deliveryCents: 250, serviceCents: 0, totalCents: 1450 },
      { participantId: 'bia', itemsCents: 800, deliveryCents: 250, serviceCents: 0, totalCents: 1050 },
      { participantId: 'caio', itemsCents: 4500, deliveryCents: 999, serviceCents: 0, totalCents: 5499 },
    ]);
    expect(split.totalCents).toBe(1200 + 800 + 500 + 4500 + 999);
  });

  it('pessoa com vários itens na mesma loja paga a entrega uma vez só', () => {
    const split = calcularRateio([
      {
        storeId: 'burger',
        deliveryFeeCents: 600,
        items: [
          { participantId: 'ana', unitPriceCents: 2000, quantity: 1 },
          { participantId: 'ana', unitPriceCents: 500, quantity: 1 },
          { participantId: 'bia', unitPriceCents: 2000, quantity: 1 },
        ],
      },
    ]);

    expect(split.shares.map((s) => s.deliveryCents)).toEqual([300, 300]);
    expect(split.shares[0]?.itemsCents).toBe(2500);
  });

  it('pessoa que pediu nas duas lojas paga parte das duas entregas', () => {
    const split = calcularRateio([
      {
        storeId: 'a',
        deliveryFeeCents: 301,
        items: [
          { participantId: 'ana', unitPriceCents: 1000, quantity: 1 },
          { participantId: 'bia', unitPriceCents: 1000, quantity: 1 },
        ],
      },
      {
        storeId: 'b',
        deliveryFeeCents: 400,
        items: [{ participantId: 'bia', unitPriceCents: 900, quantity: 1 }],
      },
    ]);

    expect(split.shares).toEqual([
      { participantId: 'ana', itemsCents: 1000, deliveryCents: 151, serviceCents: 0, totalCents: 1151 },
      { participantId: 'bia', itemsCents: 1900, deliveryCents: 550, serviceCents: 0, totalCents: 2450 },
    ]);
  });

  it('entrega grátis não muda o valor dos itens', () => {
    const split = calcularRateio([
      { storeId: 'a', deliveryFeeCents: 0, items: [{ participantId: 'ana', unitPriceCents: 1990, quantity: 3 }] },
    ]);
    expect(split.shares).toEqual([{ participantId: 'ana', itemsCents: 5970, deliveryCents: 0, serviceCents: 0, totalCents: 5970 }]);
  });

  it('taxa de serviço é dividida igual entre quem pediu na loja, como a entrega', () => {
    const split = calcularRateio([
      {
        storeId: 'burger',
        deliveryFeeCents: 700,
        serviceFeeCents: 199,
        items: [
          { participantId: 'ana', unitPriceCents: 2590, quantity: 1 },
          { participantId: 'bia', unitPriceCents: 3000, quantity: 1 },
          { participantId: 'caio', unitPriceCents: 1000, quantity: 2 },
        ],
      },
    ]);

    expect(split.shares).toEqual([
      { participantId: 'ana', itemsCents: 2590, deliveryCents: 234, serviceCents: 67, totalCents: 2891 },
      { participantId: 'bia', itemsCents: 3000, deliveryCents: 233, serviceCents: 66, totalCents: 3299 },
      { participantId: 'caio', itemsCents: 2000, deliveryCents: 233, serviceCents: 66, totalCents: 2299 },
    ]);
    expect(split.totalCents).toBe(2590 + 3000 + 2000 + 700 + 199);
  });

  it('taxa de serviço de cada loja fica só com quem pediu nela', () => {
    const split = calcularRateio([
      {
        storeId: 'a',
        deliveryFeeCents: 0,
        serviceFeeCents: 100,
        items: [
          { participantId: 'ana', unitPriceCents: 1000, quantity: 1 },
          { participantId: 'bia', unitPriceCents: 1000, quantity: 1 },
        ],
      },
      { storeId: 'b', deliveryFeeCents: 0, items: [{ participantId: 'caio', unitPriceCents: 900, quantity: 1 }] },
    ]);
    expect(split.shares.map((s) => s.serviceCents)).toEqual([50, 50, 0]);
  });

  it('rejeita taxa de serviço inválida', () => {
    const item = { participantId: 'ana', unitPriceCents: 1000, quantity: 1 };
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: 0, serviceFeeCents: -1, items: [item] }])).toThrow(RangeError);
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: 0, serviceFeeCents: 1.5, items: [item] }])).toThrow(RangeError);
  });

  it('sem pedidos o rateio é vazio', () => {
    expect(calcularRateio([])).toEqual({ shares: [], totalCents: 0 });
  });

  it('rejeita entradas inválidas', () => {
    const item = { participantId: 'ana', unitPriceCents: 1000, quantity: 1 };
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: 500, items: [] }])).toThrow(RangeError);
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: -1, items: [item] }])).toThrow(RangeError);
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: 7.5, items: [item] }])).toThrow(RangeError);
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: 0, items: [{ ...item, unitPriceCents: 10.5 }] }])).toThrow(
      RangeError,
    );
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: 0, items: [{ ...item, quantity: 0 }] }])).toThrow(RangeError);
    expect(() => calcularRateio([{ storeId: 'a', deliveryFeeCents: 0, items: [{ ...item, quantity: 1.5 }] }])).toThrow(RangeError);
  });

  it('a soma das partes sempre bate com itens + entregas para vários valores', () => {
    const people = ['ana', 'bia', 'caio', 'davi', 'eva'];
    for (let seed = 1; seed <= 200; seed++) {
      const random = generator(seed);
      const orders = Array.from({ length: 1 + (seed % 2) }, (_, store) => ({
        storeId: `loja${store}`,
        deliveryFeeCents: random(1500),
        items: Array.from({ length: 1 + random(6) }, () => ({
          participantId: people[random(people.length)] ?? 'ana',
          unitPriceCents: random(10_000),
          quantity: 1 + random(3),
        })),
      }));

      const expected = orders.reduce(
        (total, o) => total + o.deliveryFeeCents + o.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0),
        0,
      );
      const split = calcularRateio(orders);

      expect(split.totalCents).toBe(expected);
      expect(split.shares.reduce((s, p) => s + p.totalCents, 0)).toBe(expected);
      for (const share of split.shares) {
        expect(share.totalCents).toBe(share.itemsCents + share.deliveryCents + share.serviceCents);
      }
    }
  });
});

/** Gerador pseudoaleatório determinístico (LCG) para os testes serem reproduzíveis. */
function generator(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state % limit;
  };
}
