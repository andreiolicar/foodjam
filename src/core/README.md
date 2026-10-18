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
coleta ──propor──▶ proposta (reviewing) ──pedirConfirmacao──▶ confirmação ──fechar──▶ fechada
   ▲                  │  ▲ ajustes                    │                         (AuthorizedOrder)
   └──voltarParaColeta┘  └──── recusa no fechamento ──┘
                             (valor pendente, taxa ou catálogo mudou: volta para reviewing)
qualquer fase não final ──cancelar──▶ cancelada
```

| Fase | Arquivo | Modelo | O que faz |
|---|---|---|---|
| Coleta | `coleta.ts` | `fast`, sem ferramentas | Filtro barato (descarta vazias e só emoji), extrai `foodPreferences`, `dietaryRestrictions`, `avoids` e o trecho de orçamento (convertido em código). Perguntas ficam em `pendingQuestions`. `coletarLote` faz o mesmo para até 10 pessoas numa chamada, com schema montado com os ids do lote. |
| Proposta | `proposta.ts` | `capable` (classificação) + `fast` (justificativa) | Busca lojas em código (`catalogo.ts`) e filtra itens elegíveis por pessoa (`regras/elegibilidade.ts`). O modelo só classifica, por desejo de cada pessoa, os itens em "atende", "substituto" ou "não serve". O código (`regras/combinacoes.ts`) enumera todas as combinações de 1 e 2 lojas, escolhe o melhor item por desejo, confere pedido mínimo e escolhe: mais atendidos > menos desejos sem item > menos substitutos > menos lojas > mesma categoria do desejo > total com entrega dentro do orçamento > menor total. Depois cota a taxa de serviço da escolhida e da alternativa (`taxas.ts`, porta `quoteOrder`). O modelo só escreve uma frase objetiva por opção (com os motivos dos substitutos, calculados em código). Devolve também a segunda melhor combinação (`alternative`, botão "Outra opção"). |
| Ajuste | `ajuste.ts` | `fast` | `interpretarAjuste` converte texto em troca estruturada; `ajustar` troca o item da pessoa e recalcula. A pessoa só troca o próprio item. |
| Orçamento | `orcamento.ts` | nenhum | O orçamento cobre itens + parte da entrega + parte da taxa de serviço. Quem passa é perguntado no privado ([Aceito] [Quero outro]); em "Quero outro", o código sugere o item mais próximo que caiba ([Aceito a sugestão] [Fico sem]). Só a própria pessoa responde; quem passar a estourar depois de uma mudança também é perguntado. |
| Fechamento | `fechamento.ts` | nenhum | Exige organizador, endereço confirmado, nenhuma pergunta de orçamento pendente e catálogo consultado há no máximo 60 s; a fachada cota a taxa de serviço de novo (se mudou, recusa e atualiza a proposta); revalida tudo e devolve `AuthorizedOrder`. Em qualquer recusa a sessão continua em `reviewing` (dá para ajustar, voltar para a coleta ou montar de novo). |

## Guardrails do modelo

- Mensagens e dados externos (nomes de loja/item, perguntas) entram **delimitados e escapados** (`<mensagem_usuario>`, `<catalogo>`...); o prompt de sistema manda tratá-los como dados.
- Saída validada com Zod (`schemas.ts`); schemas estritos: campo extra (ex.: preço) reprova. Fora do schema → uma nova tentativa com o erro → fallback (`llm.ts`).
- O modelo só escolhe entre ids permitidos para cada pessoa; escolha fora disso é descartada com motivo.
- Só portas de leitura de catálogo; não existe ferramenta de pedido para o modelo.
- Cada chamada é registrada (fase, nível, tentativa, duração, sucesso, erro fatal) via `registrar`.
- Modelo reserva opcional por nível (`AI_MODEL_FAST_FALLBACK`, `AI_MODEL_CAPABLE_FALLBACK`): um 429 do principal troca na hora para o reserva, e o principal fica de lado pelo tempo pedido pelo provedor.
- Erros do provedor: chave inválida, plano ou cota diária (401, 402, 403, `FreeTierError`, `PerDay`) são **fatais**, sem nova tentativa; 429 de limite por minuto espera (`Retry-After`, `retryDelay`, "try again in") e repete até 3 vezes.

Decisões, provedor escolhido e números medidos (acerto, latência, tokens): [`docs/core-decisoes.md`](../../docs/core-decisoes.md).

## Como o bot usa o core

Sem HTTP: o Telegram importa o core e chama a fachada `criarAgente` (`agente.ts`), no mesmo processo. Ela guarda as sessões (`SessionStore`, em memória por padrão), decide o que fazer com cada mensagem pela fase, processa um chat por vez e transforma erros esperados em `outcome`. API e tabela de outcomes para o bot: [`docs/api-core.md`](../../docs/api-core.md).

## Mapa dos arquivos

| Caminho | Conteúdo |
|---|---|
| `index.ts` | API pública: `criarAgente`, `SessoesEmMemoria`, tipos, fakes e `criarLlmDoAmbiente`. |
| `agente.ts` | Fachada para a interface: iniciar, mensagem, mensagens (lote), confirmarEndereco, pedirOutroEndereco, propor, outraOpcao, responderOrcamento, reabrirColeta, fechar, cancelar, obter. |
| `orcamento.ts` | Perguntas de orçamento: quem passou, respostas, sugestão de item, recotação e efeito em cascata. |
| `taxas.ts` | Cotação da taxa de serviço pela porta e comparação no fechamento. |
| `endereco.ts` | Fluxo do endereço de entrega: padrão ou digitado, validado pela porta do iFood, confirmado só pelo organizador. |
| `agrupador.ts` | `criarAgrupador`: debounce por chat; mensagens quase simultâneas viram um lote (uma chamada ao modelo para até 10 pessoas). |
| `sessoes.ts` | `SessoesEmMemoria` (implementação da `SessionStore`). |
| `contracts.ts` | Tipos compartilhados com o time (ver abaixo). |
| `ports.ts` | `CatalogPort` (sem compra: `validateAddress`, `searchStores`, `getMenu` e `quoteOrder` com endereço), `LlmPort` (níveis `fast`/`capable`) e `SessionStore`. |
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
- `ParticipantPreferences`: `foodPreferences` (gosto e atributos), `wishes` (itens a receber, um por entrada: "um lanche e um bolo" → 2 itens, até 3), `dietaryRestrictions` (restrição dura, de saúde), `avoids` (rejeição de gosto) e `budgetCents` (privado).
- `SessionStatus`: `collecting`, `reviewing`, `awaiting_confirmation`, `closed`, `cancelled`.
- `IncomingMessage`, `CoreAction`.
- Catálogo e proposta: `Store`, `MenuItem` (com `category?`: comida ou bebida), `ProposedItem` (com `isSubstitute?`), `StoreOrder` (com `serviceFeeCents?`: taxa de serviço cotada no iFood), `ParticipantShare` (itens + `deliveryCents` + `serviceCents`), `Split`, `Proposal`.
- Endereço: `DeliveryAddress` (texto normalizado pelo iFood e id opcional); ações `request_address` e `confirm_address` em `CoreAction`.
- Orçamento: ações `budget_question` (pergunta de valor, privada) e `item_suggestion` (sugestão de outro item) em `CoreAction`.
- Fechamento: `OrderAuthorization` e **`AuthorizedOrder`** (com `deliveryAddress`) — fronteira com quem executa o pedido. Guia do módulo iFood: [`docs/integracao-ifood.md`](../../docs/integracao-ifood.md).

Alterações aqui são mínimas e combinadas com o time; consuma com `import type`.

## Configuração do modelo

Provedor principal: **Google Gemini** pelo endpoint compatível com OpenAI (camada gratuita do AI Studio); plano B: **Groq**. Os dois endereços estão comentados no `.env.example`.

Variáveis: `AI_PROVIDER` (`openai-compat` ou vazio/`fake`), `AI_BASE_URL`, `AI_MODEL` (ou `AI_MODEL_FAST` e `AI_MODEL_CAPABLE`) e `AI_API_KEY`. Não há modelo padrão no código: rode `npm run listar:modelos` e copie o id exato. Sem chave, o simulador usa o modelo fake heurístico. Testes nunca chamam rede.

## Como rodar

```bash
npm run check            # lint + tipos (inclui scripts/) + testes
npm run simular          # grupo no terminal: "Pedro: algo leve", /propor, /ajustar, /fechar
npm run avaliar:coleta   # avalia o prompt de coleta no modelo configurado (acerto e latência)
npm run avaliar:coleta -- --intervalo 4000   # ms entre chamadas, para camadas gratuitas
npm run listar:modelos   # GET {AI_BASE_URL}/models: ids exatos para AI_MODEL
```

## Estado: congelamento de funcionalidades

O core está congelado: daqui em diante, só correções de bug e o que a integração com o bot (Telegram) e com o MCP do iFood exigir.

## Pendências e melhorias futuras

- `CatalogPort` real (MCP do iFood) em `src/index.ts`; o Telegram já está ligado e hoje usa o `CatalogoFake`.
- Executor do `AuthorizedOrder` (compra no iFood): o bot já entrega o pedido por `criarBot(token, iris, { aoAutorizar })`; falta quem execute.
- `getStore(storeId)` na `CatalogPort`: proposta em `docs/proposta-catalog-getstore.md`, a combinar com o módulo iFood.
- Sessões só em memória: reiniciar o processo perde os pedidos em andamento.
- Regras de restrição são palavras-chave conservadoras, casadas como palavras inteiras (`mel` não casa "caramelo"; radicais explícitos como `bovin*`); itens sem descrição saem como `uncertain` para confirmar.
- Categoria comida/bebida: quando o catálogo não informa `category`, o core infere pelo nome e pela descrição (só é bebida quando fica claro). O módulo iFood pode preencher `category` a partir da seção do cardápio para ficar exato.
- Melhoria futura: atributos como "barato" às vezes viram item em `wishes` ("tô sem grana, algo barato" → `["algo barato"]`). Não quebra a proposta (a classificação procura itens baratos), mas o ideal é deixar atributos só em `foodPreferences`.
