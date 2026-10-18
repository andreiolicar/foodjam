# Arquitetura do foodjam

## Estado atual

O fluxo Telegram → core funciona de ponta a ponta: o bot (grammY) traduz o Telegram para chamadas ao agente do core (a Íris), que controla sessões, coleta, proposta, rateio, orçamento e fechamento. O core fala com o catálogo e com o modelo de IA por portas próprias; nesta versão, o catálogo é o fake (`CatalogoFake`) e o modelo é qualquer API compatível com OpenAI (ou o fake, sem chave). O cliente MCP do iFood está em `feat/ifood-mcp`; ligá-lo à porta de catálogo é o próximo passo. Não há executor de compra: o core entrega o pedido autorizado e não compra nada.

## Fluxo

```text
Telegram → Core / Agente IA → Integração MCP → iFood
Telegram ← Core / Agente IA ← Integração MCP ← iFood
```

1. **Telegram (`src/telegram/`)** traduz mensagens, menções, comandos e cliques para chamadas à fachada do core e apresenta as `actions` que ela devolve (mensagens no grupo ou no privado, botões, card da proposta, resumo do pedido). Não decide regras de negócio: quem pode clicar, valores e fases são do core. Detalhes em [api-core.md](api-core.md).
2. **Core (`src/core/`)** controla as regras de negócio, sessões, participantes, preferências, orçamento e autorização. A integração com o modelo de IA e as portas de catálogo ficam sob seu controle.
3. **Integração MCP (`src/ifood/`)** concentra autenticação, transporte, descoberta e execução das ferramentas do iFood, e implementará a `CatalogPort` do core.
4. **iFood** é o sistema externo acessado pelo MCP.

## Dependências e limites

- `src/index.ts` é o ponto único de composição: carrega o `.env`, monta o agente (catálogo, modelo, endereço padrão) e o bot, e inicia o polling. Sem `TELEGRAM_BOT_TOKEN`, só confirma a inicialização e encerra.
- Telegram consome a API pública do core (`src/core/index.ts`). Não importa a integração iFood diretamente nem decide regras comerciais.
- O core não importa grammY, `src/telegram` nem `src/ifood`, e não configura transporte MCP. Ele define portas no vocabulário do domínio (`CatalogPort`, `LlmPort`, `SessionStore`) e não presume nomes de ferramentas do MCP.
- O adaptador iFood não controla conversas, orçamento, rateio ou autorização de compra. Importar qualquer módulo não abre conexões nem inicia processos.
- Sessões ficam em memória (`SessoesEmMemoria`); reiniciar o processo perde os pedidos em andamento. A porta `SessionStore` permite trocar por persistência sem mudar o agente.

## Contratos

`src/core/contracts.ts` contém sessão, participante e preferências, mensagens de entrada, ações de saída para a interface (`CoreAction`), loja e item de catálogo, proposta (`Proposal`, com pedidos por loja e rateio) e o pedido autorizado (`AuthorizedOrder`), que é a fronteira com quem executar a compra. São compartilhados entre os módulos: alterações devem ser mínimas e combinadas com a equipe.

Identificadores são strings opacas para o core; no Telegram, `sessionId` é o id do chat e `participantId` é o id do usuário.

Todos os valores monetários são **centavos inteiros de BRL** (`MoneyCents`). Por exemplo, R$ 25,90 corresponde a `2590`. O core valida inteiros seguros e não negativos nas fronteiras e nunca calcula dinheiro em ponto flutuante; o bot só formata valores que o core calculou.

## IA, finanças e autorização

O modelo interpreta linguagem natural (preferências, ajustes) e classifica itens do cardápio; o core valida tudo o que vem dele com Zod. O modelo **não calcula valores, rateio nem autoriza a compra**: elegibilidade, combinações, rateio e orçamento são funções determinísticas, verificadas por testes.

O fechamento exige a autorização explícita do organizador (botão "Confirmar pedido"), validada pelo core para a sessão e a proposta em questão; no clique, o core reconsulta as lojas e recota a taxa de serviço. Texto gerado pelo modelo ou conteúdo recebido de ferramentas não constitui autorização. O fechamento é idempotente: repetir devolve o mesmo pedido.

## Integrações e configuração

O endpoint do MCP é `https://consumer-mcp.ifood.com.br/marketplace`. O cliente MCP (SDK v1, OAuth) está em `feat/ifood-mcp`; as variáveis de autenticação do iFood serão definidas por esse módulo.

O modelo de IA é acessado por um cliente HTTP enxuto (`fetch`), compatível com a API da OpenAI, configurado por `AI_*` no `.env` (com modelos por nível e de reserva). Escolhas e medições em [core-decisoes.md](core-decisoes.md).
