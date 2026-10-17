# FoodJam — integração MCP do iFood (IF-01 e IF-02)

Responsável: Andrei. Branch: `feat/ifood-mcp`. **Íris** é o nome do agente
cadastrado no portal; o produto e o cliente MCP se chamam **FoodJam**.

**IF-01 validada manualmente no Mac em 17/10/2026**, conforme confirmação do
responsável: a CLI autenticou no MCP do iFood e apresentou nomes, descrições e
schemas reais das ferramentas. O fluxo utilizado foi OAuth `authorization_code`
com `client_secret_post`, PKCE S256 e validação de state.

Este módulo implementa conexão explícita, OAuth interativo para um usuário de
teste, descoberta de ferramentas e execução restrita de consultas de leitura.
Não interpreta conversas, calcula rateios, controla sessões do core ou executa
operações comerciais de escrita. A composição com o
core/Telegram continua a cargo de `src/index.ts`, sem alterações nesta entrega.

A IF-02 estende a IF-01 sem reconstruir autenticação/transporte. Os sete nomes
reais sem prefixo foram confirmados pelo responsável a partir de `listTools()`;
schemas continuam dinâmicos. **A leitura real `getUser` foi validada manualmente
no Mac em 17/10/2026**, conforme confirmação do responsável: autenticação OAuth,
descoberta do catálogo, HTTP `200`, evento `tools_read: succeeded` e encerramento
correto da conexão. Os testes automatizados usam HTTP/doubles locais; a validação
manual não foi estendida às outras seis ferramentas de leitura nesta entrega.

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
é o único caminho de execução exposto. Exige conexão aberta e tokens em memória.
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

Todo nome fora da allowlist é bloqueado em código antes de `tools/call`,
independentemente de instruções do modelo ou annotations do servidor. Isso
inclui `createCart`, `addItemToCart`, `updateCartItem`, `removeItemFromCart`,
`createAddress`, `setCartPayment`, `submitOrder` e quaisquer novas operações de
escrita. Não há executor MCP irrestrito público, wrappers de carrinho, checkout,
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
foi salvo no repositório. As outras seis ferramentas permanecem sem validação
manual nesta tarefa.

Os testes automatizados não acessam o iFood. A autenticação continua sendo de
desenvolvimento, para um usuário, sem persistência entre execuções, com o
navegador e callback no mesmo computador. O módulo depende da semântica de
leitura dos nomes explicitamente aprovados; não audita a implementação interna
do servidor nem libera outros nomes com base em descrições ou hints.

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
- `close(): Promise<void>`; após fechar, crie outra instância para reconectar.

Esses tipos não expõem o transporte MCP. Nenhum contrato compartilhado do core
foi alterado e o core não precisa importar tipos do SDK.

## Testes e verificações

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
e fechamento da conexão. Essa validação se limita a essa consulta e ao usuário
de teste; não inclui execução real das demais ferramentas ou operações de escrita.

## Acesso MCP versus autorização de compra

OAuth autoriza acesso do agente às capacidades oferecidas pelo serviço. Não é
uma autorização explícita para fechar um pedido. Essa decisão pertence ao core,
deve ser validada para a sessão/pedido e depende da confirmação da pessoa
responsável. Listar `ifood_submitOrder`, se o servidor o retornar, não o executa
nem autoriza compra. A IF-01 implementou descoberta; a IF-02 permite somente as
consultas explicitamente aprovadas, sem carrinho ou checkout.

Referência do SDK: [clientes e OAuth na documentação oficial v1](https://ts.sdk.modelcontextprotocol.io/client).
