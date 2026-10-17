# Core / Agente IA — Ana Paula

Branch: `feat/core-agent`.

Agente **Íris** e regras de negócio do FoodJam: sessões, coleta de preferências, proposta de pedido, ajustes, rateio e autorização de fechamento. O core recebe `IncomingMessage`, devolve `CoreAction` e dados estruturados, e **não executa a compra**: só entrega o `AuthorizedOrder` depois da confirmação do organizador.

## Fronteira

- Não importa grammY, `src/telegram` ou `src/ifood`, nem configura transporte MCP.
- Acessa o catálogo e o modelo só por **portas** (`ports.ts`), no vocabulário do domínio. O módulo iFood implementa a `CatalogPort`; o core não presume nomes de ferramentas do iFood.
- Funções recebem estado e devolvem estado novo; os únicos efeitos são as chamadas às portas. Horários e ids chegam como parâmetro (o core não lê relógio).

## Regras invioláveis

- Dinheiro sempre em `MoneyCents` (centavos inteiros, seguros, não negativos), validado em runtime (`assertMoneyCents`, `MoneyCentsSchema`).
- **O modelo nunca calcula valores nem autoriza compra.** Preços vêm do catálogo; subtotais, taxas, rateio e checagens são feitos em código.
- O rateio soma exatamente o total, centavo a centavo (o centavo que sobra vai para os primeiros da lista).
- Orçamento é privado: nunca entra no prompt nem nas mensagens de erro.
- Só o organizador confirma/fecha, uma única vez por sessão (idempotente).

## Fluxo

```text
coleta ──/propor──▶ proposta (reviewing) ──pedirConfirmacao──▶ confirmação ──fechar──▶ fechada
   ▲                  │  ▲ ajustes                    │                         (AuthorizedOrder)
   └──voltarParaColeta┘  └───────── ajuste ───────────┘
qualquer fase não final ──cancelar──▶ cancelada
```

| Fase | Arquivo | Modelo | O que faz |
|---|---|---|---|
| Coleta | `coleta.ts` | `fast`, sem ferramentas | Filtro barato (descarta vazias e só emoji), extrai `foodPreferences`, `dietaryRestrictions`, `avoids` e o trecho de orçamento (convertido em código). Perguntas ficam em `pendingQuestions`. |
| Proposta | `proposta.ts` | `capable`, sem tool calling | Busca lojas em código (`catalogo.ts`), filtra itens elegíveis por pessoa (`regras/elegibilidade.ts`), o modelo escolhe ids, o código valida, recalcula e escolhe a melhor opção. |
| Ajuste | `ajuste.ts` | `fast` | `interpretarAjuste` converte texto em troca estruturada; `ajustar` troca o item da pessoa e recalcula. A pessoa só troca o próprio item. |
| Fechamento | `fechamento.ts` | nenhum | Exige organizador e catálogo consultado há no máximo 60 s; revalida tudo e devolve `AuthorizedOrder`. |

## Guardrails do modelo

- Mensagens e dados externos (nomes de loja/item, perguntas) entram **delimitados e escapados** (`<mensagem_usuario>`, `<catalogo>`...); o prompt de sistema manda tratá-los como dados.
- Saída validada com Zod (`schemas.ts`); schemas estritos: campo extra (ex.: preço) reprova. Fora do schema → uma nova tentativa com o erro → fallback (`llm.ts`).
- O modelo só escolhe entre ids permitidos para cada pessoa; escolha fora disso é descartada com motivo.
- Só portas de leitura de catálogo; não existe ferramenta de pedido para o modelo.
- Cada chamada é registrada (fase, nível, tentativa, duração, sucesso) via `registrar`.

## Mapa dos arquivos

| Caminho | Conteúdo |
|---|---|
| `contracts.ts` | Tipos compartilhados com o time (ver abaixo). |
| `ports.ts` | `CatalogPort` (só leitura) e `LlmPort` (níveis `fast`/`capable`). |
| `schemas.ts` | Schemas Zod do domínio e das saídas do modelo (coleta, proposta, ajuste). |
| `sessao.ts` | Máquina de estados, confirmação idempotente, `CoreSession` (proposta, fechamento, perguntas). |
| `llm.ts` | `gerarEstruturado`: chamada + Zod + nova tentativa + timeout + registro. |
| `llm-openai.ts` | Adaptador compatível com OpenAI via `fetch` (sem SDK); cai de `json_schema` para `json_object` e para nenhum se o provedor recusar. |
| `llm-ambiente.ts` | Escolhe a `LlmPort` por `AI_PROVIDER` (`fake` ou `openai-compat`). |
| `catalogo.ts` | Recuperação de lojas candidatas e reconsulta do catálogo para o fechamento. |
| `prompts/` | Prompts de sistema e montagem dos dados delimitados (em `.ts`, para irem ao build). |
| `regras/` | Dinheiro, rateio, montagem de pedidos, elegibilidade, validação de escolhas e `verificarProposta`. |
| `fakes/` | `CatalogoFake` (5 lojas), `FakeLlm` (roteirizado e heurístico) e casos de avaliação da coleta. |

## Contratos compartilhados (`contracts.ts`)

- `SessionId`, `ParticipantId`, `MoneyCents`.
- `ParticipantPreferences`: `foodPreferences`, `dietaryRestrictions` (restrição dura, de saúde), `avoids` (rejeição de gosto) e `budgetCents` (privado).
- `SessionStatus`: `collecting`, `reviewing`, `awaiting_confirmation`, `closed`, `cancelled`.
- `IncomingMessage`, `CoreAction`.
- Catálogo e proposta: `Store`, `MenuItem`, `ProposedItem` (com `isSubstitute?`), `StoreOrder`, `ParticipantShare`, `Split`, `Proposal`.
- Fechamento: `OrderAuthorization` e **`AuthorizedOrder`** — fronteira com quem executa o pedido.

Alterações aqui são mínimas e combinadas com o time; consuma com `import type`.

## Configuração do modelo

Variáveis (ver `.env.example`): `AI_PROVIDER` (`openai-compat` ou vazio/`fake`), `AI_BASE_URL`, `AI_MODEL` (ou `AI_MODEL_FAST` e `AI_MODEL_CAPABLE`) e `AI_API_KEY`. Sem chave, o simulador usa o modelo fake heurístico. Testes nunca chamam rede.

## Como rodar

```bash
npm run check            # lint + tipos (inclui scripts/) + testes
npm run simular          # grupo no terminal: "Pedro: algo leve", /propor, /ajustar, /fechar
npm run avaliar:coleta   # avalia o prompt de coleta no modelo configurado (acerto e latência)
```

## Pendências

- Medir o modelo real com `npm run avaliar:coleta` (o 100% atual é do fake heurístico).
- `getStore(storeId)` na `CatalogPort`: proposta em `docs/proposta-catalog-getstore.md`, a combinar com o módulo iFood.
- Integração com o Telegram e com a `CatalogPort` real em `src/index.ts`.
- Regras de restrição são palavras-chave conservadoras; itens sem descrição saem como `uncertain` para confirmar.
