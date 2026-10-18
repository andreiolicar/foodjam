# 06 — Feedback sobre os MCPs do iFood

**Projeto:** Íris (foodjam)  
**Hackathon:** SEMCOMP × iFood 2026 — *Desafio: Vendendo com Agentes*  
**Destinatário:** Time de Plataforma, Engenharia e Developer Experience (DevX) do MCP iFood  
**Data dos Testes:** 17/10/2026  
**Ambiente de Teste:** Endpoint oficial `https://consumer-mcp.ifood.com.br/marketplace` via cliente MCP remoto com OAuth  

---

## 1. Resumo Executivo

Durante a construção da **Íris**, realizamos testes práticos e exploratórios com as ferramentas do MCP do iFood, criando e auditando carrinhos reais em estabelecimentos parceiros.

O objetivo deste documento é fornecer um **insumo técnico direto, construtivo e fundamentado em evidências** para apoiar a evolução contínua da ferramenta. No geral, o protocolo e a velocidade de resposta do MCP do iFood demonstraram alta maturidade; contudo, a construção de agentes de comércio autônomo e colaborativo esbarra em algumas lacunas de granularidade e observabilidade.

---

## 2. Dores Reais e Ocorrências Observadas

### Ocorrência 1 (Código: `MCP-02`): Benefícios Agregados sem Decomposição por Origem

* **Ocorrência:** No retorno da ferramenta `ifood_getCart`, os benefícios aplicados são informados em um campo numérico único agregado (ex.: `benefits: 39.90`), sem discriminação de quais itens ou taxas foram abatidos.
* **Impacto no Agente:**
  Em pedidos individuais, o consumidor final apenas se alegra com o desconto total. Em pedidos coletivos ou corporativos mediados por agentes, **a falta de atribuição inviabiliza o rateio justo e auditável**:
  - Não é possível saber se o desconto veio de um frete grátis (que deveria beneficiar o grupo todo igualmente), de um cupom global da loja ou de uma promoção do tipo *"leve 2 pague 1"* em um prato específico de um participante.
  - Para fechar a conta, o agente é forçado a adotar heurísticas e políticas experimentais arbitrárias de rateio, comprometendo a transparência financeira.
* **Sugestão de Melhoria:**
  Expor em `ifood_getCart` uma lista estruturada de benefícios:
  ```json
  "benefits": [
    {
      "id": "cupom_frete_gratis",
      "type": "DELIVERY_DISCOUNT",
      "valueCents": 990,
      "description": "Entrega Grátis iFood Clube"
    },
    {
      "id": "promo_burger_veggie",
      "type": "ITEM_DISCOUNT",
      "targetItemId": "item_burger_123",
      "valueCents": 3000,
      "description": "Desconto Especial no Hambúrguer Vegetariano"
    }
  ]
  ```

---

### Ocorrência 2 (Código: `MCP-03`): Mutação de Valores sem Histórico entre `createCart` e `getCart`

* **Evidência Registrada no Teste:**
  Ao criar um carrinho com 3 itens pelo `ifood_createCart` e, em seguida, consultá-lo pelo `ifood_getCart` com o mesmo `cartId` e sem qualquer alteração de itens, os totais sofreram mutação expressiva:

  | Campo | Retorno de `ifood_createCart` | Retorno de `ifood_getCart` | Variação Observada |
  |---|---:|---:|:---:|
  | Subtotal dos Itens | R$ 108,70 | R$ 108,70 | R$ 0,00 |
  | Taxa de Serviço | R$ 2,17 | R$ 2,17 | R$ 0,00 |
  | Entrega Informada | R$ 0,00 | R$ 0,00 | R$ 0,00 |
  | Benefícios Agregados | R$ 9,90 | **R$ 39,90** | **+ R$ 30,00** |
  | **Total do Carrinho** | **R$ 110,87** | **R$ 80,87** | **- R$ 30,00** |

* **Dificuldade Sentida:**
  A redução de R$ 30,00 no total ocorreu de forma silenciosa. A resposta de `getCart` não trouxe histórico de recálculo, aviso de cupom automático aplicado ou indicação de versão da cotação.
* **Sugestão de Melhoria:**
  - Garantir consistência imediata entre a resposta de `createCart` e a leitura de `getCart`.
  - Incluir um metadado indicando se o cálculo foi atualizado (`recalculated: true`) e qual o gatilho da atualização.

---

### Ocorrência 3 (Código: `MCP-01`): Comportamento do Filtro `refinements.merchantId` em `searchOffers`

* **Ocorrência:** Ao realizar buscas de ofertas filtradas por um restaurante específico usando o parâmetro `refinements.merchantId`, foram retornados itens pertencentes a outros estabelecimentos da praça (resultados globais).
* **Impacto:** Para garantir que todos os itens pertencessem à mesma loja e evitar dispersão de múltiplos fretes, nossa equipe precisou recorrer à ferramenta `browseOffers` com paginação manual e varredura de catálogo.
* **Sugestão de Melhoria:**
  - Corrigir o escopo do filtro de estabelecimento em `ifood_searchOffers`.
  - Disponibilizar uma ferramenta explícita e direta: `ifood_searchStoreOffers(merchantId, query)`.

---

### Ocorrência 4 (Código: `MCP-04`): Ausência de Descoberta de Carrinho Ativo (`getActiveCart`)

* **Ocorrência:** A ferramenta `ifood_getCart` requer obrigatoriamente a passagem do parâmetro `cartId`. Não encontramos uma ferramenta para consultar se o usuário autenticado já possui um carrinho aberto em andamento.
* **Impacto:** Se o processo do cliente reiniciar ou a sessão sofrer timeout, o agente perde a referência do carrinho criado no iFood, correndo o risco de gerar carrinhos órfãos no backend do marketplace.
* **Sugestão de Melhoria:**
  Criar a ferramenta `ifood_getUserActiveCart()`, retornando o `cartId` atual e a loja vinculada, ou `null` caso não haja carrinho aberto.

---

### Ocorrência 5 (Código: `MCP-05`): Falta de Atributos Dietéticos Estruturados nos Itens

* **Ocorrência:** Os produtos retornados por `ifood_getItem` e `ifood_browseOffers` possuem título, preço e descrição textual livre, mas não trazem campos estruturados padronizados sobre restrições alimentares (ex.: vegetariano, vegano, sem glúten, sem lactose).
* **Impacto:** O agente é obrigado a utilizar modelos de NLP ou regex sobre a descrição textual do prato para inferir se um hambúrguer é vegetariano. Essa inferência é vulnerável a descrições incompletas ou ambíguas dos restaurantes, elevando o risco de incidentes alérgicos.
* **Sugestão de Melhoria:**
  Adicionar ao schema de itens um array padronizado de tags dietéticas (`dietaryTags` / `allergens`), permitindo filtragem determinística e segura por código.

---

### Ocorrência 6: Proposta de `getStore(storeId)` para Revalidação Relâmpago

* **Ocorrência:** Na fase de fechamento do pedido, o agente precisa revalidar rapidamente se a loja continua aberta (`isOpen`) e se os parâmetros de pedido mínimo foram mantidos, sem ter que executar uma nova busca textual pelo nome da loja.
* **Sugestão de Melhoria:**
  Garantir no MCP a ferramenta `ifood_getStore(storeId)` (ou `ifood_getMerchant(merchantId)` com atributos operacionais atualizados de status de abertura, tempo estimado e pedido mínimo).

---

## 3. Síntese do Feedback: Prioridades para a Próxima Release do MCP

| Prioridade | Oportunidade Identificada | Ganho para a Comunidade de Desenvolvedores de Agentes |
|:---:|---|---|
| **P0** | **Decomposição estruturada de benefícios em `getCart`** | Viabiliza rateios financeiros justos, auditoria de cupons e transparência em compras coletivas. |
| **P1** | **Atributos dietéticos e de alérgenos padronizados no cardápio** | Garante segurança alimentar e elimina alucinações em filtros de restrições. |
| **P1** | **Consistência de totais entre `createCart` e `getCart`** | Evita surpresas financeiras e simplifica o fluxo de checkout dos agentes. |
| **P2** | **Descoberta de carrinho ativo (`getActiveCart`)** | Facilita recuperação de estado em sessões persistentes e evita carrinhos órfãos. |
| **P2** | **Filtro estrito de catálogo por loja (`searchStoreOffers`)** | Reduz tráfego de dados e economiza tokens de contexto do modelo de IA. |

