# Core (Íris): decisões e medições

Registro do que foi decidido no core, por quê, e o que foi medido. Base para o documento técnico e para a apresentação. Detalhes de uso: [`src/core/README.md`](../src/core/README.md) e [`docs/api-core.md`](api-core.md).

## Arquitetura do agente

- **Máquina de estados em código, não um ReAct livre.** Fases: coleta → proposta → confirmação → fechada (ou cancelada). Transições inválidas lançam erro; só o organizador confirma, fecha ou cancela; fechar é idempotente.
- **O modelo nunca calcula valores nem autoriza compra.** Preços vêm do catálogo; subtotais, entrega, rateio, pedido mínimo e orçamento são código. O rateio soma exatamente o total, centavo a centavo.
- **Chamadas pequenas por fase**, com saída estruturada validada por Zod (uma nova tentativa, depois fallback):

| Fase | Nível | O que o modelo faz | O que o código faz |
|---|---|---|---|
| Coleta | fast | Classifica a mensagem e extrai gosto, itens desejados, restrições, rejeições e o trecho do orçamento | Filtro barato antes do modelo, converte orçamento em centavos, atualiza só a pessoa que escreveu |
| Coleta em lote | fast | O mesmo para até 10 pessoas numa chamada | Debounce por chat (`criarAgrupador`), schema montado com os ids do lote |
| Proposta | capable | Só o casamento semântico: por desejo, itens que "atendem", "substitutos" ou "não servem" | Busca lojas, filtra itens elegíveis, enumera combinações de 1 e 2 lojas, escolhe itens, valida mínimo e orçamento, calcula rateio |
| Justificativa | fast | Duas frases sobre a opção escolhida | Texto padrão se falhar |
| Ajuste | fast | Aponta qual item a pessoa quer | Valida e recalcula |
| Fechamento | — | Nada | Revalida tudo com catálogo de até 60 s e devolve o `AuthorizedOrder` |

- **Critério de escolha da proposta:** mais pessoas atendidas com o que pediram > menos desejos sem item > menos substitutos > menos lojas > substituto da mesma categoria do desejo > mais pessoas com o total (itens + entrega) dentro do orçamento > menor total. O critério "menos desejos sem item" impede que deixar alguém sem nada vença dar um substituto.
- **Orçamento vale para a soma dos itens:** "até 30 reais" limita a soma dos itens da pessoa (é como o iFood mostra os preços): o filtro de itens e a validação usam essa soma. A parte da entrega aparece no rateio, mas não tira ninguém do pedido; ela só entra no desempate. Exemplo: X-Salada (R$ 25,90) sozinho na hamburgueria com "até 30 reais" fica no pedido, mesmo pagando R$ 33,89 com a entrega; um item de R$ 31 continua barrado.

## Guardrails

- Mensagens e dados externos (nomes de loja e item, perguntas) entram **delimitados e escapados**; o prompt de sistema os trata como dados. Testado com tentativas de fechar a tag e "ignore as instruções".
- **Orçamento é privado:** nunca entra em prompt nem em mensagem de erro. Preços e pedido mínimo das lojas são públicos e podem ir ao modelo.
- O modelo só escolhe entre ids **elegíveis daquela pessoa** (restrições, rejeições, loja aberta, disponível, preço unitário dentro do orçamento); qualquer outro id é descartado com motivo.
- Restrições são palavras-chave conservadoras casadas como **palavras inteiras** ("mel" não casa "caramelo"); item sem descrição para quem tem restrição sai como "a confirmar".
- **Bebida nunca substitui comida:** o código remove bebidas das opções de qualquer desejo de comida, independentemente do modelo. A categoria vem do catálogo (`MenuItem.category`) ou é inferida de forma conservadora pelo nome; no desempate, substituto da mesma categoria do desejo vence.
- Não existe ferramenta de pedido para o modelo. O core não executa a compra: entrega o `AuthorizedOrder` depois da confirmação do organizador.

## Provedor de IA

Adaptador único compatível com OpenAI (`/chat/completions` via `fetch`, sem SDK), escolhido por `.env`. Testamos três caminhos:

| Provedor | Resultado |
|---|---|
| OpenCode Zen (gratuito) | Os 9 modelos `-free` respondem HTTP 403 `FreeTierError`: o plano gratuito só funciona dentro do app OpenCode. Descartado (sem crédito pago). |
| Google Gemini (AI Studio, gratuito) | Qualidade boa (11/13 antes de parar), mas a camada gratuita tem **5 requisições/min e 20/dia por modelo**: não sustenta testes nem a demo. |
| **Groq (gratuito) — escolhido** | **1.000 requisições/dia e 8.000 tokens/min por modelo**, com cota **separada por modelo**. |

Modelos na Groq:

| Nível | Principal | Reserva (em 429) |
|---|---|---|
| fast | `qwen/qwen3.8-27b` | `openai/gpt-oss-20b` |
| capable | `openai/gpt-oss-120b` | — |

Tratamento de erros: chave, plano ou cota diária são **fatais** (sem nova tentativa); 429 por minuto e 502/503/504 **esperam** o tempo pedido pelo provedor e repetem; com modelo reserva configurado, um 429 do principal troca para o reserva na hora.

## Medições

### Coleta (casos da avaliação: gírias, restrições, orçamento, perguntas, prompt injection)

| Configuração | Acerto | Latência média / p95 | Tokens de entrada por chamada |
|---|---|---|---|
| Gemini 3.5 flash | 11/13 (parou na cota) | ~2.600 / ~4.900 ms | — |
| gpt-oss-20b, prompt completo | 18/18 | 687 / 1.029 ms | ~1.170 |
| gpt-oss-20b, prompt enxuto | 18/18 | 669 / 1.068 ms | 746 |
| qwen3.8-27b, prompt enxuto | 18/18 | 441 / 615 ms | 425 |
| qwen3.8-27b, com itens desejados (`wishes`) | 17/19* | 538 / 1.085 ms | 495 |

\* As duas diferenças foram o modelo guardar o item pedido só em `wishes` (e não também em `foodPreferences`); o critério passou a aceitar os dois campos, ainda sem nova rodada.

Prompt enxuto: regras do sistema reescritas de forma compacta e o JSON Schema não é repetido no prompt quando o provedor aceita `json_schema` (−36% de tokens de entrada no 20b). `reasoning_effort` é configurável e está desligado por padrão.

### Lote (10 pessoas mandando mensagem quase juntas)

| | Chamadas | Tokens | Tempo |
|---|---|---|---|
| Uma chamada por mensagem (qwen) | 10 | ~5.000 | — |
| **Lote** | **1** | **1.530** | **2,1 s** |

As 10 interpretações saíram certas, incluindo pessoa com dois itens, orçamento, pergunta e tentativa de injeção.

### Proposta (grupo de teste: hambúrguer; lanche + bolo de cenoura; algo leve vegetariano sem japonês)

| Desenho | Resultado | Tokens | Tempo |
|---|---|---|---|
| Modelo escolhe itens e lojas | Evitou lojas com pedido mínimo e deu substitutos a quem não precisava | ~4.100 | 5,3–5,6 s |
| **Modelo classifica, código combina** | Bia com lanche e bolo na padaria, Caio no Bowl de Quinoa, Ana com o melhor substituto (hambúrguer exigiria 3ª loja); 10 combinações avaliadas | **3.238** | **3,7 s** |

## Evolução futura: confirmação de valor por botão

Para implementar **se sobrar tempo depois da integração** (exige mudança no contrato, na fachada e no bot). Hoje o orçamento vale para a soma dos itens e a entrega nunca tira ninguém; este desenho cobre o caso em que o total com entrega passa do que a pessoa disse.

- **Tolerância em código:** até R$ 2,00 acima do orçamento (itens + parte da entrega) passa sem perguntar; constante fácil de ajustar.
- **Acima da tolerância, perguntar em vez de decidir:** mensagem **privada** para a pessoa: "Seu pedido sai por R$ 33,89 (com entrega). Pode ser?", com os botões **[Pode]** e **[Prefiro algo mais barato]**.
  - **Pode:** segue com o item.
  - **Mais barato:** o código tenta o item mais barato que caiba; se não houver, a pessoa fica sem item.
- **Fechamento bloqueado:** o organizador não fecha enquanto houver confirmação pendente; o bot mostra "aguardando Ana confirmar o valor".
- **Confirmação vale para uma proposta só:** qualquer mudança (ajuste, "Outra opção", nova proposta) invalida as confirmações; o código pergunta de novo se ainda precisar.
- **Preferir quem cabe:** entre combinações equivalentes, a que exige menos confirmações vence (já parcialmente coberto pelo desempate atual).
- **Privacidade:** o valor só vai no privado. Se o bot não conseguir mandar DM (a pessoa nunca falou com ele), responde no grupo sem valor: "@Ana, confirme o valor do seu pedido no privado".
- **O que mudaria:** uma nova `CoreAction` (ex.: `ask_budget_confirmation` com pessoa, proposta e valor), um método na fachada para registrar a resposta (`confirmarValor(sessionId, participantId, aceita)`), o registro das confirmações na sessão e os botões no bot.

## Estado

Congelamento de funcionalidades: só correções de bug e o que a integração com o bot e com o MCP exigir.

## Pendências

- ~~`ajustar` com vários itens~~: resolvido; troca só o item citado e pergunta quando não dá para saber qual.
- ~~Confirmar 19/19 na coleta com o critério novo~~: confirmado (qwen, 19/19).
- Testar `reasoning_effort=low` na proposta, comparando qualidade e tokens.
- `CatalogPort.getStore(storeId)`: ver [`proposta-catalog-getstore.md`](proposta-catalog-getstore.md).
- Sessões só em memória: reiniciar o processo perde pedidos em andamento.
