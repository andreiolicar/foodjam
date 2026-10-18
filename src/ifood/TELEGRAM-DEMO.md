# Demo Telegram → Core → IA real → MCP iFood

Patch local para revisão do responsável pelo Telegram. Referência consultada:
`origin/feat/telegram-bot-ts` em `563f8009ae22aa38b188780cbd395b2e3d6758ad`.
Os 14 arquivos de `src/telegram-ts/` foram trazidos dessa referência, sem merge.
A branch remota e o checkout `feat/ifood-mcp` não foram alterados. A auditoria
posterior consultou também `c70ac39`, que ainda compõe catálogo fake; veja
[TELEGRAM-REAL-CATALOG-FIX.md](TELEGRAM-REAL-CATALOG-FIX.md) para evidências,
correções, estados da coleta e o bloqueio atual HTTP 429 do Groq.

## Escopo e arquitetura

- Mesma arquitetura Telegraf, registro de handlers, collector e comandos
  `/iniciar`, `/montar` (alias `/finalizar`), `/cancelar`. O export legado
  `handlers.ts` delega ao mesmo registro ativo, sem renderização JSON paralela.
- `iris.ts` compõe `criarLlmDoAmbiente` e `createIfoodDiscoveryCatalog`, usando
  uma única instância de `createIfoodMcpClient`. Conecta e descobre ferramentas
  uma vez por processo, antes do polling, sem autenticar ao importar módulos.
- `criarAgenteDescoberta`, no Core, coordena suas funções existentes de sessão,
  endereço, coleta em lote e proposta preliminar. Não modifica prompts/modelos,
  regras de seleção ou a fachada comercial existente. As operações por sessão
  são serializadas. Não há adaptação fictícia para uma CatalogPort já cotada.
- O fluxo principal exige MCP e modelo reais. Falhas de configuração, OAuth,
  catálogo ou IA não ativam catálogo fake nem FakeLlm.
- O primeiro `/iniciar` recebido em grupo/supergrupo identifica `ctx.chat.id`
  e fixa esse grupo durante o processo. Quem inicia torna-se organizador pelo
  `ctx.from.id`; cada integrante é associado ao próprio ID ao enviar preferências.
  Aceita os três integrantes, sem lista de IDs no `.env`. Bots e canais são
  ignorados; outro grupo não entra na sessão. Só o organizador confirma endereço,
  solicita proposta e cancela. Após cancelar, uma nova sessão no mesmo grupo
  pode ter outro organizador; reiniciar o processo libera a escolha do grupo.
- Endereço salvo é lido de `listAddresses`, exibido somente no privado e
  confirmado com botão opaco associado a grupo, organizador e candidato exato.
  O botão é consumido antes de aguardar rede; a conferência do candidato acontece
  dentro da fila do Core. Teclados antigos não confirmam outro registro.
- O bot mantém a coleta e a sessão após a proposta. Mensagens recebidas durante
  consultas ficam para a revisão seguinte. Falha de transporte antes de persistir
  a coleta restaura o lote, incluindo mensagens novas.
- SIGINT/SIGTERM durante a demo param polling e fecham o cliente MCP. Tokens e
  sessões são locais em memória; reiniciar exige nova seleção/confirmação.

## Arquivos para revisão

| Área | Mudança |
| --- | --- |
| `src/telegram-ts/bot.ts`, `config.ts`, `iris.ts` | Entrada explícita, composição real, grupo/usuários pelos eventos, conexão única e encerramento |
| `handlers/iniciar.ts`, `endereco.ts`, `finalizar.ts` | Endereço privado, lote do Core, proposta preliminar revisável |
| `handlers/state.ts`, `cancelar.ts`, `mensagens.ts`, `collector.ts` | Vínculo de callbacks, invalidação, nome de exibição e remoção de logs privados |
| `services/apresentacao.ts` | Texto legível no grupo; endereço e mensagens individuais no privado |
| `handlers/index.ts`, `handlers/proposta.ts` | Registro preservado, revisão preliminar com autorização do organizador |
| `handlers/collector.ts` | Preservado integralmente da referência |
| `handlers.ts` legado | Delega ao registro ativo; remove caminho duplicado com JSON bruto |
| `src/core/discovery-agent.ts`, `src/core/index.ts` | Fachada aditiva, reutilizando funções públicas existentes |
| `src/ifood/discovery.ts` | Opção explícita de busca parcial, desativada por padrão; demo limita uma página |
| `package.json`, `package-lock.json`, `eslint.config.js` | Telegraf 4.16.3 do bot do responsável, comando e estilo de aspas preservado |

`src/index.ts`, `src/telegram/`, contratos públicos e prompts não são alterados
neste patch. O checkout contém alterações de contratos anteriores da integração;
o índice inicial de 80 arquivos foi preservado separadamente.

## Configuração local e comando

As credenciais permanecem separadas, sem copiar valores entre arquivos:

- `$HOME/.local/share/foodjam-validation/telegram-demo.env`: `TELEGRAM_BOT_TOKEN`.
- `/Users/andrei/FoodJam/.env`: MCP iFood e IA do Core/Groq.

**Nenhum ID de grupo, organizador ou participante precisa ser configurado.**
As variáveis `TELEGRAM_DEMO_*` do roteiro anterior não são mais usadas. O Node
carrega primeiro o arquivo do Telegram; o dotenv da entrada carrega depois o
arquivo MCP/IA sem sobrescrever o token já carregado. Não copiar chaves para
relatórios ou chat. O token não é impresso.

A entrada faz `getMe` e `getWebhookInfo` antes de OAuth/polling. Um webhook ativo
bloqueia a demo; ela não o remove para assumir o bot de outro processo. Alinhe
com o responsável e encerre outra instância de polling para o mesmo token.

No Mac, com Node compatível e dependências instaladas (`npm ci` em um checkout
normal; o worktree atual já tem as dependências locais):

```bash
cd /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam
node --env-file="$HOME/.local/share/foodjam-validation/telegram-demo.env" \
  --import tsx /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam/src/telegram-ts/bot.ts \
  --env /Users/andrei/FoodJam/.env
```

`npm run dev` e a importação da API não iniciam o bot automaticamente.
Não definir `IFOOD_CATALOG_MONEY_UNIT` por suposição: sem unidade comprovada,
o preço permanece desconhecido em vez de ser inferido pela magnitude.

## Privacy Mode e comprovação de recebimento

A documentação oficial do [Telegram](https://core.telegram.org/bots/features#privacy-mode)
informa que administradores recebem mensagens comuns; bots sem Privacy Mode
também as recebem. Com Privacy Mode ativo, respostas diretas a mensagens do bot
continuam chegando. O campo `getMe.can_read_all_group_messages` informa a
configuração global; não é prova de entrega de cada mensagem naquele grupo.
Uma alteração de Privacy Mode pode exigir readicionar o bot ao grupo existente.
A demo não altera Privacy Mode nem privilégios automaticamente.

Ao receber `/iniciar`, se a leitura geral não estiver informada em `getMe`, a
entrada consulta `getChatMember` para verificar se o bot é administrador no
próprio grupo identificado. Se não for ou não puder comprovar, orienta responder
à mensagem do bot. Não exige criar outro grupo nem alterar configurações para
esse roteiro. O primeiro texto recebido de cada pessoa durante a coleta recebe
**“Mensagem recebida e guardada para a proposta”**. Essa confirmação é a evidência
operacional de entrega; não afirma que a IA já interpretou a preferência.
Se ela não aparecer para um texto comum, envie-o como resposta direta à mensagem
do bot antes de `/finalizar`. Comandos podem usar `/iniciar@nome_do_bot`,
`/finalizar@nome_do_bot` e `/cancelar@nome_do_bot` para evitar ambiguidade no grupo.

## Roteiro no grupo existente, com os três integrantes

1. Cada pessoa abre o privado do bot com `/start` para habilitar mensagens
   individuais. Use o grupo existente onde o bot já está adicionado.
2. Execute o comando acima e, se solicitado, autorize OAuth no navegador local.
   Mantenha esse único processo aberto durante a demonstração.
3. Organizador envia `/iniciar` no grupo. Esse evento identifica o grupo e o
   organizador; não encaminhar IDs nem usar cadastro manual de participantes.
4. No privado, o organizador revisa e confirma o endereço salvo correto. Não há
   endereço completo no grupo nem cadastro de endereço pelo bot.
5. Cada integrante responde à mensagem **“Endereço confirmado...”** do bot com
   preferências em texto. Confira a confirmação **“Mensagem recebida...”** de
   cada pessoa. Esse formato funciona também com Privacy Mode ativo.
6. Organizador envia `/finalizar`. A coleta em lote usa o Groq real e o Core
   consulta MCP real para gerar a proposta. Nenhum carrinho é criado.
7. Para revisar, enviem novas preferências e usem `/finalizar` novamente.
   `/cancelar` encerra a sessão; Ctrl+C encerra polling e conexão MCP.

## Limites e evidência de validação

Esta rodada testa o caminho Telegram.handleUpdate → handlers → Core → adaptador
com transportes Telegram/MCP/LLM controlados, incluindo envelopes MCP reais
sanitizados. Testa autorização, privacidade, três participantes, proposta,
revisão, cancelamento, botões antigos e recuperação de mensagens. Testa também
uma única conexão/discovery e fechamento durante autenticação. Isso não é prova
de pessoas reais falando com o bot. A evidência anterior de Groq + produtos
MCP reais está em `DEMO-INTEGRATION.md`; não foi substituída por FakeLlm.

Ainda falta o ensaio de mensagens de preferências no grupo real. A conferência
local confirmou o token preenchido em `telegram-demo.env` e as configurações
MCP/IA no `.env` original, sem imprimir seus valores. O carregamento dos dois
arquivos foi verificado localmente, sem chamadas remotas. Não foi consultado
o Privacy Mode real nesta conferência; a entrada faz essa consulta ao iniciar.
Nenhuma mensagem foi enviada ao grupo nesta preparação, e o preflight posterior de MCP/IA real está descrito em
`TELEGRAM-REAL-CATALOG-FIX.md`: catálogo lido, Groq HTTP 429, sem simulação.

- Busca limitada explicitamente à primeira página e uma loja aberta; cardápio
  `offers_only`, até seis ofertas. Não representa catálogo completo nem garante
  satisfação das preferências. Ausência de correspondência não é inventada.
- Loja fechada em nova leitura `getMerchant` não gera proposta nessa loja.
  A disponibilidade final de produtos depende da preparação comercial.
- Frete, taxas, descontos, total e orçamento efetivo não são confirmados aqui.
  Não há rateio financeiro de valores desconhecidos.
- Fluxo de endereço digitado permanece pendente de validação comprovada e de
  consentimento separado para eventual `createAddress`. A demo usa endereço salvo.
- Modelo e configuração do time preservados. 429/5xx interrompe a chamada;
  novas tentativas respeitam espera informada pelo provedor. Sem espera oficial,
  o processo bloqueia novas chamadas de IA até reinicialização consciente, após
  verificar a cota. Não repetir `/finalizar` em sequência para contornar limite.
- Sessões, collector e rotas de callback estão em memória, sem retomada persistida.
- Cliente sem habilitação de mutações. Não existem botões de preparar carrinho,
  pagamento, checkout ou submissão nesta demo. Preparação comercial será uma
  etapa separada com autorização específica; nunca ligar `/finalizar` à compra.

Critério de aceitação pelo responsável: revisar o patch contra a referência,
confirmar o token salvo localmente e executar o roteiro no grupo existente.
O fluxo comercial continua pendente; não bloqueia esta proposta preliminar.

Validação deste patch em 18/10/2026: `npm run check` passou com lint, typecheck
e 1.198 testes em 56 arquivos; `npm run build`, `git diff --check` e
`git diff --cached --check` passaram. A auditoria não detectou credenciais
configuradas nem relatórios privados entre os arquivos versionáveis. Os 80
arquivos do índice mantêm os hashes SHA-256 do checkpoint inicial.
