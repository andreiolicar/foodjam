import type { ParticipantPreferences } from '../contracts.js';
import { MAX_QUANTITY } from '../schemas.js';
import { compatibilidadeComprovada } from './compatibilidade.js';

const numbers: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const ambiguous = new Set(['alguns', 'algumas', 'uns', 'umas', 'varios', 'varias', 'duzia', 'duzias', 'meia', 'metade', 'dobro', 'mais', 'menos', 'aproximadamente', 'cerca', 'ate', 'maximo', 'minimo',
  'zero', 'onze', 'doze', 'treze', 'quatorze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte', 'trinta', 'cem', 'cento', 'mil']);
const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const unit = (s: string | undefined) => s !== undefined && /^(?:unidades?|x)$/.test(s);
const number = (s: string | undefined) => s !== undefined && (/^(?:[+−-]?\d|[.,]\d)/.test(s) || Object.hasOwn(numbers, s));
const valid = (n: number) => Number.isSafeInteger(n) && n >= 1 && n <= MAX_QUANTITY;
const tokenize = (s: string) => [...normalize(s).matchAll(/[+−-]?(?:\d+(?:[.,/]\d+)?(?:e[+-]?\d+)?|[.,]\d+)%?|\p{L}+/gu)].map(m => m[0]);
const singular = (s: string) => number(s) || ambiguous.has(s) ? s : s.replace(/eis$/, 'el').replace(/ais$/, 'al').replace(/oes$/, 'ao').replace(/([^s])s$/, '$1');
function matches(wish: string, tokens: readonly string[]): boolean {
  const names = [tokens.join(' '), tokens.map(singular).join(' ')];
  return names.some(name => compatibilidadeComprovada(wish, { name })
    || compatibilidadeComprovada(wish, { name: name.replace(/(\d+) (ml|g|kg|l|cm)\b/g, '$1$2') }));
}

/** Usa o desejo interpretado para localizar o alimento, mas a quantidade vem da mensagem. */
export function quantidadesDaMensagem(text: string, wishes: readonly string[], current: ParticipantPreferences): number[] | undefined {
  if (!wishes.length) return [];
  // Uma expressão monetária comprovada não limita a quantidade do alimento.
  const quantityText = normalize(text).replace(/(?:(?:ate|limite(?: de)?|orcamento(?: de)?)\s*)?(?:r\$\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:real|reais))(?:\s+(?:no\s+)?maximo)?/g, ' ');
  const tokens = tokenize(quantityText);
  const used = new Set<number>();
  const productWords = new Set<number>();
  const quantities: number[] = [];
  for (const wish of wishes) {
    // Saída do modelo que incorporou uma contagem ao nome não comprova uma
    // unidade. Peça esclarecimento em vez de isentar esse número como produto.
    const wishTokens = tokenize(wish);
    const first = wishTokens[0];
    if ((number(first) && !['um', 'uma'].includes(first!)) || ambiguous.has(first ?? '')) return undefined;
    if (wishTokens.some((token, index) => number(token) && (unit(wishTokens[index + 1]) || wishTokens[index - 1] === 'x'))) return undefined;
    const mentions: { quantity: number; position: number; explicit: boolean }[] = [];
    for (let start = 0; start < tokens.length; start++) {
      if (!matches(wish, tokens.slice(start))) continue;
      let end = start;
      while (end < tokens.length && !matches(wish, tokens.slice(start, end + 1))) end++;
      for (let index = start; index <= end; index++) productWords.add(index);
      let before = start - 1;
      if (tokens[before] === 'de') before--;
      if (unit(tokens[before])) before--;
      if (ambiguous.has(tokens[before] ?? '')) return undefined;
      let index = number(tokens[before]) ? before : undefined;
      if (index === undefined && number(tokens[end + 1]) && unit(tokens[end + 2])) index = end + 1;
      if (index === undefined && tokens[end + 1] === 'x' && number(tokens[end + 2])) index = end + 2;
      if (index === undefined && number(tokens[end + 1]) && (end + 2 === tokens.length || ['e', 'ou'].includes(tokens[end + 2]!))) return undefined;
      let quantity = 1;
      if (index !== undefined) {
        const token = tokens[index]!;
        quantity = numbers[token] ?? (/^\d+$/.test(token) ? Number(token) : NaN);
        if (!valid(quantity) || ambiguous.has(tokens[index - 1] ?? '')
          || tokens[index - 1] === 'de' && ambiguous.has(tokens[index - 2] ?? '')
          || ['ou', 'a', 'e'].includes(tokens[index - 1] ?? '') && number(tokens[index - 2])) return undefined;
        used.add(index);
      }
      // O guardrail também remove artigos/verbos. Não tratar esses prefixos
      // como menções adicionais que substituam uma quantidade explícita.
      if (index === undefined && mentions.some(m => m.explicit && Math.abs(m.position - start) < 4)) continue;
      mentions.push({ quantity, position: start, explicit: index !== undefined });
    }
    const explicit = mentions.filter(m => m.explicit);
    const chosen = explicit.length ? explicit : mentions;
    const previous = current.wishes?.indexOf(wish) ?? -1;
    if (!explicit.length && previous >= 0) { quantities.push(quantidadeDoDesejo(current, previous)); continue; }
    if (chosen.length) {
      const distinct = new Set(chosen.map(m => m.quantity));
      if (distinct.size > 1) {
        // Coleta em lote concatena mensagens em ordem; correção explícita ou
        // mensagem posterior pode substituir a quantidade, nunca somar por conta própria.
        const source = normalize(text);
        if (!source.includes('\n') && !/\b(?:na verdade|agora|em vez)\b/.test(source)) return undefined;
      }
      quantities.push(chosen.at(-1)!.quantity);
    } else {
      quantities.push(1);
    }
  }
  // Um número solto numa intenção de quantidade não pode virar uma unidade
  // apenas porque o modelo devolveu um nome que não o associa à mensagem.
  for (const [index, token] of tokens.entries()) {
    if (!number(token) || used.has(index)) continue;
    if (['um', 'uma'].includes(token)) {
      if (ambiguous.has(tokens[index - 1] ?? '')) return undefined;
      if (index === tokens.length - 1 && /^(?:quero|queria|gostaria|pedir|mande|apenas|so)$/.test(tokens[index - 1] ?? '')) return undefined;
      continue;
    }
    if (productWords.has(index) || /^(?:reais?|real|r|ml|g|kg|l|litros?|cm)$/.test(tokens[index + 1] ?? '')
      || /^(?:r|ate|maximo|limite|orcamento)$/.test(tokens[index - 1] ?? '')) continue;
    return undefined;
  }
  return quantities;
}

/** Rejeita metadados desalinhados/fora do limite; nunca troca um erro por quantity=1. */
export function quantidadeDoDesejo(preferences: ParticipantPreferences, index: number): number {
  if (preferences.wishQuantities === undefined) return 1;
  const values = preferences.wishQuantities;
  if (!preferences.wishes || values.length !== preferences.wishes.length || values.some(n => !valid(n)) || !valid(values[index]!)) throw new Error('Quantidade de desejo inválida.');
  return values[index]!;
}
