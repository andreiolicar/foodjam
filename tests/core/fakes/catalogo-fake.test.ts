import { describe, expect, it } from 'vitest';
import { CatalogoFake, LOJAS } from '../../../src/core/fakes/catalogo-fake.js';
import { StoreNotFoundError } from '../../../src/core/ports.js';
import { MenuItemSchema, StoreSchema } from '../../../src/core/schemas.js';

const ids = (stores: { id: string }[]) => stores.map((s) => s.id);

describe('CatalogoFake', () => {
  it('tem 5 lojas, todas válidas pelos schemas do domínio', async () => {
    const catalog = new CatalogoFake();
    const stores = await catalog.searchStores('');
    expect(stores).toHaveLength(5);

    for (const store of stores) {
      expect(StoreSchema.safeParse(store).success).toBe(true);
      for (const item of await catalog.getMenu(store.id)) {
        expect(MenuItemSchema.safeParse(item).success).toBe(true);
        expect(item.storeId).toBe(store.id);
      }
    }
  });

  it('busca pelo nome da loja ignorando acento e caixa', async () => {
    expect(ids(await new CatalogoFake().searchStores('HAMBURGUERIA'))).toEqual([LOJAS.hamburgueria]);
    expect(ids(await new CatalogoFake().searchStores('doceria vó'))).toEqual([LOJAS.doceria]);
  });

  it('busca pelos itens do cardápio', async () => {
    expect(ids(await new CatalogoFake().searchStores('bolo de cenoura'))).toEqual([LOJAS.doceria, LOJAS.padaria]);
    expect(ids(await new CatalogoFake().searchStores('lanche'))).toEqual([LOJAS.padaria]);
    expect(ids(await new CatalogoFake().searchStores('vegetariano'))).toEqual([LOJAS.hamburgueria, LOJAS.vegetariano]);
  });

  it('devolve lista vazia quando nada casa', async () => {
    expect(await new CatalogoFake().searchStores('pizza')).toEqual([]);
  });

  it('inclui lojas fechadas e itens indisponíveis; o core é quem filtra', async () => {
    const catalog = new CatalogoFake();
    expect((await catalog.searchStores('sushi'))[0]?.isOpen).toBe(false);
    const menu = await catalog.getMenu(LOJAS.hamburgueria);
    expect(menu.some((item) => !item.available)).toBe(true);
  });

  it('cenários de preço e pedido mínimo', async () => {
    const catalog = new CatalogoFake();
    const [doceria] = await catalog.searchStores('doceria');
    const [padaria] = await catalog.searchStores('padaria');
    expect(doceria?.minimumOrderCents).toBe(8000);
    expect(padaria?.minimumOrderCents).toBeUndefined();

    const boloDoceria = (await catalog.getMenu(LOJAS.doceria)).find((i) => i.name === 'Bolo de Cenoura');
    const boloPadaria = (await catalog.getMenu(LOJAS.padaria)).find((i) => i.name === 'Bolo de Cenoura');
    expect(boloPadaria?.priceCents).toBeLessThan(boloDoceria?.priceCents ?? 0);
  });

  it('rejeita cardápio de loja inexistente', async () => {
    await expect(new CatalogoFake().getMenu('loja-inventada')).rejects.toBeInstanceOf(StoreNotFoundError);
  });

  it('devolve cópias: alterar o resultado não altera o catálogo', async () => {
    const catalog = new CatalogoFake();
    const [item] = await catalog.getMenu(LOJAS.padaria);
    if (!item) throw new Error('padaria sem itens');
    item.priceCents = 1;
    expect((await catalog.getMenu(LOJAS.padaria))[0]?.priceCents).not.toBe(1);
  });

  it('registra as chamadas recebidas', async () => {
    const catalog = new CatalogoFake();
    await catalog.searchStores('bolo');
    await catalog.getMenu(LOJAS.padaria);
    expect(catalog.calls).toEqual([
      { operation: 'searchStores', input: 'bolo' },
      { operation: 'getMenu', input: LOJAS.padaria },
    ]);
  });

  it('aceita dados próprios para cenários específicos', async () => {
    const catalog = new CatalogoFake({
      stores: [{ id: 'l1', name: 'Pizzaria', isOpen: true, deliveryFeeCents: 500 }],
      menuItems: [{ id: 'i1', storeId: 'l1', name: 'Pizza', priceCents: 4500, available: true }],
    });
    expect(ids(await catalog.searchStores('pizza'))).toEqual(['l1']);
  });
});

describe('CatalogoFake.validateAddress', () => {
  it.each([
    ['rua das flores', 'incomplete'],
    ['Rua A, 1', 'incomplete'],
    ['Rua Inexistente, 1 - Lugar Nenhum', 'not_found'],
    ['Rua A, 10 - Centro, Manaus', 'out_of_area'],
  ] as const)('%j → %s', async (texto, reason) => {
    expect(await new CatalogoFake().validateAddress(texto)).toEqual({ ok: false, reason });
  });

  it('normaliza espaços e capitalização e devolve um id', async () => {
    const r = await new CatalogoFake().validateAddress('  rua das  flores, 123 - centro,  são paulo ');
    expect(r).toMatchObject({ ok: true, address: { formatted: 'Rua das Flores, 123 - Centro, São Paulo' } });
    expect(r.ok && r.address.id).toMatch(/^addr-/);
  });

  it('registra o endereço recebido nas buscas', async () => {
    const fake = new CatalogoFake();
    await fake.searchStores('bolo', { formatted: 'Rua X, 1' });
    await fake.getMenu(LOJAS.padaria, { formatted: 'Rua X, 1' });
    expect(fake.calls).toEqual([
      { operation: 'searchStores', input: 'bolo', address: 'Rua X, 1' },
      { operation: 'getMenu', input: LOJAS.padaria, address: 'Rua X, 1' },
    ]);
  });
});
