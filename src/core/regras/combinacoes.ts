import type { MenuItemId, MoneyCents, ParticipantId, StoreId } from '../contracts.js';

/** Classificação do modelo para um desejo: ids do melhor para o pior. O resto "não serve". */
export interface DesejoClassificado {
  atende: readonly MenuItemId[];
  substitutos: readonly MenuItemId[];
}

export interface PessoaClassificada {
  participantId: ParticipantId;
  /** Na mesma ordem dos desejos da pessoa. */
  desejos: readonly DesejoClassificado[];
}

export interface Escolha {
  participantId: ParticipantId;
  menuItemId: MenuItemId;
  storeId: StoreId;
  isSubstitute: boolean;
  /** Índice do desejo atendido. */
  desejo: number;
}

/** Todas as combinações de 1 e de 2 lojas, nesta ordem. */
export function enumerarCombinacoes(storeIds: readonly StoreId[]): StoreId[][] {
  const unicas = [...new Set(storeIds)];
  const pares: StoreId[][] = [];
  for (let i = 0; i < unicas.length; i++) {
    for (let j = i + 1; j < unicas.length; j++) pares.push([unicas[i] as StoreId, unicas[j] as StoreId]);
  }
  return [...unicas.map((s) => [s]), ...pares];
}

/**
 * Melhor item de cada desejo dentro das lojas da combinação: o primeiro
 * "atende" disponível; senão, o primeiro "substituto". A mesma pessoa não
 * recebe o mesmo item duas vezes. Desejo sem opção na combinação fica sem item.
 */
export function escolherNaCombinacao(
  combinacao: readonly StoreId[],
  pessoas: readonly PessoaClassificada[],
  lojaDoItem: ReadonlyMap<MenuItemId, StoreId>,
): Escolha[] {
  const lojas = new Set(combinacao);
  const escolhas: Escolha[] = [];

  for (const pessoa of pessoas) {
    const usados = new Set<MenuItemId>();
    pessoa.desejos.forEach((desejo, indice) => {
      const primeiro = (ids: readonly MenuItemId[]) =>
        ids.find((id) => !usados.has(id) && lojas.has(lojaDoItem.get(id) ?? ''));
      const atende = primeiro(desejo.atende);
      const escolhido = atende ?? primeiro(desejo.substitutos);
      const storeId = escolhido && lojaDoItem.get(escolhido);
      if (!escolhido || !storeId) return;
      usados.add(escolhido);
      escolhas.push({ participantId: pessoa.participantId, menuItemId: escolhido, storeId, isSubstitute: !atende, desejo: indice });
    });
  }
  return escolhas;
}

export interface Metricas {
  /** Pessoas com todos os desejos atendidos (sem substituto). */
  atendidos: number;
  /** Desejos que ficaram sem item nenhum. */
  faltando: number;
  substitutos: number;
  lojas: number;
  totalCents: MoneyCents;
}

export function medir(
  escolhas: readonly Escolha[],
  pessoas: readonly PessoaClassificada[],
  lojas: number,
  totalCents: MoneyCents,
): Metricas {
  const atendidos = pessoas.filter((p) =>
    p.desejos.every((_, i) => escolhas.some((e) => e.participantId === p.participantId && e.desejo === i && !e.isSubstitute)),
  ).length;
  const desejos = pessoas.reduce((t, p) => t + p.desejos.length, 0);
  return { atendidos, faltando: desejos - escolhas.length, substitutos: escolhas.filter((e) => e.isSubstitute).length, lojas, totalCents };
}

/**
 * Ordem de preferência: mais pessoas atendidas com o que pediram > menos
 * desejos sem item > menos substitutos > menos lojas > menor total.
 * ("menos desejos sem item" impede que deixar alguém sem nada vença um substituto.)
 */
export function compararMetricas(a: Metricas, b: Metricas): number {
  return (
    b.atendidos - a.atendidos ||
    a.faltando - b.faltando ||
    a.substitutos - b.substitutos ||
    a.lojas - b.lojas ||
    a.totalCents - b.totalCents
  );
}
