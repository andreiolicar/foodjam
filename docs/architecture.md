# Arquitetura do foodjam

## Estado atual

O fluxo preliminar em produção é Telegram grammY → Core → Groq real → catálogo MCP real do iFood → card da proposta. A composição exige os serviços reais e não usa fallback para `CatalogoFake` ou `FakeLlm`; os fakes permanecem nos testes e simuladores explícitos. O ensaio IF-06 atendeu duas pessoas em uma loja, com preços unitários do catálogo. Disponibilidade, frete, taxas, descontos, total e orçamento final continuam pendentes da etapa comercial. Veja [o registro e os limites da IF-06](../src/ifood/IF-06.md).

## Fluxo

```text
Telegram → Core / Agente IA → Integração MCP → iFood
Telegram ← Core / Agente IA ← Integração MCP ← iFood
```

1. **Telegram (`src/telegram/`)** traduz mensagens, menções, comandos e cliques para chamadas à fachada do core e apresenta as `actions` que ela devolve (mensagens no grupo ou no privado, botões, card da proposta, resumo do pedido). Não decide regras de negócio: quem pode clicar, valores e fases são do core. Detalhes em [api-core.md](api-core.md).
2. **Core (`src/core/`)** controla as regras de negócio, sessões, participantes, preferências, orçamento e autorização. A integração com o modelo de IA e as portas de catálogo ficam sob seu controle.
3. **Integração MCP (`src/ifood/`)** concentra autenticação, transporte, descoberta e ferramentas do iFood. O adaptador real atende a `DiscoveryCatalogPort`, que permite representar informações comerciais desconhecidas; a `CatalogPort` cotada permanece separada.
4. **iFood** é o sistema externo acessado pelo MCP.

## Dependências e limites

- `src/index.ts` é a entrada única: carrega o ambiente local, usa `criarAplicacaoReal` de `src/app.ts` e inicia o polling. Uma conexão MCP autenticada é compartilhada durante a execução e encerrada de forma controlada. Sem `TELEGRAM_BOT_TOKEN`, só confirma a inicialização e encerra. O endereço salvo da conta iFood é confirmado pelo organizador no grupo; confirmações individuais de orçamento permanecem privadas.
- Telegram consome a API pública do core (`src/core/index.ts`). Não importa a integração iFood diretamente nem decide regras comerciais.
- O core não importa grammY, `src/telegram` nem `src/ifood`, e não configura transporte MCP. Ele define portas no vocabulário do domínio (`CatalogPort`, `LlmPort`, `SessionStore`) e não presume nomes de ferramentas do MCP.
- O adaptador iFood não controla conversas, orçamento, rateio ou autorização de compra. Importar qualquer módulo não abre conexões nem inicia processos.
- Sessões ficam em memória (`SessoesEmMemoria`); reiniciar o processo perde os pedidos em andamento. A porta `SessionStore` permite trocar por persistência sem mudar o agente.

## Contratos

`src/core/contracts.ts` contém sessão, participante e preferências, mensagens de entrada, ações de saída para a interface (`CoreAction`), loja e item de catálogo, proposta (`Proposal`, com pedidos por loja e rateio) e o pedido autorizado (`AuthorizedOrder`), que é a fronteira com quem executar a compra. São compartilhados entre os módulos: alterações devem ser mínimas e combinadas com a equipe.

A produção preliminar utiliza `PreliminaryProposal`, `DiscoveryStore` e `DiscoveryItem`. Preço, frete ou disponibilidade ausentes não viram zero ou verdadeiro. Essa proposta não é cotação final nem autorização de compra.

Identificadores são strings opacas para o core; no Telegram, `sessionId` é o id do chat e `participantId` é o id do usuário.

Todos os valores monetários são **centavos inteiros de BRL** (`MoneyCents`). Por exemplo, R$ 25,90 corresponde a `2590`. O core valida inteiros seguros e não negativos nas fronteiras e nunca calcula dinheiro em ponto flutuante; o bot só formata valores que o core calculou.

## IA, finanças e autorização

O modelo interpreta linguagem natural (preferências, ajustes) e classifica itens do cardápio; o core valida tudo o que vem dele com Zod. O modelo **não calcula valores, rateio nem autoriza a compra**: elegibilidade, combinações, rateio e orçamento são funções determinísticas, verificadas por testes.

Na composição ativa, o botão é "Revisar proposta preliminar". O fechamento comercial está bloqueado, inclusive por callbacks antigos de confirmação. Criar carrinhos, cadastrar endereços e configurar pagamento não são habilitados; `submitOrder` não é permitido. Uma futura preparação exige autorização específica, vínculo à proposta/carrinho/endereço, valores atuais e os aceites necessários. O fluxo cotado original e seus testes permanecem preservados, mas `AuthorizedOrder` sozinho não autoriza uma compra no MCP.

## Integrações e configuração

O endpoint do MCP é `https://consumer-mcp.ifood.com.br/marketplace`. O cliente em `src/ifood/` reutiliza o SDK MCP e OAuth interativo local, com tokens em memória. As credenciais são lidas de arquivos privados fora do Git; inicialização e autenticação estão descritas no [guia iFood](../src/ifood/README.md).

A composição real reutiliza `criarLlmDoAmbiente` e `LlmEmCascata`: Groq principal, Gemini e OpenRouter como reservas configuráveis. Os modelos por tier permanecem no ambiente; o modo `json_object` do Groq 120B é preservado. O observador registra somente diagnósticos sanitizados. Não existe modelo fake de reserva na demonstração. Comando e restrição de uma única instância de polling: [handoff grammY](../src/ifood/GRAMMY-INTEGRATION.md).
