import type { DeliveryAddress, MoneyCents, Proposal, StoreId } from './contracts.js';
import type { CatalogPort } from './ports.js';
import { montarPedidos } from './regras/montar-pedidos.js';
import { calcularRateio } from './regras/rateio.js';
import type { CatalogSnapshot } from './regras/validar-escolhas.js';
import type { ProblemaProposta } from './regras/verificar-proposta.js';

export interface CotacaoResult {
  /** Proposta com serviceFeeCents nas lojas cotadas e o rateio refeito. */
  proposal: Proposal;
  /** Taxa cotada por loja. */
  taxas: Map<StoreId, MoneyCents>;
  /** Lojas em que a cotação falhou (ficam sem taxa de serviço). */
  falhas: StoreId[];
}

/**
 * Cota a taxa de serviço de cada loja da proposta na porta do iFood (uma
 * chamada por loja) e refaz pedidos e rateio com ela. Se a cotação de uma
 * loja falhar, a loja fica sem taxa de serviço e entra em `falhas`.
 */
export async function cotarTaxas(
  proposal: Proposal,
  port: CatalogPort,
  address: DeliveryAddress,
  catalog: CatalogSnapshot,
): Promise<CotacaoResult> {
  const taxas = new Map<StoreId, MoneyCents>();
  const falhas: StoreId[] = [];

  for (const order of proposal.orders) {
    try {
      const cotacao = await port.quoteOrder(
        order.storeId,
        order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        address,
      );
      taxas.set(order.storeId, cotacao.serviceFeeCents);
    } catch {
      falhas.push(order.storeId);
    }
  }

  return { proposal: comTaxas(proposal, catalog, taxas), taxas, falhas };
}

/** Refaz pedidos e rateio da proposta com as taxas de serviço informadas. */
export function comTaxas(proposal: Proposal, catalog: CatalogSnapshot, taxas: ReadonlyMap<StoreId, MoneyCents>): Proposal {
  const orders = montarPedidos(
    proposal.orders.flatMap((o) => o.items),
    catalog.stores,
    taxas,
  );
  return { ...proposal, orders, split: calcularRateio(orders) };
}

/** Taxas de serviço que estão na proposta, por loja. */
export function taxasDa(proposal: Proposal): Map<StoreId, MoneyCents> {
  return new Map(proposal.orders.flatMap((o) => (o.serviceFeeCents === undefined ? [] : [[o.storeId, o.serviceFeeCents] as const])));
}

/** Diferenças entre as taxas da proposta e uma nova cotação (para o fechamento). */
export function diferencasDeTaxa(proposal: Proposal, cotacao: CotacaoResult): ProblemaProposta[] {
  return proposal.orders.flatMap((order): ProblemaProposta[] => {
    if (cotacao.falhas.includes(order.storeId)) return [{ code: 'service_fee_unavailable', storeId: order.storeId }];
    const atual = cotacao.taxas.get(order.storeId);
    if (atual === undefined || atual === order.serviceFeeCents) return [];
    return [{ code: 'service_fee_changed', storeId: order.storeId, proposedCents: order.serviceFeeCents ?? null, currentCents: atual }];
  });
}
