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
| Proposta | capable | Só o casamento semântico: por desejo, itens que "atendem", "substitutos" ou "não servem" | Busca lojas, filtra itens elegíveis, enumera combinações de 1 e 2 lojas, escolhe itens, valida mínimo, calcula rateio, cota a taxa de serviço |
| Justificativa | fast | Duas frases sobre a opção escolhida | Texto padrão se falhar |
| Ajuste | fast | Aponta qual item a pessoa quer | Valida e recalcula |
| Orçamento | — | Nada | Pergunta a quem passou, sugere outro item, recota a taxa |
| Fechamento | — | Nada | Bloqueia com pergunta pendente, recota a taxa, revalida tudo com catálogo de até 60 s e devolve o `AuthorizedOrder` |

- **Critério de escolha da proposta:** mais pessoas atendidas com o que pediram > menos desejos sem item > menos substitutos > menos lojas > substituto da mesma categoria do desejo > mais pessoas com o total (itens + entrega) dentro do orçamento > menor total. O critério "menos desejos sem item" impede que deixar alguém sem nada vença dar um substituto.
- **Orçamento cobre itens + entrega + taxa de serviço** (mudança decidida pelo time, substitui "orçamento vale para a soma dos itens"). "Até 30 reais" é o que a pessoa paga: itens + parte da entrega + parte da taxa de serviço, as duas divididas igualmente entre quem pediu na loja.
  - **Taxa de serviço vem do iFood** (`CatalogPort.quoteOrder`): só o MCP sabe calculá-la. Para poupar chamadas, o core escolhe a proposta e a alternativa por itens + entrega e só depois cota as duas (2 a 4 chamadas). Se a cotação falhar, a proposta sai sem a taxa e o grupo é avisado.
  - **Passou do orçamento, de qualquer valor: pergunta no privado** ([Aceito] [Quero outro]). Em "Quero outro", o código sugere o item mais próximo do pedido que caiba ([Aceito a sugestão] [Fico sem]). O item nunca sai sozinho: a pessoa decide. Só ela responde.
  - **Fechamento bloqueado** até todos responderem. No fechamento a taxa é cotada de novo; se mudou, o fechamento é recusado e a proposta atualizada.
  - **Respostas zeradas** quando a proposta muda (ajuste do grupo, outra opção, endereço, proposta nova). Mudanças vindas das próprias respostas mantêm as outras, e quem passar a estourar por elas (efeito em cascata) é perguntado.
  - **Item com preço acima do orçamento continua barrado** na elegibilidade: um item de R$ 31 nunca é oferecido a quem disse "até 30 reais".
  - **Privacidade:** valores só no privado; no grupo, só os nomes de quem falta responder.
- **Endereço de entrega:** o iFood busca lojas e cardápios por endereço, então todo pedido exige endereço **confirmado pelo organizador**. Ao iniciar, o core oferece o endereço padrão ([Sim] [Outro endereço]) ou pede que o organizador digite no privado; o texto é validado pela porta do iFood (`validateAddress`: normalizado ou motivo do erro) e confirmado com [Confirmar] [Corrigir]. Enquanto espera o endereço, a mensagem do organizador vai para a validação, nunca para a coleta. A coleta não espera; propor e fechar exigem endereço; trocar o endereço descarta a proposta. O modelo não participa. Guia do módulo iFood: `docs/integracao-ifood.md`.

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

## Estado

Congelamento de funcionalidades: só correções de bug e o que a integração com o bot e com o MCP exigir.

## Pendências

- ~~`ajustar` com vários itens~~: resolvido; troca só o item citado e pergunta quando não dá para saber qual.
- ~~Confirmar 19/19 na coleta com o critério novo~~: confirmado (qwen, 19/19).
- Testar `reasoning_effort=low` na proposta, comparando qualidade e tokens.
- `CatalogPort.getStore(storeId)`: ver [`proposta-catalog-getstore.md`](proposta-catalog-getstore.md).
- Sessões só em memória: reiniciar o processo perde pedidos em andamento.
