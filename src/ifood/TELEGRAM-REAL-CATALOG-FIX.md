# Correção do caminho Telegram → catálogo real

Auditoria em 18/10/2026, branch local `codex/if05-real-integration`, sem commit,
merge ou publicação. O índice inicial de 80 arquivos permanece separado.

## Causa e limite da comprovação

O `origin/feat/telegram-bot-ts` atualizado, em
`c70ac39916b09bc6018e1cc631b1fd37d1b732c5`, continua compondo
`criarAgente({ catalog: new CatalogoFake(), ... })` em `src/telegram-ts/iris.ts`.
A renderização dessa branch envia JSON bruto e seu `/montar` oferece o botão
“Confirmar pedido”, ligado ao fluxo antigo de fechamento do Core. Os IDs e os
valores relatados coincidem com `core/fakes/catalogo-fake.ts`. Isso identifica o
pipeline antigo de catálogo cotado que produziu a resposta relatada.

No worktree de integração inspecionado, `iris.ts` já criava o adaptador IF-05
real. Sua proposta preliminar não possui os totais/fretes do JSON relatado.
Nenhum processo de bot foi encontrado ativo na auditoria, inclusive entre os
processos Node do projeto. Portanto não há PID/comando histórico para provar
se o teste anterior usou outro checkout ou um processo carregado antes do patch.
Não afirmar que reconstruímos esse diretório. Reiniciar com entrada absoluta e
conferir a fonte na inicialização remove essa ambiguidade na próxima execução.

## Composição e defesa contra regressão

- `iniciarBot` autentica Telegram, recusa assumir webhook ativo e chama
  `iniciarIris`. Essa composição cria um único cliente MCP, descobre ferramentas
  e injeta `createIfoodDiscoveryCatalog` no Core. Não cria carrinhos.
- `iniciarIris` exige `AI_PROVIDER=openai-compat` com chave; configuração fake ou
  ausente falha antes de criar o cliente. Modelos/prompts da equipe preservados.
- Após conectar, a inicialização informa apenas fontes seguras:
  `FoodJam fontes: catalog=ifood-mcp llm=groq modo=preliminar`.
- `diagnosticoIris` contém fontes, status HTTP e nomes/êxito de leituras. Não
  contém prompts, argumentos, endereços, URLs, tokens ou identificadores de conta.
- O retorno de `iniciarIris` permite ao preflight usar o mesmo catálogo/LLM da
  composição, sem montar outro transporte. Fechamento permanece explícito.
- O antigo `handlers.ts` passou a delegar a `handlers/index.ts`; não há uma
  segunda implementação legada enviando JSON no mesmo diretório.
- `/montar` é compatível com `/finalizar`. A proposta é legível, sem IDs internos,
  e seu botão é “Revisar proposta preliminar”, vinculado à proposta/organizador.
  O callback antigo `proposta:confirmar` explica que não confirma pedidos.
- Falha de MCP/OAuth/catálogo, endereço ou IA não ativa simulação. A UI mantém
  preços/estoque/frete desconhecidos explicitamente pendentes.

## Três mensagens não significam três pessoas atendidas

A coleta do Core adiciona/atualiza uma pessoa quando a saída validada tem
`kind: preference`. Mensagens ambíguas, irrelevantes, perguntas, textos filtrados
ou falhas de modelo podem não incluir uma nova pessoa na sessão. O organizador
já existe na sessão mesmo antes de ter uma preferência reconhecida.

A fachada agora conserva, por pessoa, mensagem analisada, outcome de coleta,
nome de exibição e inclusão efetiva no Core. O Telegram apresenta esse resumo,
as perguntas privadas e a cobertura real de itens. Alguém sem interpretação não
é anunciado como atendido; alguém reconhecido sem opção aparece “sem item”.
A proposta parcial informa sua cobertura, por exemplo duas de três pessoas.

Não temos os três updates/resultados do teste ao vivo anterior para identificar
qual desses motivos ocorreu para a terceira pessoa. A causa individual precisa
ser observada no resumo do novo ensaio; não presumir Privacy Mode ou ambiguidade.

## Teste da composição de produção

`tests/telegram/production-composition.test.ts` chama a própria `iniciarBot`,
registra os handlers reais, usa `iris` real, a fábrica IF-05 e o adaptador HTTP
do modelo. Somente transportes Telegram, MCP e HTTP são controlados.

Construtores de CatalogoFake/FakeLlm e a heurística lançam erro se usados.
IDs MCP são gerados no teste e atravessam o adaptador até a proposta; a resposta
HTTP controlada do modelo classifica esses IDs. O teste verifica restaurantes e
produtos correspondentes, ausência de IDs/JSON comerciais no grupo, duas formas
de terceira pessoa sem atendimento (ambígua ou reconhecida sem item), autorização
do organizador e ausência de chamadas comerciais ao clicar nos botões.

Essas respostas controladas são testes, não evidência de IA ou catálogo remotos.

## Preflight real desta rodada

Foram executadas duas conexões sequenciais, com encerramento de cada uma:

1. Mesma composição: OAuth iFood concluído, endereço previamente confirmado
   reencontrado e três preferências de demonstração enviadas ao Groq. Uma única
   requisição HTTP retornou **429**; resultado `model_failed`, sem proposta.
   Nenhuma tentativa automática de IA foi feita depois desse limite.
2. Leitura independente de catálogo pela mesma fábrica/porta, sem chamar IA:
   dez restaurantes, oito informados como abertos; uma loja revalidada e dez
   produtos retornados, todos com associação correspondente ao estabelecimento.
   Cobertura `offers_only`, primeira página truncada. A demo do Core usa até seis
   ofertas dessa amostra. Zero produtos com preço/estoque confirmados pelo perfil
   atual: isso significa informação desconhecida, não preço zero ou indisponível.

Ferramentas reais: `listTools`, `listAddresses`, `searchOffers`, `getMerchant`,
`browseOffers`. Foram 12 execuções de leitura incluindo as duas descobertas;
nenhuma escrita comercial, `createCart`, pagamento ou `submitOrder`.

Os relatórios sanitizados estão apenas no diretório privado local:
`telegram-real-preflight-1792296528702.json` e
`telegram-catalog-read-after-429-1792296680619.json`.
As três preferências do preflight são artificiais e identificadas como tal;
não são as mensagens dos integrantes do grupo. Catálogo MCP remoto real.

Não foi possível distinguir RPM/TPM/cota diária apenas pelo status preservado.
Sem informação oficial de liberação neste relatório, não repetir chamadas de IA
em sequência. O teste ponta a ponta com nova proposta real depende da liberação
do Groq; o catálogo e a ausência de fallback foram comprovados separadamente.

Validação local: `npm run check` (lint, typecheck, **1.198 testes/56 arquivos**),
`npm run build`, `git diff --check` e `git diff --cached --check` passaram.

## Reinício e roteiro

Encerre o polling anterior com Ctrl+C no terminal em que foi iniciado. Não
encerrar processos Node genéricos do computador. Use a entrada absoluta:

```bash
cd /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam
node --env-file="$HOME/.local/share/foodjam-validation/telegram-demo.env" \
  --import tsx /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam/src/telegram-ts/bot.ts \
  --env /Users/andrei/FoodJam/.env
```

Token Telegram permanece no primeiro arquivo; MCP/Groq no segundo. Não copiar
segredos nem cadastrar IDs. Conferir `catalog=ifood-mcp llm=groq` no terminal.

Após o Groq liberar chamadas: cada pessoa abre `/start` no privado; organizador
usa `/iniciar` no grupo e confirma endereço no privado; as três pessoas respondem
à mensagem do bot com preferências e conferem o recebimento; organizador usa
`/montar`. Conferir o resumo de coleta e a cobertura antes de revisar. Se houver
falha real, não aceitar catálogo de exemplo como demonstração. Revisar a proposta
não fecha compras; carrinho e valores comerciais continuam em etapa separada.

## Arquivos desta correção

- `src/telegram-ts/iris.ts`: composição, guarda de IA real, fontes e diagnóstico seguro.
- `src/core/discovery-agent.ts`: resultados individuais da coleta e cobertura parcial.
- `src/telegram-ts/handlers.ts`: delegação do export legado ao registro ativo.
- `src/telegram-ts/handlers/index.ts`, `montar.ts`, `finalizar.ts`: comando/registro e lote.
- `src/telegram-ts/handlers/iniciar.ts`: erro de consulta real separado de outra sessão.
- `src/telegram-ts/handlers/state.ts`, `proposta.ts`: rotas de revisão, organizador e bloqueio de teclado antigo.
- `src/telegram-ts/services/apresentacao.ts`: nomes legíveis, diagnóstico da coleta, cobertura e botão preliminar.
- `tests/telegram/production-composition.test.ts`, `runtime.test.ts`: composição completa e ausência de fallback.
- `src/ifood/TELEGRAM-DEMO.md` e este relatório: comando e evidências atualizados.

Nenhum contrato compartilhado, prompt, regra financeira, módulo de checkout ou
configuração de credenciais foi alterado nesta correção.
