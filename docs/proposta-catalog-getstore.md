# Proposta: `getStore(storeId)` na `CatalogPort`

Status: **em discussão**, a combinar entre o core e o módulo iFood. Nada foi alterado na porta.

## Problema

No fechamento, o core revalida o pedido contra um retrato recente do catálogo (até 60 s, configurável): loja aberta, taxa de entrega, pedido mínimo, preços e disponibilidade.

Hoje a `CatalogPort` só tem `searchStores(query)` e `getMenu(storeId)`. Para reconsultar uma loja já conhecida, o core (`atualizarCatalogo` em `src/core/catalogo.ts`) busca pelo **nome** da loja e confere o id no resultado. Isso funciona no catálogo fake, mas é frágil no real:

- a busca por nome pode não trazer a loja (ranking, paginação, endereço de entrega);
- lojas com o mesmo nome dependem da conferência de id;
- é uma chamada mais cara do que o necessário.

## Proposta

```ts
export interface CatalogPort {
  searchStores(query: string): Promise<Store[]>;
  getMenu(storeId: StoreId): Promise<MenuItem[]>;
  /** Dados atuais de uma loja (aberta, taxa, pedido mínimo). Rejeita com StoreNotFoundError. */
  getStore(storeId: StoreId): Promise<Store>;
}
```

Com isso, `atualizarCatalogo` passa a usar `getStore` + `getMenu` por loja da proposta, sem depender da busca.

## Pergunta para o módulo iFood

O MCP do iFood permite consultar uma loja pelo id (ou obter taxa, horário e pedido mínimo junto do cardápio)?

- **Sim:** acrescentamos `getStore` à porta e o adaptador mapeia para a ferramenta correspondente.
- **Só junto do cardápio:** alternativa é `getMenu` devolver `{ store: Store; items: MenuItem[] }`.
- **Não:** mantemos a busca por nome como hoje e documentamos o risco.
