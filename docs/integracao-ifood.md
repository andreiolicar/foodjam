# Integração do MCP do iFood com o core (Íris)

Guia para o módulo `src/ifood/`: o que implementar para o core usar o catálogo real do iFood e o que fazer com o pedido autorizado. O core **não conhece as ferramentas do MCP** e não importa `src/ifood`: ele define uma porta (`CatalogPort`) no vocabulário dele, e o módulo iFood implementa essa porta traduzindo as ferramentas reais. A ligação acontece em `src/index.ts`.

```text
core ──CatalogPort──▶ módulo iFood ──ferramentas MCP──▶ iFood
core ──AuthorizedOrder──▶ executor do pedido (módulo iFood) ──MCP──▶ iFood
```

## 1. O que implementar: `CatalogPort` (`src/core/ports.ts`)

```ts
import type { CatalogPort, AddressValidation, CotacaoPedido, ItemCotacao } from '../core/index.js';
import type { DeliveryAddress, MenuItem, Store } from '../core/index.js';
import { StoreNotFoundError } from '../core/index.js';

export class CatalogoIfood implements CatalogPort {
  async validateAddress(text: string): Promise<AddressValidation> { /* ... */ }
  async searchStores(query: string, address: DeliveryAddress): Promise<Store[]> { /* ... */ }
  async getMenu(storeId: string, address: DeliveryAddress): Promise<MenuItem[]> { /* ... */ }
  async quoteOrder(storeId: string, items: readonly ItemCotacao[], address: DeliveryAddress): Promise<CotacaoPedido> { /* ... */ }
}
```

**Nenhuma operação de compra** passa pela porta: `quoteOrder` só cota. O modelo de IA nunca tem acesso ao MCP; quem chama a porta é o código do core.

### `validateAddress(text)`

O organizador digita o endereço livremente; o core repassa o texto para cá.

| Resultado | Quando |
|---|---|
| `{ ok: true, address: { formatted, id? } }` | Endereço encontrado e atendido. `formatted` é o texto normalizado pelo iFood (é o que o organizador vê para confirmar e o que volta nas buscas); `id` é o identificador do endereço no iFood, se houver. |
| `{ ok: false, reason: 'not_found' }` | O iFood não encontrou o endereço. |
| `{ ok: false, reason: 'out_of_area' }` | Endereço existe, mas fora da área de entrega. |
| `{ ok: false, reason: 'incomplete' }` | Faltou rua, número, bairro ou cidade. |

- **Não lance erro para endereço ruim**: devolva `ok: false` com o motivo. Lance só para falha de rede ou do MCP (o core responde `error` e registra em `onError`).
- O core mostra a mensagem do motivo ao organizador e deixa ele digitar de novo.

### `searchStores(query, address)`

- Lojas que **entregam no endereço** e casam com o termo (nome da loja ou de itens do cardápio). `query` vazia: lojas em geral (o core usa como último recurso).
- Devolva também lojas **fechadas**, com `isOpen: false`: quem filtra é o core.
- Nada encontrado: **lista vazia**, sem erro.

### `getMenu(storeId, address)`

- Cardápio da loja para o endereço, **incluindo itens indisponíveis** (`available: false`).
- Loja que não existe: lance `StoreNotFoundError(storeId)`.

### `quoteOrder(storeId, items, address)`

Cota um pedido de uma loja **sem comprar** e devolve a **taxa de serviço** que o iFood cobraria: `{ serviceFeeCents }`, em centavos inteiros. O orçamento das pessoas inclui essa taxa, e só o iFood sabe calculá-la.

- `items`: `{ menuItemId, quantity }[]` do pedido daquela loja.
- Se o iFood montar um carrinho para cotar, **descarte o carrinho** depois: a cotação não pode deixar nada pendente na conta.
- Sem taxa de serviço: devolva `0`.
- Loja que não existe: `StoreNotFoundError(storeId)`. Falha de rede, MCP ou item recusado: lance erro. O core trata: a proposta sai sem a taxa e o grupo é avisado; no fechamento, não fecha até conseguir cotar.

### Formato dos dados (`src/core/contracts.ts`)

| Campo | Regra |
|---|---|
| Todo valor (`deliveryFeeCents`, `minimumOrderCents`, `priceCents`, `serviceFeeCents`) | **Centavos inteiros**: R$ 25,90 → `2590`. Nunca reais com vírgula ou ponto. |
| `Store.isOpen` | Se a loja está aberta agora. |
| `Store.minimumOrderCents` | Pedido mínimo, se houver; ausente se não houver. |
| `MenuItem.available` | Se o item pode ser pedido agora. |
| `MenuItem.description` | Texto do cardápio. Importa: o core usa para checar restrições (ex.: "bovino" para vegetariano). |
| `MenuItem.category` | `'food'` ou `'drink'`, **se o MCP informar a seção do cardápio** (ex.: "Bebidas"). Ausente: o core infere pelo nome. Preencher deixa a regra "bebida nunca substitui comida" exata. |
| ids (`Store.id`, `MenuItem.id`) | Texto opaco e estável: o mesmo item precisa ter o mesmo id entre a proposta e o fechamento. |

## 2. Quantas chamadas o core faz

Importa se o MCP tiver limite de requisições.

| Momento | Chamadas |
|---|---|
| Início da sessão, com endereço padrão | 1 `validateAddress` |
| Cada endereço digitado pelo organizador | 1 `validateAddress` |
| Cada proposta (`propor`) | até 8 `searchStores` (um por termo de preferência) e até 4 `getMenu` (lojas candidatas) |
| Cada proposta, depois de escolher | 1 `quoteOrder` por loja da proposta escolhida e da alternativa (2 a 4) |
| Cada mudança de itens na proposta (ajuste, resposta de orçamento) | 1 `quoteOrder` por loja |
| Fechamento (`fechar`) | por loja do pedido: 1 `searchStores` (pelo nome da loja), 1 `getMenu` e 1 `quoteOrder`, para revalidar preços, disponibilidade e a taxa de serviço |

O fechamento usa o catálogo consultado há no máximo 60 s. A busca da loja pelo nome é provisória: veja `docs/proposta-catalog-getstore.md` (um `getStore(storeId)` deixaria isso exato).

## 3. Executar a compra: `AuthorizedOrder`

Quando o organizador confirma, a fachada devolve `resposta.order` (`AuthorizedOrder`). **O core não compra nada**; quem executa é o módulo iFood.

```ts
interface AuthorizedOrder {
  sessionId: string;            // o grupo
  proposalId: string;           // a proposta autorizada
  authorization: { proposalId; authorizedBy; authorizedAt };
  deliveryAddress: { formatted; id? };   // endereço confirmado pelo organizador
  orders: StoreOrder[];         // um pedido por loja: itens, subtotal, entrega, taxa de serviço, total (centavos)
  split: Split;                 // quanto cada pessoa paga (informativo)
}
```

- **Um pedido no iFood por item de `orders`** (no máximo 2 lojas), todos para `deliveryAddress`.
- Use os `menuItemId`, `quantity` e `unitPriceCents` de cada `ProposedItem`. Se o preço ou a taxa de serviço (`serviceFeeCents`) no iFood estiver diferente na hora da compra, **não compre**: avise o grupo (o fechamento já revalidou, mas pode mudar entre o fechamento e a execução).
- `split` é o rateio entre as pessoas: informativo para o grupo, não muda o pedido no iFood.
- **Idempotência:** se o organizador apertar "Confirmar" duas vezes, a fachada devolve o mesmo `order` com `outcome: 'already_closed'`: **não execute de novo**. Chave sugerida: `${order.proposalId}:${order.authorization.authorizedAt}`.

## 4. Onde ligar (`src/index.ts`)

```ts
import { criarAgente, criarAgrupador, criarLlmDoAmbiente } from './core/index.js';
import { CatalogoIfood } from './ifood/index.js';

const iris = criarAgente({
  catalog: new CatalogoIfood(/* cliente MCP, autenticação */),
  llm: criarLlmDoAmbiente(process.env),
  enderecoPadrao: process.env.ENDERECO_PADRAO, // opcional
  onError: (e) => console.error(e),
});
// o bot recebe `iris` (e o agrupador); ao receber outcome "closed", entrega `resposta.order` ao executor do iFood.
```

O core não lê `process.env` nem abre conexões sozinho: tudo chega por `criarAgente`.

## 5. Como testar

- **Sem bot:** no simulador (`npm run simular`), troque `new CatalogoFake()` pela sua porta e use `/endereco`, `/buscar`, `/cardapio`, `/propor`, `/orcamento` e `/fechar`.
- **Referência de comportamento:** o `CatalogoFake` (`src/core/fakes/catalogo-fake.ts`) implementa a mesma porta com as mesmas regras (lojas fechadas na busca, itens indisponíveis no cardápio, `StoreNotFoundError`, validação de endereço com os três motivos, taxa de serviço de 5% dos itens entre R$ 0,99 e R$ 2,99). Os testes dele (`tests/core/fakes/catalogo-fake.test.ts`) mostram o que o core espera.
- **Valores:** confira que nenhum valor sai em reais (`25.9`): o core rejeita valor que não seja centavo inteiro.

## Pendências a combinar

- `getStore(storeId)` na porta, para o fechamento não depender da busca por nome (`docs/proposta-catalog-getstore.md`).
- Se o MCP devolve a seção do cardápio, preencher `MenuItem.category`.
- Como o MCP cota a taxa de serviço sem comprar (carrinho temporário? simulação?) e se ela depende de algo além de loja, itens e endereço.
- Se a autenticação do MCP precisa de dados do usuário do Telegram (hoje o core não repassa nada além do endereço).
