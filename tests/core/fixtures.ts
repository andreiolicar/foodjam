import type { DeliveryAddress, MenuItem, Participant, Proposal, ProposedItem, Store } from '../../src/core/contracts.js';
import { CatalogoFake, LOJAS } from '../../src/core/fakes/catalogo-fake.js';
import { montarPedidos } from '../../src/core/regras/montar-pedidos.js';
import { calcularRateio } from '../../src/core/regras/rateio.js';
import type { CatalogSnapshot, TimedCatalogSnapshot } from '../../src/core/regras/validar-escolhas.js';
import type { CoreSession } from '../../src/core/sessao.js';
import { apresentarProposta, criarSessao, pedirConfirmacao } from '../../src/core/sessao.js';

export const ORG = 'ana';
export const AGORA = '2026-10-18T12:00:00.000Z';
/** 30 s antes de AGORA: dentro do limite de 60 s do fechamento. */
export const CONSULTA = '2026-10-18T11:59:30.000Z';
/** Endereço confirmado usado nos cenários de teste. */
export const ENDERECO: DeliveryAddress = { formatted: 'Rua das Flores, 123 - Centro, São Paulo - SP', id: 'addr-teste' };

/** Catálogo inteiro do fake, como snapshot consultado em CONSULTA. */
export async function catalogoCompleto(): Promise<TimedCatalogSnapshot> {
  const fake = new CatalogoFake();
  const stores = await fake.searchStores('');
  const menuItems = (await Promise.all(stores.map((s) => fake.getMenu(s.id)))).flat();
  return { stores, menuItems, fetchedAt: CONSULTA };
}

export function item(catalog: CatalogSnapshot, participantId: string, menuItemId: string, quantity = 1): ProposedItem {
  const menuItem = catalog.menuItems.find((i) => i.id === menuItemId);
  if (!menuItem) throw new Error(`item ${menuItemId} não está no fake`);
  return { participantId, storeId: menuItem.storeId, menuItemId, quantity, unitPriceCents: menuItem.priceCents };
}

export function proposta(catalog: CatalogSnapshot, items: ProposedItem[], id = 'p1'): Proposal {
  const orders = montarPedidos(items, catalog.stores);
  return { id, sessionId: 's1', orders, split: calcularRateio(orders), uncoveredParticipantIds: [], justification: 'ok' };
}

const pessoa = (id: string, budgetCents?: number): Participant => ({
  id,
  displayName: id,
  preferences: budgetCents === undefined ? {} : { budgetCents },
});

/** Ana (organizadora), Bia e Caio pedindo na padaria; Caio com orçamento opcional. */
export async function cenarioPadaria(orcamentoCaio?: number) {
  const catalog = await catalogoCompleto();
  const participants = [pessoa(ORG), pessoa('bia'), pessoa('caio', orcamentoCaio)];
  // Sessão já com endereço de entrega confirmado (propor e fechar exigem).
  const base: CoreSession = {
    ...criarSessao({ id: 's1', organizerId: ORG, participants }),
    address: { status: 'confirmed', confirmed: ENDERECO },
  };
  const p = proposta(catalog, [
    item(catalog, ORG, 'pad-misto'),
    item(catalog, 'bia', 'pad-lanche-natural'),
    item(catalog, 'caio', 'pad-bolo-cenoura'),
  ]);
  const revisao = apresentarProposta(base, p);
  return { catalog, revisao, confirmacao: pedirConfirmacao(revisao) };
}

/** Snapshot com uma loja ou item alterado, simulando mudança no catálogo. */
export function alterarCatalogo(
  catalog: TimedCatalogSnapshot,
  changes: { store?: [string, Partial<Store>]; item?: [string, Partial<MenuItem>] },
): TimedCatalogSnapshot {
  return {
    ...catalog,
    stores: catalog.stores.map((s) => (changes.store && s.id === changes.store[0] ? { ...s, ...changes.store[1] } : s)),
    menuItems: catalog.menuItems.map((i) => (changes.item && i.id === changes.item[0] ? { ...i, ...changes.item[1] } : i)),
  };
}

export type { CoreSession };
export { LOJAS };
