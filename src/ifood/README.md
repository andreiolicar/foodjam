# FoodJam — integração MCP do iFood (IF-01 a IF-05, sem submissão)

**Entrada real de integração:** [INTEGRATION-HANDOFF.md](INTEGRATION-HANDOFF.md),
na branch codex/if05-real-integration baseada na main. O script integrar:ifood já
executou endereço salvo → catálogo real → proposta preliminar do Core → leitura
de carrinho conhecido. Preparação de novos carrinhos/rateio real ainda dependem
de teste específico autorizado e reconciliação comercial. Nenhuma compra ou
mutação foi executada nesta integração. As seções IF-01–05 abaixo preservam o
histórico da branch feat/ifood-mcp; não descrevem a nova porta por fase.


A IF-05 prepara `createIfoodCatalog(client, options)`, com `searchStores`,
`getMenu`, `listSavedAddresses` e a extensão `getStore`. **IF-05 aberta e sem
homologação integral**: a porta atual também exige `validateAddress` e
`quoteOrder`, ainda sem implementação segura neste módulo.

As inspeções reais 04/05 foram executadas autonomamente com autorização de
leitura: 11 leituras lógicas incluindo duas descobertas, sem escrita. OAuth,
envelopes, associação de itens e continuação real foram conferidos. Unidades
monetárias, disponibilidade e menu inclusivo permanecem bloqueados. Resultado,
cobertura e decisões da equipe em [INSPECTION-04-05.md](INSPECTION-04-05.md).

API e composição em [CATALOG.md](CATALOG.md); procedimento de inspeção em
[CATALOG-VALIDATION.md](CATALOG-VALIDATION.md); endereço manual e decisões da
Ana Paula em [ADDRESS-FLOWS.md](ADDRESS-FLOWS.md). As evidências IF-01–04 abaixo
são históricas e continuam preservadas.

Responsável: Andrei. Branch: `feat/ifood-mcp`. **Íris** é o nome do agente
cadastrado no portal; o produto e o cliente MCP se chamam **FoodJam**.

**IF-01 validada manualmente no Mac em 17/10/2026**, conforme confirmação do
responsável: a CLI autenticou no MCP do iFood e apresentou nomes, descrições e
schemas reais das ferramentas. O fluxo utilizado foi OAuth `authorization_code`
com `client_secret_post`, PKCE S256 e validação de state.

Este módulo implementa conexão explícita, OAuth interativo para um usuário de
teste, descoberta de ferramentas, execução restrita de consultas de leitura
e operações de carrinho com mutações habilitadas explicitamente pela aplicação.
A IF-04 acrescenta consulta de pagamentos, configuração de pagamento com
habilitação independente e consultas de detalhes/acompanhamento de pedidos.
Não interpreta conversas, calcula rateios, controla sessões do core ou conclui
compras. A composição com o
core/Telegram continua a cargo de `src/index.ts`, sem alterações nesta entrega.

A IF-02 estende a IF-01 sem reconstruir autenticação/transporte. Os sete nomes
reais sem prefixo foram confirmados pelo responsável a partir de `listTools()`;
schemas continuam dinâmicos. **A leitura real `getUser` foi validada manualmente
no Mac em 17/10/2026**, conforme confirmação do responsável: autenticação OAuth,
descoberta do catálogo, HTTP `200`, evento `tools_read: succeeded` e encerramento
correto da conexão. No smoke test da IF-03, a pré-verificação real também passou
com `listAddresses`, `getMerchant` e `getItem`. `browseOffers`, `searchOffers` e
`getRecommendations` permanecem cobertas somente por testes automatizados com
HTTP/doubles locais nesta entrega.

## IF-04 — preparação de pagamento e acompanhamento

**A leitura real `listPaymentMethods` foi validada no Mac em 17/10/2026**,
conforme confirmação do responsável. OAuth foi concluído, a troca de tokens
por `client_secret_post` retornou HTTP `200`, a conexão autenticada e a
descoberta foram estabelecidas, e a consulta retornou HTTP `200`,
`tools_payment_order: succeeded` e código de saída `0`, com encerramento da
conexão. `annotation_mismatch` foi observado e não impediu a execução: é
informativo quando o hint contradiz a classificação local, sem alterar as
allowlists ou habilitar mutações.

O teste foi executado manualmente pelo responsável; o assistente não fez
chamadas remotas. Não houve configuração ou execução de pagamento, checkout
ou pedido. Respostas, IDs de cartões/tokens, credenciais e dados pessoais não
foram registrados aqui. Essa evidência não valida `setCartPayment`, `getOrder`
ou `trackOrder` contra o servidor real.

Esta etapa reutiliza o cliente autenticado, transporte, OAuth, catálogo paginado,
validadores e encerramento existentes. A extensão pública é:

```ts
client.callPaymentOrderTool(
  name: string,
  args: Record<string, unknown>,
): Promise<IfoodMcpPaymentOrderResult>
```

`IfoodMcpPaymentOrderResult`, `IfoodMcpPaymentOrderToolName` e
`IfoodMcpPaymentOrderReadToolName` são exportados por `index.ts`. O resultado
permanece opaco. As APIs das IF-01, IF-02 e IF-03 continuam disponíveis com suas
allowlists originais; chamar estas quatro ferramentas por `callReadTool` ou
`callCartTool` continua bloqueado.

| Ferramenta da IF-04 | Classificação local | Permissão adicional |
| --- | --- | --- |
| `listPaymentMethods` | Leitura sensível | Nenhuma |
| `setCartPayment` | Mutação controlada | `allowPaymentConfiguration: true` |
| `getOrder` | Leitura sensível | Nenhuma |
| `trackOrder` | Leitura | Nenhuma |

Todas exigem conexão aberta e token em memória, nome exato na allowlist e
presença única no catálogo da conexão. Nomes desconhecidos, aliases e
`submitOrder` são bloqueados antes de discovery/execução. Annotations não
concedem permissão; uma divergência de `readOnlyHint` gera somente o evento
fixo `tools_payment_order: annotation_mismatch`, conforme a política da IF-03.
Ferramentas que exigem MCP Tasks são recusadas; esta API é síncrona.

### Schemas observados e validação dinâmica

Andrei forneceu os seguintes metadados de uma descoberta real anterior como
referência para o preflight da IF-04. Não há confirmação de captura local.

| Ferramenta | Campos obrigatórios observados | Campos opcionais observados |
| --- | --- | --- |
| `listPaymentMethods` | `merchantId`: string com formato UUID | — |
| `setCartPayment` | `cartId`, `paymentMethodId`: strings com formato UUID | `cardTokenId`: string com formato UUID |
| `getOrder` | `orderId`: string, sem formato UUID declarado | — |
| `trackOrder` | `orderId`: string, sem formato UUID declarado | `nextPageToken`: string |

**Divergência técnica:** o schema observado de `paymentMethodId` exige UUID,
mas sua descrição cita `PIX` e `CREDIT_CARD`. O módulo não transforma esses
nomes em IDs nem relaxa o schema. O chamador deve fornecer um identificador
real retornado pelo serviço e compatível com o schema vigente. Se as duas
fontes continuarem incompatíveis, interrompa a configuração e esclareça o
contrato do servidor; não invente valores.

Esses campos não são schemas fixos no adaptador: `listTools()` na conexão atual
continua sendo a fonte da verdade. Os argumentos são copiados e validados
contra `inputSchema`, sem coerção, defaults ou reconstrução de payload.
IDs seguem o formato realmente declarado, inclusive `orderId` sem exigência
local de UUID. Schemas não compiláveis falham fechado.

OutputSchemas não foram preservados na captura anterior; não se confirma sua
existência ou estrutura. Quando o servidor fornecer `outputSchema`, a resposta
de sucesso é validada pelo validador existente, inclusive para ferramentas de
páginas anteriores do catálogo. Sem esse schema, valida-se somente o envelope
MCP e preserva-se a resposta opaca. Não há schema de saída inventado no código.
Fixtures de saída nos testes representam cenários simulados, não contratos reais.

Limitação: sem outputSchema, a validação do envelope não comprova o contrato
de domínio do pagamento/pedido. O Core deve interpretar e validar os campos
antes de usá-los. Os schemas históricos são uma referência de descoberta,
não uma garantia de que permanecem iguais no servidor.

### Configuração controlada de pagamento

A habilitação é separada das mutações de carrinho:

```ts
// Opção definida pela aplicação confiável, após decidir permitir configuração.
const client = createIfoodMcpClient(config, { allowPaymentConfiguration: true });
try {
  await client.connect();
  const catalog = await client.listTools();
  // A aplicação consulta listPaymentMethods e escolhe um método real.
  // Esta função ilustrativa pertence à aplicação e deve respeitar o schema.
  const args = await preparePaymentArgumentsInApplication(catalog);
  const result = await client.callPaymentOrderTool('setCartPayment', args);
  // Trate result privadamente e verifique isError antes de usar o resultado.
  void result;
} finally {
  await client.close();
}
```

Somente o booleano `true` na criação habilita `setCartPayment`; a opção é
copiada para a vida da instância. Alterar o objeto original depois não habilita
pagamento. `allowCartMutations` não concede essa permissão e habilitar pagamento
não concede mutações de carrinho. Flags no payload, hints do servidor e
`userConsent: true` não concedem permissão. OAuth autoriza acesso ao serviço.
Cabe ao Core decidir quem pode configurar pagamento e qual método escolher;
a fábrica/opções não devem ser controladas por texto do usuário ou por um LLM.
A permissão da instância não substitui autorização por usuário/ação no Core.

O adaptador não escolhe pagamento, não preenche `cardTokenId`, não consulta
cartões implicitamente e não conclui compra. Quando necessário para cartão,
`cardTokenId` deve vir de `listPaymentMethods` e ser fornecido pelo chamador.
Configurar pagamento modifica o carrinho; não é autorização de submissão.

### Acompanhamento, resultados e dados sensíveis

`getOrder` consulta somente o pedido informado pelo chamador. `trackOrder`
encaminha os argumentos completos, incluindo o token de paginação quando
fornecido, e faz exatamente uma consulta. Status, histórico, tokens de próxima
página e orientações de nova consulta são preservados onde o MCP os retornar:
em `content`, `structuredContent`, `_meta` ou outros campos. Não há polling,
paginação de histórico automática ou timers de acompanhamento. O Core decide
quando consultar novamente e o que apresentar ao Telegram.

Os resultados preservam `content`, `structuredContent`, `isError`, metadados e
valores financeiros sem alterar unidades, arredondar ou converter strings.
`isError: true` é devolvido como falha MCP, sem aplicar schema de sucesso ao
conteúdo de erro e sem registrar o conteúdo. Erros de protocolo/rede/autenticação
são convertidos pelos diagnósticos seguros existentes, sem mensagem, stack,
data ou cause brutos. Recursos devem sempre ser fechados em `finally`.

Não registre respostas ou argumentos dessas operações. `listPaymentMethods`
pode retornar IDs de cartões/tokens; `getOrder` pode retornar endereço, dados
de pagamento, documento e código de verificação. Também trate IDs de pedidos
e tokens de paginação como dados privados. A resposta íntegra existe apenas
para processamento privado pelo chamador; preservar a resposta não autoriza
sua publicação no Telegram. O Core é responsável pela minimização e pela
apresentação segura. O adaptador e a CLI não imprimem esses dados nem gravam
respostas em arquivos. Não use cartões, tokens ou IDs fictícios em chamadas reais.

### Validação real e procedimento manual, exclusivamente de leitura

A única operação da IF-04 validada contra o servidor real nesta entrega é
`listPaymentMethods`, em 17/10/2026, conforme o registro acima. Os testes
automatizados continuam usando somente mocks/HTTP simulado. A consulta não
configura pagamento, não cria pedido e não comprova execução de cobrança.

| Ferramenta | Testes automatizados | Validação real nesta IF-04 |
| --- | --- | --- |
| `listPaymentMethods` | Doubles e SDK com HTTP simulado | Sim: leitura no Mac, HTTP 200, succeeded, saída 0 e conexão encerrada |
| `setCartPayment` | Doubles e SDK com HTTP simulado | Não executada; exige autorização adicional |
| `getOrder` | Doubles e SDK com HTTP simulado | Não executada |
| `trackOrder` | Doubles e SDK com HTTP simulado | Não executada |

Após configurar as credenciais locais, prepare argumentos conforme o schema
vigente e com IDs reais autorizados. Os comandos abaixo documentam consultas
manuais opcionais; não foram executados pelo assistente. Somente a leitura
`listPaymentMethods` foi confirmada pelo responsável. Os arquivos indicados
devem ser locais/privados, fora do Git.
Não inclua respostas, dados de cartões ou credenciais nesses arquivos. O CLI
recebe JSON por stdin e nunca imprime a resposta, IDs ou tokens de paginação:

```bash
node --import tsx src/ifood/payment-order-read-cli.ts listPaymentMethods < "$PAYMENT_METHODS_INPUT"
node --import tsx src/ifood/payment-order-read-cli.ts getOrder < "$ORDER_DETAILS_INPUT"
node --import tsx src/ifood/payment-order-read-cli.ts trackOrder < "$ORDER_TRACKING_INPUT"
```

Defina os três caminhos privados no terminal; não cole IDs/credenciais na linha
de comando. Após build, pode usar `node dist/ifood/payment-order-read-cli.js`.
A CLI aceita apenas estas três leituras, exige objeto JSON de até 1 MiB e
encerra a conexão em sucesso, falha ou cancelamento. Status `0` significa
consulta concluída e encerrada; status `1` indica falha, inclusive `isError`.
Confira os eventos seguros de autenticação, `tools_list`,
`tools_payment_order` e encerramento. Para revisar estruturas completas, use
a API em memória em ambiente privado; não salve respostas nem as imprima.
Nenhuma opção da CLI permite `setCartPayment` ou `submitOrder`. Não configure
pagamento real sem autorização adicional e não crie/finalize pedidos nesta etapa.

### Fronteira com o Core e pendência de submissão

`submitOrder` continua completamente indisponível em todas as APIs de execução.
Não há método de submissão, acesso irrestrito ao SDK nem mecanismo de consentimento
artificial no módulo. Mesmo as duas habilitações de mutação combinadas com
`userConsent: true` não permitem submeter um pedido.

A futura integração precisa de um contrato Core → adaptador que contemple:

- Identidade do organizador autorizado.
- Identificação exata do carrinho.
- Total revisado.
- Confirmação explícita obtida na aplicação.
- Verificação de que a confirmação permanece válida.
- Proteção contra submissão duplicada.

A definição e verificação dessas regras pertencem ao Core. A IF-04 documenta
essa dependência e não altera `src/core/`, Telegram, contratos compartilhados
ou `src/index.ts`. Não implementa confirmação, IA, rateio ou fluxo conversacional.

## Organização e dependências

- `index.ts`: API pública, sem efeitos colaterais de importação.
- `config.ts`: leitura explícita e validação de configuração.
- `auth.ts`: provedor OAuth, credenciais pré-cadastradas e tokens em memória.
- `callback.ts`: listener HTTP temporário, restrito a loopback, com validação de state.
- `client.ts`: ciclo de conexão, autenticação, listagem paginada e encerramento.
- `cli.ts`: descoberta manual e diagnóstico seguro.
- `diagnostics.ts`: eventos por etapa e extração de metadados seguros dos erros.
- `read-tools.ts`: política de leitura, argumentos JSON e validação de schemas/resultados.
- `read-cli.ts`: teste real opcional de leitura, com resposta omitida do terminal.
- `tool-validation.ts`: validação JSON/schema/envelope reutilizada pelas APIs de operações.
- `cart-tools.ts`: allowlist e separação de consultas/mutações de carrinho.
- `cart-cli.ts`: validação manual opcional de carrinho, somente leitura por padrão.
- `payment-order-tools.ts`: allowlist local de pagamento e acompanhamento, com permissão independente.
- `payment-order-read-cli.ts`: validação manual opcional restrita às três leituras da IF-04, sem imprimir respostas.
- `cart-smoke.ts`: inspeção local de estrutura e extração explícita de UUID, sem persistir respostas.
- `smoke-setup.ts`: recupera os argumentos anteriores no SQLite local do OpenCode, somente leitura, e grava entradas privadas do teste.
- `smoke-preflight.ts`: pré-verificação manual de endereço, estabelecimento e produto, usando somente a API de leitura da IF-02.

Usa `@modelcontextprotocol/sdk` **1.32.1**, `StreamableHTTPClientTransport` e
`OAuthClientProvider` do SDK v1; não há migração para v2. Zod permanece como peer
do SDK. Usa `dotenv` somente na execução direta da CLI; `tsx` para executá-la em
desenvolvimento e Vitest para testes. HTTP, criptografia e abertura do navegador
usam APIs do Node. Nenhuma dependência nova ou configuração compartilhada foi
necessária. Os requisitos de Node permanecem os de `package.json`.

## Configuração local

| Variável | Necessidade | Valor |
| --- | --- | --- |
| `IFOOD_MCP_ENDPOINT` | Opcional | Padrão: `https://consumer-mcp.ifood.com.br/marketplace` |
| `IFOOD_MCP_CLIENT_ID` | Obrigatória | Client ID do agente Íris |
| `IFOOD_MCP_CLIENT_SECRET` | Obrigatória | Client Secret do agente Íris |
| `IFOOD_MCP_CALLBACK_URL` | Obrigatória | URL **exata** cadastrada no portal |

Callback confirmado pelo responsável nesta tarefa:
`http://127.0.0.1:19876/callback`.

Configure as variáveis no ambiente do processo ou em um `.env` local, já
ignorado pelo Git. A CLI carrega `.env` do diretório atual, sem substituir
variáveis exportadas. Não coloque segredos na linha de comando, no histórico,
em exemplos versionados, logs ou no chat. Não copie arquivos de autenticação
internos do OpenCode.

A URL de callback não tem padrão automático: `localhost` e `127.0.0.1`, portas,
caminhos e barra final podem representar cadastros diferentes. O valor original
é enviado ao OAuth sem normalização. Nesta versão o callback precisa ser HTTP
local (`127.0.0.1`, `localhost` ou `::1`) sem query, fragmento ou credenciais.
O listener usa apenas `127.0.0.1` ou `::1`, nunca `0.0.0.0`. Porta `0` é rejeitada.
O endpoint remoto deve usar HTTPS, sem credenciais, query ou fragmento.

Se o portal exigir outro callback, confirme primeiro o valor cadastrado. Não
troque a porta ao encontrar conflito e não altere o portal automaticamente.

## Autenticação

1. `connect()` cria cliente e transporte e envia o handshake MCP. Não há rede na
   importação nem na construção de `createIfoodMcpClient()`.
2. Ao receber `401`, o SDK descobre metadados do recurso e do authorization server.
   Usa o Client ID/Secret já cadastrados, sem registro dinâmico de outro agente.
3. O SDK monta o fluxo `authorization_code` com PKCE S256. O módulo gera um state
   criptograficamente aleatório de 256 bits e abre o callback antes do navegador.
4. O usuário entra no navegador com o **usuário de teste** do iFood e autoriza Íris.
5. O callback aceita apenas GET no host/caminho configurados. Valida state com
   comparação de tempo constante antes de aceitar um único código. Retornos com
   state ausente/incorreto/duplicado, erro OAuth ou código ausente/duplicado falham.
6. O listener é encerrado e `finishAuth(code)` troca o código pelo token usando
   verifier PKCE e autenticação `client_secret_post`. Essa preferência é declarada
   em `clientMetadata` e em `clientInformation`, e o SDK a seleciona quando
   anunciada pelo servidor. Client ID e Client Secret vão no formulário HTTPS,
   sem header Basic e sem serem impressos nos diagnósticos.
7. Após a falha inicial de handshake, o SDK fecha o transporte: o módulo cria novas
   instâncias de cliente/transporte para conectar com os tokens obtidos.
8. `listTools()` solicita `tools/list`, seguindo todos os cursores e preservando
   schemas e metadados retornados. Cursor repetido causa falha, evitando loop.
9. `close()` tenta terminar a sessão remota e sempre fecha os recursos locais e
   limpa tokens/verifier. Também cancela OAuth pendente. É terminal e idempotente.

O state e o verifier não cruzam instâncias. Tokens são mantidos exclusivamente
em memória durante a conexão; não há persistência, cache do OpenCode ou suporte
multiusuário. O SDK pode renovar tokens durante a sessão. Nova autorização
interativa exige fechar e criar outro cliente. Há limite de três minutos para
o callback e de 15 segundos por requisição HTTP. SIGINT/SIGTERM na CLI cancelam o
fluxo e acionam o encerramento.

As credenciais ficam vinculadas ao authorization server anunciado pelo recurso,
`https://id.ifood.com.br`, e não são apresentadas a outro AS. No SDK v1 esse
binding usa a URL de descoberta; o campo issuer OIDC observado é
`https://id.ifood.com.br/3p`. Não há sobrescrita da validação de recursos do SDK,
URLs OAuth ou scopes inventados. Alterações do servidor exigem nova inspeção.

Erros externos não são propagados ou retidos em `cause`: respostas de token
podem conter informações sensíveis. São preservados apenas etapa, tipo conhecido,
status HTTP, categoria de requisição, método de autenticação do cliente e códigos
conhecidos de OAuth/MCP/rede. A CLI não imprime Client Secret, tokens,
códigos, verifier, state nem URL de autorização. O navegador recebe a URL
diretamente, sem shell. Mensagens de callback usam `no-store` e `no-referrer`.

## Descoberta manual

Na raiz do repositório, depois de configurar o ambiente e liberar a porta
cadastrada (encerre antes qualquer callback concorrente do OpenCode):

```bash
node --import tsx src/ifood/cli.ts
```

Sem novos scripts em `package.json`. Depois do build também pode executar:

```bash
node dist/ifood/cli.js
```

O comando informa conexão, nome/versão do servidor quando disponíveis,
quantidade, nome, descrição e schema de entrada de cada ferramenta descoberta.
O navegador abre automaticamente quando a autenticação for exigida. Termine a
autorização com o usuário de teste em até três minutos. O comando encerra a
conexão em sucesso ou falha; status de saída `0` significa sucesso e `1`, falha.

Para reproduzir a validação manual:

1. Configure Client ID e Client Secret de Íris no ambiente local ou no `.env`
   ignorado pelo Git, sem colocá-los no histórico do terminal.
2. Use exatamente `IFOOD_MCP_CALLBACK_URL=http://127.0.0.1:19876/callback` e deixe
   a porta cadastrada livre. Preserve o endpoint oficial ou configure
   `IFOOD_MCP_ENDPOINT` explicitamente.
3. Execute `node --import tsx src/ifood/cli.ts` na raiz do repositório.
4. Faça login com o usuário de teste no navegador e autorize o acesso.
5. No terminal, confira `clientAuthMethod: "client_secret_post"`, sucesso na
   troca de tokens/reconexão e a listagem de nomes, descrições e schemas.
6. Confira o encerramento da conexão e o status de saída. Não salve tokens,
   credenciais, cookies ou URLs OAuth em logs ou artefatos versionados.

A API pública não oferece `callTool` irrestrito ou comandos de compra. A CLI de
descoberta não executa ferramentas listadas. Nomes e schemas mostrados vêm
exclusivamente do MCP; fixtures de testes não representam parâmetros reais.

## IF-02 — execução segura de ferramentas de leitura

```ts
import { createIfoodMcpClient, readIfoodMcpConfig } from './ifood/index.js';

const client = createIfoodMcpClient(readIfoodMcpConfig());
try {
  await client.connect();
  const catalog = await client.listTools();
  // Inspecione o inputSchema recebido. {} é apenas exemplo, válido somente
  // se o schema real de getUser não exigir argumentos adicionais.
  const result = await client.callReadTool('getUser', {});
  if (result.isError) {
    // Falha da ferramenta: conteúdo preservado para tratamento privado pelo core.
  } else {
    // structuredContent e content permanecem opacos: valide o domínio antes de usar.
  }
  void catalog;
} finally {
  await client.close();
}
```

`callReadTool(name: string, args: Record<string, unknown>): Promise<IfoodMcpReadResult>`
é o caminho de execução da IF-02. A IF-03 acrescenta `callCartTool`, descrito
abaixo, sem ampliar a allowlist desta API. Exige conexão aberta e tokens em memória.
Se não houver catálogo nessa conexão, descobre-o por `listTools()` antes da
primeira leitura. O catálogo completo é guardado em cópia privada, sem alterar
os schemas recebidos, até nova listagem, desconexão ou encerramento. Uma falha
de atualização invalida o catálogo anterior. `listTools()` permite atualizá-lo
explicitamente.

### Ferramentas permitidas

Allowlist explícita com os nomes reais confirmados pelo responsável:

- `getUser`
- `listAddresses`
- `browseOffers`
- `searchOffers`
- `getRecommendations`
- `getMerchant`
- `getItem`

O nome também precisa existir exatamente uma vez no catálogo descoberto nessa
conexão. Não há remoção de `ifood_`, alteração de caixa, espaços ou aliases.
Ferramenta aprovada ausente não é criada nem substituída por outra. Não há
schemas ou parâmetros oficiais fixados no código; schemas dos testes são
fictícios e servem exclusivamente à verificação da integração.

`readOnlyHint: true` não concede autorização a nomes fora da lista. Se uma
ferramenta aprovada anunciar explicitamente `readOnlyHint: false`, a execução
também é bloqueada. Annotations são um sinal adicional, não a política principal.

### Validação, respostas e erros

Os argumentos devem ser um objeto JSON serializável. Valores como `undefined`,
funções, números não finitos, BigInt e ciclos são rejeitados, evitando mudanças
silenciosas na serialização. O módulo guarda uma cópia dos argumentos e valida
essa mesma cópia contra o `inputSchema` descoberto, usando o validador AJV
fornecido pelo SDK v1 instalado. Schema que não puder ser compilado bloqueia a
consulta, sem buscar referências remotas ou adivinhar parâmetros. A validação
fica limitada aos recursos de JSON Schema suportados por esse validador.

A requisição usa a operação oficial `Client.callTool()` do SDK. O envelope MCP
é validado e `content`, `structuredContent`, `isError` e metadados são preservados
para o chamador. Nenhum texto é convertido automaticamente para JSON ou para
um modelo de usuário/produto. `structuredContent` continua sendo um registro de
valores desconhecidos; validade do domínio é responsabilidade do consumidor.
Quando há `outputSchema`, o resultado de sucesso é validado também contra o
schema do catálogo completo, inclusive para ferramentas de páginas anteriores.

Uma resposta de ferramenta com `isError: true` é devolvida como falha da
ferramenta, com seu conteúdo intacto para tratamento privado, e produz somente
um diagnóstico genérico `read_tool_failed`. Não é transformada em sucesso ou em
exceção com dados pessoais. Erros de protocolo, comunicação, autorização e
validação rejeitam a Promise com uma mensagem sanitizada e `diagnostic` seguro.
São preservados códigos técnicos conhecidos, como código MCP e HTTP `403`,
nunca os argumentos, mensagens/corpos brutos ou a exceção original em `cause`.

HTTP `200` sozinho não significa sucesso da ferramenta ou do negócio: um
resultado MCP pode conter `isError: true` mesmo nessa situação. O tipo público
`IfoodMcpReadResult`, exportado por `index.ts`, preserva esse campo para o
consumidor distingui-lo. Nesse caso não há evento `tools_read: succeeded`, e a
CLI termina com código `1`. Mesmo sem `isError`, a resposta continua opaca e
não substitui a validação de domínio do consumidor.

As razões locais incluem `read_tool_not_allowed`, `read_tool_not_found`,
`read_catalog_ambiguous`, `read_tool_write_hint`, `read_arguments_invalid`,
`read_schema_invalid`, `read_result_invalid`, `read_client_disconnected` e
`read_not_authenticated`. Os eventos dessa execução usam a etapa `tools_read`.
O módulo não registra respostas, nomes de pessoas, endereços ou preferências;
quem consumir os resultados também deve evitar logá-los.

### Operações bloqueadas

Em `callReadTool`, todo nome fora da allowlist é bloqueado antes de `tools/call`,
independentemente de instruções do modelo ou annotations do servidor. Isso
inclui `createCart`, `addItemToCart`, `updateCartItem`, `removeItemFromCart`,
`createAddress`, `setCartPayment`, `submitOrder` e quaisquer novas operações de
escrita. Carrinhos usam exclusivamente a API controlada da IF-03. Não há executor MCP irrestrito público, checkout,
busca inteligente, orçamento, interpretação de preferências ou rateio.

### Teste real opcional sem imprimir dados pessoais

Com as mesmas variáveis e callback da IF-01, execute na raiz do repositório:

```bash
node --import tsx src/ifood/read-cli.ts getUser </dev/null
```

Isso envia `{}` como exemplo de argumentos. Se o schema real exigir campos,
o módulo bloqueia a chamada; inspecione `listTools()` e forneça os argumentos
reais por stdin, sem colocá-los em argumentos de shell ou histórico. Por exemplo,
prepare um arquivo local `tmp/ifood-read-args.json`, ignorado pelo Git, conforme
o schema recebido e execute:

```bash
node --import tsx src/ifood/read-cli.ts searchOffers < tmp/ifood-read-args.json
```

O JSON de stdin deve ser um objeto e tem limite de 1 MiB. O comando conecta,
descobre o catálogo, valida, executa somente a leitura autorizada e encerra.
Imprime apenas diagnósticos sanitizados e indicação de conclusão ou falha,
omitindo integralmente argumentos e resposta. Não mostra dados pessoais, nomes
de itens, contagens de endereços ou perfis. `isError: true` resulta em saída `1`;
sucesso, em `0`. SIGINT/SIGTERM acionam cancelamento e cleanup.

Em **17/10/2026**, o responsável executou o teste real no Mac e confirmou
`getUser` com HTTP `200`, `tools_read: succeeded` e encerramento correto. A CLI
autenticou por OAuth e descobriu as ferramentas antes da leitura, omitindo a
resposta do terminal. Esse resultado manual foi informado pelo responsável;
nenhuma leitura real foi executada pelo assistente e nenhum conteúdo do perfil
foi salvo no repositório. Em 17/10/2026, o responsável também confirmou a
pré-verificação real da IF-03 com `listAddresses`, `getMerchant` e `getItem`.
As outras três ferramentas de leitura permanecem sem validação manual nesta
entrega; a allowlist e as garantias da IF-02 continuam inalteradas.

Os testes automatizados não acessam o iFood. A autenticação continua sendo de
desenvolvimento, para um usuário, sem persistência entre execuções, com o
navegador e callback no mesmo computador. O módulo depende da semântica de
leitura dos nomes explicitamente aprovados; não audita a implementação interna
do servidor nem libera outros nomes com base em descrições ou hints.

## IF-03 — execução segura de carrinhos

Esta camada encaminha solicitações ao carrinho remoto do iFood. Não mantém
carrinhos locais, não cria identificadores e não implementa regras comerciais.
**IF-03 validada no Mac em 17/10/2026**, conforme confirmação do responsável:
pré-verificação aprovada, criação única por `createCart` e consulta posterior
por `getCart` em modo somente leitura. As duas operações retornaram HTTP `200`,
`tools_cart: succeeded` e código `0`; o UUID retornado foi validado, e a consulta
confirmou exatamente um Tradicional One, quantidade 1. O teste usou autorização
explícita e o usuário de teste; não houve checkout, pagamento ou `submitOrder`.
Nenhuma chamada remota foi executada pelo assistente, e o identificador do
carrinho, endereço, credenciais e dados pessoais não foram registrados aqui.

Os nomes são os exatos informados na descoberta anterior; cada um também precisa
existir no catálogo da conexão atual. Não há snapshots locais dos schemas
oficiais de carrinho. O sucesso deste cenário não estende a validação real às
outras cinco ferramentas nem a outros payloads, opções ou condições de entrega.

### Operações e API pública

| Ferramenta | Categoria | Solicitação encaminhada |
| --- | --- | --- |
| `createCart` | Mutação | Criar com restaurante, endereço e itens no mesmo payload, conforme schema |
| `getCart` | Leitura | Consultar estado, itens, totais e benefícios |
| `addItemToCart` | Mutação | Adicionar produto ao carrinho existente |
| `updateCartItem` | Mutação | Enviar estado exigido do item, incluindo quantidade e opções |
| `removeItemFromCart` | Mutação | Remover a linha identificada no carrinho |
| `getCartDeliveryMethods` | Leitura | Consultar condições/métodos de entrega |
| `setCartDelivery` | Mutação | Definir entrega e eventual agendamento conforme schema |

```ts
client.callCartTool(
  name: string,
  args: Record<string, unknown>,
): Promise<IfoodMcpCartResult>
```

O nome é validado em runtime. Os tipos `IfoodMcpCartToolName`,
`IfoodMcpCartReadToolName`, `IfoodMcpCartMutationToolName`, `IfoodMcpCartResult`
e `IfoodMcpClientOptions` são exportados por `index.ts`. Os argumentos são
registros JSON, pois tipos fixos de payload poderiam divergir dos schemas
oficiais descobertos. A API existente permanece disponível:
`connect()`, `listTools()`, `callReadTool()` e `close()`.

Exemplo de consulta com argumentos preparados pela aplicação conforme o schema
recebido (os nomes/estrutura de campos não são fixados neste exemplo):

```ts
const client = createIfoodMcpClient(readIfoodMcpConfig());
try {
  await client.connect();
  const catalog = await client.listTools();
  // A aplicação prepara args de acordo com o inputSchema de getCart.
  const args = await prepareArgumentsInApplication(catalog, 'getCart');
  const result = await client.callCartTool('getCart', args);
  if (result.isError) {
    // Falha comercial/MCP: tratar privadamente, sem considerar HTTP 200 sucesso.
  } else {
    // Preservar a resposta original para validação/reconciliação pelo Core.
  }
} finally {
  await client.close();
}
```

`prepareArgumentsInApplication` é ilustrativo, pertence ao chamador e não é
uma função deste módulo.

### Separação entre leitura e escrita

Mutações são **desabilitadas por padrão**. A única habilitação é a opção local
`allowCartMutations: true` na criação do cliente:

```ts
// Executado pela aplicação confiável após sua decisão explícita.
const client = createIfoodMcpClient(config, { allowCartMutations: true });
```

Essa decisão é copiada na criação e vale para a vida dessa instância. Somente o
booleano `true` habilita escrita; alterar o objeto de opções depois não muda a
decisão. Para voltar ao modo de leitura, feche e crie outro cliente com o padrão.
Não há setter de autorização nem flag equivalente no payload de uma ferramenta.

O Core controla essa configuração: não entregue a fábrica/configuração ao LLM,
não aceite `allowCartMutations` de texto, argumentos de ferramenta ou metadados
do servidor. A instrução isolada do modelo não autoriza mutações. A opção não é
um sistema de permissões de usuários, nem uma autorização individual por chamada;
se o Core precisar dessa granularidade, ele decide antes de encaminhar cada ação.
Autorizar OAuth também não habilita mutações.

Cada chamada exige conexão ativa, cliente aberto e token em memória. Antes de
descobrir ou executar, confere a allowlist e, para mutações, a habilitação local.
A ferramenta deve existir exatamente uma vez no catálogo privado da conexão;
nomes com prefixos, aliases, espaços ou outra caixa são recusados. O mesmo
catálogo paginado da IF-02 é reutilizado, atualizado por `listTools()` e
invalidado ao falhar a descoberta, desconectar ou encerrar.

Na API de carrinho, a classificação é exclusivamente local: `getCart` e
`getCartDeliveryMethods` são leituras com `readOnlyHint` ausente, `true` ou
`false`; as cinco mutações exigem habilitação explícita independentemente do hint.
Anotações não ampliam nem reduzem essas permissões. Conforme a
[especificação MCP](https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations),
são dicas, sem garantia de descrição fiel do comportamento da ferramenta.
Se um booleano `readOnlyHint` contradisser a classificação local, o módulo
emite somente `{ stage: 'tools_cart', event: 'annotation_mismatch' }`.
Esse diagnóstico informativo não é falha, não copia anotações, IDs, argumentos
ou respostas, e não altera a validação de schemas ou a autorização de mutações.
Nomes desconhecidos continuam bloqueados, mesmo com hint de leitura.

No primeiro teste real de `getCart`, o responsável relatou OAuth, conexão e
`tools_list` bem-sucedidos, seguidos de `cart_tool_write_hint`. O código anterior
tratava `readOnlyHint: false` como veto local. Esse bloqueio foi reproduzido e
corrigido em testes offline; o responsável confirmou a repetição real com
HTTP `200`, `tools_cart: succeeded` e saída `0`. Nenhuma chamada real foi feita
pelo assistente. A política da API de leitura da IF-02 permanece inalterada.
Ferramentas que exigem execução assíncrona via MCP Tasks são bloqueadas antes
da execução (`cart_execution_unsupported`); esta API executa chamadas síncronas.

`submitOrder`, `setCartPayment`, `listPaymentMethods`, `setVoucher`,
`removeVoucher`, `createAddress` e qualquer nome fora das allowlists da IF-02/IF-03 são
bloqueados antes de executar, mesmo com escrita habilitada e independentemente
de argumentos/annotations. `callReadTool` mantém sua lista original de sete
leituras. Esse bloqueio se refere às duas APIs anteriores; a IF-04 oferece
`listPaymentMethods` e `setCartPayment` exclusivamente por `callPaymentOrderTool`,
com a política separada descrita acima. O SDK e sua operação `request` não são
expostos pela API pública.

### Schemas, estruturas e identificadores

A mesma infraestrutura da IF-02 cria um snapshot JSON dos argumentos e valida
esse snapshot contra o `inputSchema` real usando o AJV do SDK. Não há coerção,
campos padrão, reconstrução de estado local, consultas implícitas nem chamada
extra para completar o payload. Schema não compilável falha fechado.

`createCart` encaminha restaurante, endereço e itens juntos quando fornecidos
conforme o schema. Não converte essa operação numa sequência de inclusões.
Para `updateCartItem`, o chamador deve obter o estado necessário e preparar o
payload completo exigido pelo schema, incluindo quantidade e opções quando
obrigatórias. O adaptador não transforma uma alteração parcial em estado
completo, nem infere opções/observações a manter. Payload incompleto é rejeitado.

| Identificador | Significado e origem |
| --- | --- |
| `merchantId` | Restaurante/estabelecimento, obtido das ferramentas de catálogo |
| `itemId` | Produto do catálogo do estabelecimento |
| `cartId` | Carrinho remoto, obtido da resposta do iFood |
| `cartItemId` | Linha/item inserido no carrinho remoto; não equivale ao `itemId` |

O adapter preserva esses valores opacos. Os campos, nesting e restrições
efetivamente aceitos vêm do schema descoberto; ele não troca um identificador
por outro nem fabrica valores. Endereço e entrega também usam as estruturas
oficiais, sem criar endereços nesta etapa.

### Respostas, erros e auditoria financeira

`IfoodMcpCartResult` preserva `content`, `structuredContent`, `isError` e os
metadados entregues pelo SDK, incluindo informações de auditoria existentes.
Não interpreta JSON contido em texto nem converte valores para contratos do Core.
Totais, subtotais, taxas, preços, benefícios, descontos, moedas e unidades
permanecem como recebidos. Benefício anunciado e desconto aplicado podem
divergir; o adaptador não corrige nem distribui essa diferença. A reconciliação
financeira e o rateio pertencem ao Core.

`isError: true` devolve o envelope de erro intacto e emite
`tools_cart: failed` / `cart_tool_failed`, sem evento de sucesso. Conteúdo de
erro não é validado contra o schema de sucesso. HTTP `200` confirma apenas o
transporte; mesmo `isError` ausente não substitui a validação de domínio no Core.
Resultados de sucesso também são validados contra o `outputSchema` quando
presente, inclusive quando descoberto em páginas anteriores.

Na versão instalada **1.32.1**, `Client.callTool()` valida `structuredContent`
contra o schema de sucesso até em algumas respostas com `isError: true`.
Por isso o caminho privado de carrinho usa `Client.request()` com
`method: 'tools/call'` e `CallToolResultSchema` no mesmo cliente SDK. O envelope
continua validado pelo SDK e pelo adaptador; o schema de sucesso é aplicado
pelo adaptador ao catálogo completo. Não há transporte, protocolo ou OAuth
paralelo, nem desativação dos validadores das consultas existentes.

Erros de rede, sessão, autorização, protocolo e validação rejeitam a Promise
com `IfoodMcpDiagnosticError`. Preservam códigos técnicos conhecidos, sem
mensagem bruta, corpo, argumentos, tokens ou `cause`. Eventos de carrinho usam
`tools_cart`; falhas na descoberta continuam em `tools_list`. Razões locais:
`cart_tool_not_allowed`, `cart_mutations_disabled`, `cart_tool_not_found`,
`cart_catalog_ambiguous`, `cart_arguments_invalid`,
`cart_schema_invalid`, `cart_result_invalid`, `cart_client_disconnected`,
`cart_not_authenticated` e `cart_execution_unsupported`.

O adaptador não implementa retry de mutações. Se uma chamada falhar após o
envio, o estado remoto pode ter mudado: consulte o carrinho e reconcilie antes
de decidir repetir. Não há garantia local de idempotência, transação ou rollback.
Use `close()` em `finally`; encerramento não desfaz alterações remotas. A
autenticação permanece de desenvolvimento para um usuário, sem persistência.

### Procedimento manual opcional — somente após autorização

Nenhuma escrita real deve ser executada automaticamente. Antes da primeira
validação de mutação, obtenha a autorização explícita de Andrei para as operações
e payloads, usando o usuário de teste. Até lá, mantenha o modo somente leitura.

1. Configure o ambiente/callback da IF-01 e descubra o catálogo com
   `node --import tsx src/ifood/cli.ts`. Confira nomes e schemas atuais.
2. Obtenha os identificadores reais via leituras autorizadas; para um carrinho
   existente, prepare `tmp/ifood-cart-args.json` conforme o schema retornado.
   `tmp/` já é ignorado pelo Git; não coloque dados pessoais no histórico.
3. Faça apenas uma consulta, sem flag de escrita:

   ```bash
   node --import tsx src/ifood/cart-cli.ts getCart < tmp/ifood-cart-args.json
   ```

   Para entrega, prepare os argumentos respectivos e use `getCartDeliveryMethods`.
   Sem a flag, qualquer mutação é recusada antes de OAuth/rede, inclusive
   se o JSON contiver uma suposta autorização.
4. **Depois da autorização explícita**, prepare o payload de `createCart` com
   restaurante, endereço e itens conforme schema. Para uma única execução:

   ```bash
   node --import tsx src/ifood/cart-cli.ts createCart --allow-cart-mutations < tmp/ifood-cart-args.json
   ```

   A flag é uma decisão local do operador, não pode vir do LLM nem do JSON.
   Só vale para essa execução; não habilita pedidos, pagamento, cupons ou endereços.
5. Por padrão, a CLI omite a resposta, incluindo IDs e valores. A opção
   `--print-cart-id`, restrita a `createCart` habilitado, pode exibir somente um
   UUID no caminho explicitamente confirmado, conforme a preparação abaixo.
   Não imprima nem versione o restante do conteúdo. Não use IDs de fixtures.
6. Com autorização para cada alteração pretendida, valide inclusão, atualização
   completa, remoção e entrega. Antes e depois, consulte o carrinho para conferir
   estado e preservar os valores originais para auditoria pelo Core. Encerre
   sempre a conexão. Não execute `submitOrder`, pagamento ou pedido real.

A CLI aceita um objeto JSON de até 1 MiB em stdin. Imprime somente diagnósticos
sanitizados e status; sucesso de ferramenta retorna `0`, `isError`, validação ou
falha técnica retornam `1`. SIGINT/SIGTERM cancelam e acionam cleanup. O comando
também retorna `1` se uma resposta chegar após o cancelamento; nesse caso avisa
que o estado remoto pode ter mudado e orienta consultar antes de repetir. O comando
também funciona após build em `dist/ifood/cart-cli.js`, com as mesmas restrições.

### Preparação do smoke test — primeiro inspecionar uma leitura

O cenário solicitado é **Corta Pra Mim Hamburgueria Artesanal / Tradicional One /
quantidade 1**. O responsável forneceu `merchantId` e `itemId` reais; o endereço
permanece privado e é recuperado do registro anterior, sem inventar IDs.
Antes de qualquer criação, o operador deve conferir com
as leituras oficiais que o estabelecimento/produto continuam disponíveis e que
o endereço está na lista de endereços do usuário de teste. Catálogo ou UUID
sintaticamente válido, isoladamente, não confirma esses requisitos comerciais.

As informações da simulação anterior são parciais: `getCart` recebe `cartId` e
há uma lista `items[]`, mas não foram preservados os caminhos internos da saída
nem sua origem. Portanto, a primeira etapa usa o carrinho anterior, sem escrita:

```zsh
cd /Users/andrei/FoodJam
node --import tsx /Users/andrei/FoodJam/src/ifood/cart-cli.ts getCart --inspect-result < /Users/andrei/FoodJam/tmp/ifood-get-cart.json
printf 'Código de saída: %s\n' "$?"
```

Use o arquivo de argumentos já validado, com o ID real anterior. Se ele não
existir ou o carrinho estiver indisponível, pare: não há criação de fallback.
`--inspect-result` só aceita `getCart`, sem `--allow-cart-mutations`.

A saída da inspeção contém somente `{ source, path, type }`, nunca valores:

- `source`: `structuredContent` ou `content[N].text` com o índice original do bloco.
- `path`: caminho de campos; raiz `""`, e `[]` representa um elemento amostrado do array.
- `type`: tipo JSON; texto não interpretável como JSON é marcado `non-json-text`.

Somente um vocabulário fixo de nomes técnicos aparece nos caminhos. Chaves
arbitrárias são ocultas como `<property>` para não expor nomes, e-mails, IDs
usados como chave ou caracteres de controle. Esse segmento não é um caminho
confirmado para extração. Metadados `_meta`, conteúdo não textual e valores
de folhas não são inspecionados. Textos são interpretados apenas como JSON
completo, sem remover Markdown, procurar substrings ou interpretar instruções.

O responsável confirmou a inspeção real de `getCart`: JSON em `content[0].text`,
`/cartId`, `/items` e, por item, `/itemId`, `/cartItemId`, `/quantity` e
`/unitPrice`, com HTTP `200` e saída `0`. Esses caminhos são exclusivos desta
consulta, não uma inferência sobre a resposta de criação.

Limites: 200 campos visitados, profundidade 8, amostra de até 10 elementos por
array, até 100 blocos de conteúdo e 1 MiB por texto JSON. A CLI informa quando
há truncamento. Inspeção de estrutura não confirma qual produto está no carrinho
nem sua quantidade. Agora `getCart --verify-single-item UUID` usa somente os
caminhos confirmados: confere o `cartId` solicitado, cardinalidade 1, `itemId`
esperado e quantidade numérica 1. Não usa `cartItemId` como ID de produto,
não imprime IDs, preços ou dados pessoais e não altera a resposta financeira.
Formato, identidade ou quantidade divergente geram saída `1` sem mutação.

### Exibição opcional do cartId — somente após autorização de criação

`createCart --allow-cart-mutations --print-cart-id` aceita ainda a opção
`--cart-id-path ORIGEM:JSON_POINTER`. O operador precisa confirmar a origem e o
caminho do UUID na **resposta de createCart**; o caminho de `getCart` não prova
que a criação usa o mesmo formato. Não há caminho padrão nem descoberta por UUID.

As origens aceitas são `structuredContent` e `content[N].text` (N de 0 a 99).
O modo `json` seleciona o mesmo JSON Pointer explícito no conteúdo estruturado
e nos blocos textuais JSON. Só aceita um UUID único, ou cópias do mesmo UUID;
valores inválidos ou contraditórios falham fechado. Não escolhe outro campo,
alias ou wrapper. Limites: até 100 blocos e 1 MiB de texto agregado.
O caminho usa JSON Pointer, com escapes `~0`/`~1`. Os nomes de folha suportados
são `cartId`, `cartUuid`, `id` e `uuid`; a seleção não pode atravessar campos
conhecidos de produto, itens, estabelecimento, endereço, usuário ou perfil.
Campos de protótipo, caracteres de controle, origem desconhecida ou opção
duplicada são rejeitados antes de conectar. Essas restrições não confirmam a
semântica de um campo desconhecido: o caminho deve vir de evidência real,
nunca de uma sugestão do LLM.

Exemplo **apenas de sintaxe**, com placeholders a substituir por caminho
confirmado e payload real; não executar nesta fase de preparação:

```text
node --import tsx /Users/andrei/FoodJam/src/ifood/cart-cli.ts createCart --allow-cart-mutations --print-cart-id --cart-id-path 'ORIGEM:/CAMINHO_CONFIRMADO' < /Users/andrei/FoodJam/tmp/ifood-create-cart-one-item.json
```

Após uma única chamada, um UUID canônico de versão 1–8 e variante padrão gera
somente `cartId: UUID` como dado de resposta. UUID nulo, valor inválido, caminho
ausente ou formato desconhecido causam saída `1` e inspeção sanitizada da
estrutura, sem outro ID ou payload. Não há busca recursiva por UUIDs nem alias
automático de IDs. `isError` e cancelamento não imprimem ID nem inspecionam a
resposta. O cliente sempre é encerrado.

**Saída `1` após envio não significa que o carrinho não foi criado.** A criação
nunca é repetida automaticamente, mesmo se a extração ou o cleanup falhar.
Sem `--print-cart-id`, o comportamento anterior de omitir a resposta é preservado.
Não execute uma criação sem um caminho confirmado apenas para testar a flag.
Foi localizado, em leitura local do histórico do OpenCode, um `ifood_createCart`
concluído com os IDs fornecidos e o JSON de resposta com `cartId` na raiz.
Esse nome com prefixo é apenas a chave do histórico; a API continua executando
`createCart` sem prefixo. A evidência da criação anterior confirma o caminho
`/cartId`, independentemente da inspeção de `getCart`. O histórico não prova a
origem do envelope MCP, por isso o teste usa `json:/cartId`. O formato atual
continua sujeito à validação na execução; se mudar, pare e não repita a criação.

Depois de obter o UUID, prepare o JSON de `getCart` com esse identificador e
consulte sem qualquer flag de mutação, usando `--verify-single-item`.
Nenhum dado financeiro é alterado. Nenhuma resposta completa é
gravada em arquivo, log ou fixture real. O responsável concluiu o smoke test
manual autorizado descrito abaixo; não houve submissão, pagamento ou checkout.

### Smoke test final — procedimento e registro da validação real

O responsável confirmou a execução bem-sucedida deste procedimento em
17/10/2026. Os comandos abaixo documentam a reprodução, não autorizam outra
criação: qualquer nova mutação requer uma nova decisão explícita do responsável.
Não repita `createCart` para confirmar o resultado já validado.

O schema de entrada de `createCart` fornecido pelo responsável contém
`required: []` na raiz; suas descrições exigem `merchantId`, `addressId` e
`items` para criar do zero. `orderId` é outra modalidade e não é usado.
Cada item exige `itemId` e `quantity`; neste teste omitem-se `cartItemId`,
`customerNote`, `options`, `deliveryMethod` e `paymentMethod`. A fonte de
verdade continua sendo o schema dinâmico, validado antes de `tools/call`.

O preparador local usa apenas o SQLite existente em
`~/.local/share/opencode/opencode.db`, em modo somente leitura. Seleciona a
última criação concluída com restaurante/produto corretos e recupera endereço
e argumentos de catálogo da mesma sessão. Não abre `mcp-auth.json`, não copia
credenciais, não usa resposta financeira e não faz chamadas MCP. Usa `node:sqlite`
do Node já declarado no projeto, sem dependência nova; importar a CLI não abre
o banco. As duas entradas geradas têm modo `0600`, sem sobrescrever arquivos:

- `tmp/ifood-smoke-create.json`: somente `merchantId`, `addressId` e um item com quantidade 1.
- `tmp/ifood-smoke-preflight.json`: endereço e argumentos antigos das consultas, incluindo coordenadas privadas.

Não imprima esses arquivos nem os envie no chat. Se o registro não estiver
disponível ou os argumentos já existirem, o preparador falha fechado. Não
substitui a conferência atual da conta e da disponibilidade pelo servidor.

Execute no mesmo terminal, uma etapa por vez, com o `.env` já configurado e
usando o usuário de teste. Pare em qualquer código diferente de `0`.

1. Preparação local, sem rede:

   ```zsh
   cd /Users/andrei/FoodJam
   umask 077
   node --disable-warning=ExperimentalWarning --import tsx /Users/andrei/FoodJam/src/ifood/smoke-setup.ts --out-dir /Users/andrei/FoodJam/tmp
   printf 'Preparação: %s\n' "$?"
   ```

2. Pré-verificação atual, somente leitura:

   ```zsh
   node --import tsx /Users/andrei/FoodJam/src/ifood/smoke-preflight.ts < /Users/andrei/FoodJam/tmp/ifood-smoke-preflight.json
   ifood_smoke_preflight_status=$?
   printf 'Pré-verificação: %s\n' "$ifood_smoke_preflight_status"
   ```

   Executa apenas `listAddresses`, `getMerchant` e `getItem`. Confere que o ID
   de endereço consta na conta autenticada e suas coordenadas coincidem com
   as anteriores; o estabelecimento correto está aberto; o produto corresponde
   a Tradicional One e não exige opções. Schema dinâmico, catálogo, tokens e
   allowlist da IF-02 continuam obrigatórios. Formato desconhecido, `isError`,
   dados divergentes ou falha de autorização/rede interrompem sem escrita.
   Essa leitura não reserva estoque; a criação validará as condições comerciais
   atuais no servidor. A saída não imprime endereço, coordenadas nem preço.

3. Criação única, somente com autorização explícita para essa execução:

   ```zsh
   if [[ "${ifood_smoke_preflight_status:-1}" != 0 ]]; then
     printf 'Pré-verificação não aprovada; criação bloqueada.\n'
   elif [[ "${ifood_smoke_creation_started:-0}" == 1 ]]; then
     printf 'Criação já disparada neste terminal; não repita.\n'
   else
     ifood_smoke_creation_started=1
     node --import tsx /Users/andrei/FoodJam/src/ifood/cart-cli.ts createCart --allow-cart-mutations --print-cart-id --cart-id-path 'json:/cartId' < /Users/andrei/FoodJam/tmp/ifood-smoke-create.json
     ifood_smoke_creation_status=$?
     printf 'Criação: %s\n' "$ifood_smoke_creation_status"
   fi
   ```

   Esperado: HTTP `200`, `tools_cart: succeeded`, `cartId: UUID` e código `0`.
   `annotation_mismatch` é informativo. A variável do shell reduz repetição
   acidental nesse terminal; não representa idempotência do servidor. Em erro
   de extração, veja somente a inspeção sanitizada e **não execute novamente**.

4. Após código `0` na criação, copie somente o UUID mostrado. Prepare os
   argumentos de leitura com entrada oculta, sem adicionar o valor ao histórico:

   ```zsh
   IFS= read -r -s 'ifood_smoke_cart_id?Cole somente o cartId retornado: '
   printf '\n'
   export IFOOD_SMOKE_CART_ID="$ifood_smoke_cart_id"
   node --import tsx --input-type=module -e '
   import {writeFileSync} from "node:fs";
   import {validateCartId} from "/Users/andrei/FoodJam/src/ifood/cart-smoke.ts";
   try {
     const cartId = validateCartId(process.env.IFOOD_SMOKE_CART_ID);
     writeFileSync("/Users/andrei/FoodJam/tmp/ifood-smoke-get.json", JSON.stringify({cartId}) + "\n", {mode: 0o600, flag: "wx"});
     console.log("Argumentos de leitura preparados; identificador omitido.");
   } catch {
     console.error("Argumentos de leitura não preparados; valor omitido.");
     process.exitCode = 1;
   }'
   ifood_smoke_get_args_status=$?
   unset IFOOD_SMOKE_CART_ID ifood_smoke_cart_id
   printf 'Preparação da leitura: %s\n' "$ifood_smoke_get_args_status"
   ```

   Esperado: arquivo privado `0600`, sem sobrescrita, e código `0`. Não use IDs
   de produtos, linhas ou estabelecimentos como identificador do carrinho.

5. Consulte o carrinho sem permitir mutações:

   ```zsh
   node --import tsx /Users/andrei/FoodJam/src/ifood/cart-cli.ts getCart --verify-single-item 18409df3-1e16-4bf8-9be5-433882c049aa < /Users/andrei/FoodJam/tmp/ifood-smoke-get.json
   printf 'Conferência: %s\n' "$?"
   ```

   Esperado: HTTP `200`, `tools_cart: succeeded`, mensagem de verificação
   aprovada (carrinho solicitado, exatamente um produto esperado, quantidade 1)
   e código `0`, sem valores financeiros ou dados pessoais. O resultado da
   ferramenta pode ser válido e a conferência falhar; nesse caso a CLI retorna
   `1`. Não corrige o carrinho nem repete a criação. Compartilhe apenas os
   diagnósticos sanitizados/status. O responsável confirmou esta sequência com
   código `0` e exatamente o produto/quantidade previstos, sem expor dados pessoais.

### Cobertura real e automatizada da IF-03

| Ferramenta | Testes automatizados | Validação no servidor real |
| --- | --- | --- |
| `createCart` | Doubles e SDK com HTTP simulado | Sim: criação única, UUID validado, um Tradicional One, quantidade 1 |
| `getCart` | Doubles e SDK com HTTP simulado | Sim: somente leitura, carrinho/produto/quantidade conferidos, código 0 |
| `addItemToCart` | Doubles | Não executada nesta entrega |
| `updateCartItem` | Doubles | Não executada nesta entrega |
| `removeItemFromCart` | Doubles | Não executada nesta entrega |
| `getCartDeliveryMethods` | Doubles | Não executada nesta entrega |
| `setCartDelivery` | Doubles | Não executada nesta entrega |

A pré-verificação real usou somente `listAddresses`, `getMerchant` e `getItem`
pela API da IF-02, com mutações desabilitadas. Resultados comerciais divergentes,
erros de rede/sessão/autorização, `isError`, bloqueio de pagamento/submissão e
preservação financeira são cobertos por mocks; não foram provocados no servidor.
Não houve validação real de descontos ou reconciliação financeira.

`annotation_mismatch` pode ser apenas informativo: um hint contraditório não
transforma uma leitura em mutação nem habilita escrita. As allowlists locais e
`allowCartMutations === true` continuam determinando as permissões de carrinho;
ferramentas desconhecidas, pagamentos, cupons e submissão permanecem bloqueados
nessa API de carrinho. Configuração de pagamento na IF-04 usa sua própria API
e permissão independente.

### Verificação e limitações

Os testes em `tests/ifood/cart-tools.test.ts` e `cart-cli.test.ts` usam doubles;
`cart-smoke.test.ts` cobre inspeção sem valores e UUID selecionado por caminho
explícito em conteúdo estruturado e em JSON textual, com formatos desconhecidos
e caminhos inválidos recusados;
`protocol.test.ts` exercita o SDK instalado com HTTP externo inteiramente
simulado, inclusive HTTP `200` com `isError` e conteúdo de erro incompatível
com schema de sucesso. Os testes de IF-01/IF-02 permanecem na suíte. Importar
a API ou as CLIs não abre rede, navegador, listener ou processo.

Execute `npm run check` e `npm run build`. Nenhum teste acessa o servidor iFood.
Os schemas fictícios demonstram validação dinâmica; a compatibilidade real foi
confirmada somente para o cenário de criação/consulta registrado acima.
Disponibilidade futura, outros payloads, semântica de atualização, entrega e
formatos financeiros reais ainda exigem a validação manual autorizada.
Schemas ficam limitados ao suporte do AJV instalado. Não há carrinho local,
IA, interpretação de linguagem natural, sessões coletivas, checkout ou rateio.

### Diagnóstico de falha após o callback

A mensagem `Autorização recebida. Volte ao terminal do FoodJam.` significa que
o listener recebeu um código e validou `state`. Ela é enviada **antes** da troca
por tokens. Não confirma autenticação, acesso ao MCP ou execução de `tools/list`.

A CLI agora imprime eventos `[ifood]` automaticamente, sem variável de debug ou
mudanças nos scripts. Para repetir o teste real, use o mesmo comando:

```bash
node --import tsx src/ifood/cli.ts
```

As etapas são independentes:

| Etapa | O que permite confirmar |
| --- | --- |
| `mcp_initial_connect` | Handshake inicial e eventual exigência de OAuth |
| `oauth_browser` | Abertura do navegador, sem imprimir a URL |
| `oauth_callback` | Recebimento do retorno local |
| `oauth_state_validation` | Validação de state antes de aceitar o código |
| `oauth_token_exchange` | `finishAuth(code)` e validação da resposta de tokens pelo SDK |
| `oauth_tokens_storage` | Tokens efetivamente salvos em memória pelo provedor |
| `mcp_reconnect` | Novo cliente/transporte usando os tokens obtidos |
| `tools_list` | Listagem e validação de ferramentas pelo SDK |
| `mcp_close` | Encerramento da sessão e recursos locais |

Eventos `http_response` mostram somente status, método, categoria (`mcp`,
`oauth_metadata` ou `oauth_token`), tipo de conteúdo de uma lista fechada e,
quando aplicável, método de autenticação do cliente. Não imprimem URL, headers,
cookies ou corpo. `401` inicial e `404` em discovery com fallback podem fazer
parte do fluxo normal; procure o evento `failed` e a etapa correspondente.

Falhas preservam nomes conhecidos como `InvalidGrantError`, `ZodError`,
`$ZodError`, `StreamableHTTPError` e `McpError`, sem message/stack/data/cause
originais. Códigos arbitrários do servidor são omitidos; códigos conhecidos
como `invalid_grant`, `invalid_client` e `ECONNRESET` podem ser exibidos.

O primeiro teste real relatado pelo responsável chegou ao callback, mas não
mostrou `Conectado` no terminal. O código anterior descartava o erro em dois
pontos: `client.ts` e novamente `cli.ts`. Esse defeito de diagnóstico foi
corrigido e coberto por regressão. A repetição com diagnóstico identificou
`oauth_token_exchange`, HTTP `401`, `invalid_client` e `client_secret_basic`.

| Falha observada no novo teste | Verificação necessária |
| --- | --- |
| `oauth_token_exchange` / `invalid_grant` | Validade e uso único do código, PKCE e callback exato; conferir no servidor sem divulgar valores |
| `oauth_token_exchange` / `invalid_client` | Cadastro e credenciais locais de Íris e método de autenticação aceito no token endpoint |
| `oauth_token_exchange` / `ZodError` | Compatibilidade da resposta do token endpoint com o schema do SDK; não compartilhar o corpo da resposta |
| `mcp_reconnect` / HTTP `401` ou `403` | Aceitação do token, resource/audience/scopes e permissões da conta/agente pelo MCP |
| `tools_list` / erro MCP ou schema | Suporte à operação e conformidade do resultado retornado pelo servidor |

Essas são verificações condicionais, não causas confirmadas. Os testes automatizados
reproduzem essas falhas com HTTP externo simulado e verificam que cada uma é
distinguível e não expõe dados sensíveis. O código de retomada foi conferido no
SDK instalado 1.32.1: após `UnauthorizedError`, aguardar callback, executar
`finishAuth(code)`, manter o mesmo provedor e conectar novas instâncias de
cliente/transporte. Nenhuma nova execução real foi feita pelo assistente.

### Método de autenticação no token endpoint

Inspeção pública diretamente pelo SDK 1.32.1 em **17/10/2026** confirmou
`token_endpoint_auth_methods_supported` com `client_secret_basic`,
`client_secret_post` e `private_key_jwt`. O SDK não escolhia Basic por ausência de
metadados: sem preferência em `clientInformation`, `selectClientAuthMethod`
prioriza Basic quando ambos os métodos com secret são anunciados.

O provider anterior declarava Basic em `clientMetadata` e retornava somente
identificadores/secret/issuer em `clientInformation`. Para um cliente
pré-cadastrado, mudar apenas `clientMetadata` não modifica a seleção desta
versão do SDK: `executeTokenRequest` consulta `clientInformation`.

A [implementação oficial do OpenCode consultada](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/mcp/oauth-provider.ts?plain=1)
declara POST em `clientMetadata` quando há secret. Esse trecho isolado não prova
o método efetivamente transmitido pelo OpenCode em uma execução anterior, pois
ele depende também da versão do SDK e das informações de registro do cliente.

O FoodJam agora declara `client_secret_post` nos dois objetos, incluindo os
metadados no retorno de `clientInformation`. Isso usa a preferência suportada
pelo seletor do SDK, sem editar dependências ou implementar tentativas de
métodos diferentes. O binding de issuer, PKCE S256, state, redirect URI e os
diagnósticos sanitizados foram preservados. A mesma preferência se aplica ao
refresh. Os mecanismos de retry existentes do SDK não alternam os métodos por
iniciativa do módulo.

Regressões com SDK real e HTTP externo simulado verificam o formulário
`application/x-www-form-urlencoded`, presença única de Client ID/Secret,
ausência de header Basic, uma única requisição de tokens no fluxo de sucesso,
PKCE/redirect URI e diagnóstico `clientAuthMethod: client_secret_post`. Há
também cobertura do formulário de refresh, incluindo caracteres que precisam
de encoding. Nenhuma credencial real é usada nos testes.

**A mudança corrige a escolha do método; ainda não confirma a causa definitiva
do `invalid_client` de Íris por si só.** Após o ajuste para POST, o responsável
repetiu a autenticação real no Mac e confirmou a conexão e descoberta das
ferramentas. Esse resultado é compatível com a hipótese de incompatibilidade do
método Basic para o cadastro utilizado; não é uma garantia sobre todas as contas
ou configurações do servidor. A IF-01 está validada para o cenário manual testado.

## API pública

```ts
import { createIfoodMcpClient, readIfoodMcpConfig } from './ifood/index.js';

// O chamador carrega seu ambiente explicitamente, se necessário.
const config = readIfoodMcpConfig();
const client = createIfoodMcpClient(config);

try {
  const server = await client.connect();
  const tools = await client.listTools();
  // Use server e tools para inspecionar as capacidades reais do serviço.
  void server;
  void tools;
} finally {
  await client.close();
}
```

- `readIfoodMcpConfig(env?: NodeJS.ProcessEnv): IfoodMcpConfig`.
- `createIfoodMcpClient(config, options?): IfoodMcpClient`; a opção `openBrowser`
  permite fornecer um abridor de navegador, sem imprimir/gravar a URL OAuth;
  `onDiagnostic(event)` recebe os eventos seguros, sem logging automático na biblioteca.
- `connect(): Promise<IfoodMcpServer | undefined>`; chamadas simultâneas
  compartilham a inicialização, e chamadas após a conexão retornam os metadados.
- `listTools(): Promise<IfoodMcpTool[]>`; exige conexão ativa, preserva descrição,
  inputSchema e campos adicionais, como annotations e outputSchema.
- `callReadTool(name, args): Promise<IfoodMcpReadResult>`; exige autenticação,
  allowlist, presença no catálogo e argumentos compatíveis com o schema real.
- `callCartTool(name, args): Promise<IfoodMcpCartResult>`; mantém a política da
  IF-03, com `allowCartMutations: true` exigida para suas cinco mutações.
- `callPaymentOrderTool(name, args): Promise<IfoodMcpPaymentOrderResult>`; permite
  somente as quatro ferramentas da IF-04 e exige `allowPaymentConfiguration: true`
  para `setCartPayment`. Nunca permite `submitOrder`.
- `close(): Promise<void>`; após fechar, crie outra instância para reconectar.

Esses tipos não expõem o transporte MCP. Nenhum contrato compartilhado do core
foi alterado e o core não precisa importar tipos do SDK.

## Testes e verificações

Na entrega da IF-04, `npm run check` passou com **436 testes em 17 arquivos**:
os **337 testes anteriores** foram preservados e **99 novos casos** cobrem a
API/CLI de pagamento e acompanhamento e o SDK com HTTP simulado. `npm run build`
e `git diff --check` também passaram. Nenhum resultado de teste simulado deve
ser interpretado como validação no iFood real.

```bash
npm test -- tests/ifood
npm run lint
npm run typecheck
npm test
npm run build
```

Os testes usam doubles do cliente/transporte e fetch externo simulado. Há também
testes com o SDK v1 real sobre respostas HTTP simuladas para verificar discovery,
PKCE, autenticação de cliente, callback e reconexão. O callback usa rede apenas
em loopback. Nenhum teste automatizado acessa o iFood, cria carrinhos ou compra.
Uma importação em processo isolado, sem ambiente, rejeita tentativas de rede,
abertura de listener ou execução de navegador.

Existe uma asserção de tipo localizada na fronteira `Client.connect`: no SDK
1.32.1 o getter `sessionId` do transporte retorna `string | undefined`, enquanto
a interface `Transport` declara `sessionId?`. Essa divergência com
`exactOptionalPropertyTypes` foi isolada sem relaxar o tsconfig e é exercitada
pelos testes com o SDK real.

## Estado da validação e limitações

Em **17/10/2026**, foram confirmados sem credenciais:

- endpoint acessível; GET responde `405`, e o initialize sem token responde `401`;
- metadados RFC 9728 em
  `https://consumer-mcp.ifood.com.br/.well-known/oauth-protected-resource/marketplace`;
- AS anunciado: `https://id.ifood.com.br`;
- discovery diretamente pelo SDK 1.32.1, incluindo fallback OIDC;
- authorize `https://id.ifood.com.br/authorize`, token `https://id.ifood.com.br/token`,
  PKCE S256 e autenticação com secret nos metadados públicos.

**Conexão autenticada e descoberta real validadas manualmente no Mac em
17/10/2026 pelo responsável**, conforme relato de conclusão nesta tarefa. A CLI
completou OAuth com `client_secret_post` e mostrou nomes, descrições e schemas
das ferramentas do MCP do iFood. A validação foi realizada pelo responsável
com suas credenciais locais; o assistente não executou esse fluxo autenticado.

O bloqueio anterior era HTTP `401` / `invalid_client` na troca do código usando
Basic. Após a preferência por POST, o novo teste real foi bem-sucedido. Nenhuma
operação comercial faz parte do cliente de descoberta.

A quantidade e os nomes efetivamente retornados não foram fornecidos ao
assistente; este documento não inventa um catálogo nem trata fixtures de teste
como ferramentas reais. A fonte da verdade continua sendo `tools/list` no
servidor. Para repetir a verificação, siga o procedimento de descoberta manual.
Não versionar credenciais, tokens, códigos, cookies ou URLs OAuth com query.
Erros de redirect exigem conferir o cadastro exato; não mudar a configuração do
portal sem autorização.

Esta versão requer um navegador e callback no mesmo computador; não implementa
autenticação pública, remota ou multiusuário. Credenciais não persistem entre
execuções. A política de binding assume o AS oficial observado. Compatibilidade
foi exercitada somente com o usuário/agente e as permissões do teste manual no
Mac; outras contas, permissões e plataformas não foram validadas nesta entrega.

Na **IF-02**, o responsável confirmou manualmente em **17/10/2026** a execução
real de `getUser` no Mac: OAuth, descoberta, HTTP `200`, `tools_read: succeeded`
e fechamento da conexão. A pré-verificação da **IF-03** também validou
`listAddresses`, `getMerchant` e `getItem` para o usuário de teste; as outras
três consultas permanecem cobertas somente por mocks. A validação real da IF-03
incluiu uma criação autorizada por `createCart` e a consulta posterior por
`getCart`, com exatamente um Tradicional One, quantidade 1, HTTP `200`,
`tools_cart: succeeded` e saída `0`. As outras cinco operações de carrinho
permanecem testadas somente por mocks. Nenhum identificador privado ou payload
real foi versionado, e não houve checkout, pagamento ou submissão de pedido.

Na **IF-04**, o responsável confirmou a leitura real de `listPaymentMethods`
no Mac em **17/10/2026**: OAuth com `client_secret_post`, troca de tokens e
consulta com HTTP `200`, descoberta concluída, `tools_payment_order: succeeded`,
saída `0` e conexão encerrada. `annotation_mismatch` foi observado e permaneceu
informativo. `setCartPayment`, `getOrder` e `trackOrder` continuam cobertas
somente por testes simulados; não houve pagamento, checkout ou pedido.

## Acesso MCP versus autorização de compra

OAuth autoriza acesso do agente às capacidades oferecidas pelo serviço. Não é
uma autorização explícita para fechar um pedido. Essa decisão pertence ao core,
deve ser validada para a sessão/pedido e depende da confirmação da pessoa
responsável. Listar `ifood_submitOrder`, se o servidor o retornar, não o executa
nem autoriza compra. A IF-01 implementou descoberta; a IF-02 permite somente as
consultas explicitamente aprovadas; a IF-03 permite as operações de carrinho
da allowlist, exigindo decisão explícita da aplicação para mutações. Nenhuma
dessas APIs anteriores habilita checkout, pagamento ou submissão de pedido.
A IF-04 habilita configuração de pagamento somente por sua opção independente;
submissão/checkout continuam indisponíveis até a integração futura com o Core.

Referência do SDK: [clientes e OAuth na documentação oficial v1](https://ts.sdk.modelcontextprotocol.io/client).
