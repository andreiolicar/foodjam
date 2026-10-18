import type { DeliveryAddress, MenuItem, Store, StoreId } from '../contracts.js';
import type { AddressValidation, CatalogPort } from '../ports.js';
import { StoreNotFoundError } from '../ports.js';

export const LOJAS = {
  hamburgueria: 'loja-burger',
  doceria: 'loja-doceria',
  padaria: 'loja-padaria',
  vegetariano: 'loja-verde',
  japones: 'loja-japa',
} as const;

const stores: Store[] = [
  { id: LOJAS.hamburgueria, name: 'Hamburgueria do Zé', isOpen: true, deliveryFeeCents: 799, minimumOrderCents: 2000 },
  { id: LOJAS.doceria, name: 'Doceria da Vó', isOpen: true, deliveryFeeCents: 590, minimumOrderCents: 8000 },
  { id: LOJAS.padaria, name: 'Padaria Pão Quente', isOpen: true, deliveryFeeCents: 490 },
  { id: LOJAS.vegetariano, name: 'Verde Vegetariano', isOpen: true, deliveryFeeCents: 0, minimumOrderCents: 3000 },
  { id: LOJAS.japones, name: 'Sushi Kento', isOpen: false, deliveryFeeCents: 990, minimumOrderCents: 5000 },
];

const menuItems: MenuItem[] = [
  // Hamburgueria: inclui opção vegetariana e um item indisponível.
  { id: 'burger-x-salada', storeId: LOJAS.hamburgueria, name: 'X-Salada', description: 'Pão, hambúrguer bovino, queijo, alface e tomate', priceCents: 2590, available: true },
  { id: 'burger-x-bacon', storeId: LOJAS.hamburgueria, name: 'X-Bacon', description: 'Hambúrguer bovino, queijo e bacon', priceCents: 2990, available: true },
  { id: 'burger-veggie', storeId: LOJAS.hamburgueria, name: 'Burger Veggie', description: 'Hambúrguer de grão-de-bico, vegetariano', priceCents: 2790, available: true },
  { id: 'burger-duplo', storeId: LOJAS.hamburgueria, name: 'X-Tudo Duplo', description: 'Dois hambúrgueres, ovo, bacon e queijo', priceCents: 3890, available: false },
  { id: 'burger-batata', storeId: LOJAS.hamburgueria, name: 'Batata Frita', description: 'Porção individual', priceCents: 1290, available: true },
  { id: 'burger-refri', storeId: LOJAS.hamburgueria, name: 'Refrigerante Lata', priceCents: 600, available: true },

  // Doceria: pedido mínimo alto.
  { id: 'doce-bolo-cenoura', storeId: LOJAS.doceria, name: 'Bolo de Cenoura', description: 'Fatia com cobertura de chocolate', priceCents: 1490, available: true },
  { id: 'doce-brigadeiro', storeId: LOJAS.doceria, name: 'Brigadeiro Gourmet', description: 'Unidade', priceCents: 450, available: true },
  { id: 'doce-torta-limao', storeId: LOJAS.doceria, name: 'Torta de Limão', description: 'Fatia', priceCents: 1690, available: true },

  // Padaria: lanche e bolo de cenoura mais baratos, sem pedido mínimo.
  { id: 'pad-misto', storeId: LOJAS.padaria, name: 'Misto Quente', description: 'Lanche de presunto e queijo na chapa', priceCents: 1190, available: true },
  { id: 'pad-lanche-natural', storeId: LOJAS.padaria, name: 'Lanche Natural', description: 'Frango, cenoura ralada e requeijão', priceCents: 1390, available: true },
  { id: 'pad-bolo-cenoura', storeId: LOJAS.padaria, name: 'Bolo de Cenoura', description: 'Fatia simples', priceCents: 890, available: true },
  { id: 'pad-cafe', storeId: LOJAS.padaria, name: 'Café com Leite', priceCents: 690, available: true },

  // Vegetariano.
  { id: 'verde-bowl', storeId: LOJAS.vegetariano, name: 'Bowl de Quinoa', description: 'Leve, vegano, com legumes assados', priceCents: 3290, available: true },
  { id: 'verde-wrap', storeId: LOJAS.vegetariano, name: 'Wrap de Falafel', description: 'Vegetariano, com homus', priceCents: 2690, available: true },
  { id: 'verde-salada', storeId: LOJAS.vegetariano, name: 'Salada Caprese', description: 'Leve, vegetariana', priceCents: 2490, available: true },

  // Japonês: loja fechada.
  { id: 'japa-combo', storeId: LOJAS.japones, name: 'Combo 20 peças', description: 'Sushi e sashimi', priceCents: 6990, available: true },
  { id: 'japa-temaki', storeId: LOJAS.japones, name: 'Temaki de Salmão', priceCents: 3290, available: true },
];

/** Minúsculas e sem acento, para "hambúrguer" casar com "hamburguer". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export interface CatalogCall {
  operation: 'validateAddress' | 'searchStores' | 'getMenu';
  input: string;
  /** Endereço recebido nas buscas (formatted), quando houver. */
  address?: string;
}

/** Endereço que o fake aceita sem digitar nada (útil para testes e para o simulador). */
export const ENDERECO_FAKE = 'Rua das Flores, 123 - Centro, São Paulo - SP';

const PREPOSICOES = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

/**
 * Catálogo em memória para testes e simulação. Cenários: hamburgueria com item
 * indisponível, doceria com pedido mínimo alto, padaria com lanche e bolo de
 * cenoura, restaurante vegetariano com entrega grátis e japonês fechado.
 *
 * validateAddress (regras previsíveis, para testes):
 * - sem número ou com menos de 10 letras → "incomplete";
 * - cita "inexistente" → "not_found";
 * - cita uma cidade fora de SP (Manaus, Recife, Porto Alegre) → "out_of_area";
 * - senão, aceita e normaliza (espaços e capitalização).
 */
export class CatalogoFake implements CatalogPort {
  /** Chamadas recebidas, na ordem, para os testes conferirem o uso da porta. */
  readonly calls: CatalogCall[] = [];

  constructor(
    private readonly data: { stores: readonly Store[]; menuItems: readonly MenuItem[] } = { stores, menuItems },
  ) {}

  async validateAddress(text: string): Promise<AddressValidation> {
    this.calls.push({ operation: 'validateAddress', input: text });
    const limpo = text.trim().replace(/\s+/g, ' ');
    const n = normalize(limpo);
    if (!/\d/.test(limpo) || limpo.replace(/[^\p{L}]/gu, '').length < 10) return { ok: false, reason: 'incomplete' };
    if (n.includes('inexistente')) return { ok: false, reason: 'not_found' };
    if (/manaus|recife|porto alegre/.test(n)) return { ok: false, reason: 'out_of_area' };
    // Maiúscula no começo de cada palavra, menos preposições ("Rua das Flores").
    const formatted = limpo.replace(/\p{L}+/gu, (palavra, posicao: number) =>
      posicao > 0 && PREPOSICOES.has(palavra.toLowerCase()) ? palavra.toLowerCase() : palavra[0]?.toUpperCase() + palavra.slice(1),
    );
    return { ok: true, address: { formatted, id: `addr-${n.replace(/[^a-z0-9]+/g, '-').slice(0, 40)}` } };
  }

  async searchStores(query: string, address?: DeliveryAddress): Promise<Store[]> {
    this.calls.push({ operation: 'searchStores', input: query, ...(address && { address: address.formatted }) });
    const terms = normalize(query).split(/\s+/).filter(Boolean);

    return this.data.stores
      .filter((store) => {
        const text = normalize(
          [store.name, ...this.itemsOf(store.id).flatMap((i) => [i.name, i.description ?? ''])].join(' '),
        );
        return terms.every((term) => text.includes(term));
      })
      .map((store) => structuredClone(store));
  }

  async getMenu(storeId: StoreId, address?: DeliveryAddress): Promise<MenuItem[]> {
    this.calls.push({ operation: 'getMenu', input: storeId, ...(address && { address: address.formatted }) });
    if (!this.data.stores.some((s) => s.id === storeId)) {
      throw new StoreNotFoundError(storeId);
    }
    return this.itemsOf(storeId).map((item) => structuredClone(item));
  }

  private itemsOf(storeId: StoreId) {
    return this.data.menuItems.filter((i) => i.storeId === storeId);
  }
}
