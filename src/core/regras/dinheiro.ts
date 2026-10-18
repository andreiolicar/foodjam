import type { MoneyCents } from '../contracts.js';

/** Garante que o valor é um inteiro seguro não negativo (centavos de BRL). */
export function assertMoneyCents(valor: unknown, campo = 'valor'): asserts valor is MoneyCents {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0) {
    throw new RangeError(`${campo} deve ser um inteiro seguro não negativo em centavos; recebido: ${String(valor)}`);
  }
}

/** Soma centavos validando cada parcela e o resultado. */
export function somarCents(valores: readonly MoneyCents[]): MoneyCents {
  let total = 0;
  for (const valor of valores) {
    assertMoneyCents(valor);
    total += valor;
  }
  assertMoneyCents(total, 'soma');
  return total;
}

/** "R$ 25,90" a partir de centavos (só para textos; contas continuam em centavos). */
export function formatarBRL(valor: MoneyCents): string {
  assertMoneyCents(valor);
  const reais = Math.floor(valor / 100).toLocaleString('pt-BR');
  return `R$ ${reais},${String(valor % 100).padStart(2, '0')}`;
}
