# IF-05 — catálogo e fronteira com o Core

A integração real atual usa portas por fase e está documentada em
[INTEGRATION-HANDOFF.md](INTEGRATION-HANDOFF.md). Este arquivo preserva a
preparação da fábrica estrita createIfoodCatalog, que continua disponível.


Branch `feat/ifood-mcp`, HEAD base `dd8587e`. **IF-05 aberta, não homologada.**
A referência atual do Core, após git fetch, é `a806159`; não houve merge,
rebase ou alteração de Core, Telegram, contratos compartilhados ou src/index.ts.

## Evidências reais e limites

As inspeções 04/05 foram executadas autonomamente sob autorização explícita de
leitura. Evidências atuais, paginação e bloqueios externos em
[INSPECTION-04-05.md](INSPECTION-04-05.md). As inspeções anteriores abaixo são
históricas. Não se versionam respostas, coordenadas, endereços ou IDs reais.

- Relatório 01: discovery de 23 ferramentas, listAddresses({}) com isError false.
  ID, formattedAddress e coordinates no mesmo registro da conta.
- Relatório 02: uma searchOffers com isError false e três estabelecimentos.
  Argumentos usaram exatamente a localização comprovada do relatório 01.
- Em ambos, structuredContent coincide com o JSON de content[0].text.
- A busca retornou hasMore false e nextPageToken null para aquele termo/filtro.
  Isso não homologa paginação de outros termos ou de cardápios.
- Campos monetários numéricos foram observados, mas não moeda/unidade de saída.
  BRL documentado em filtros de entrada não prova unidade dos valores retornados.
- Relatório 03: listAddresses/getMerchant/browseOffers com isError false e
  structured/text concordantes. GetMerchant trouxe deliveryMethods vazio;
  três produtos de browseOffers têm merchant.merchantId correto, mas não
  disponibilidade explícita. Auditoria em [INSPECTION-03.md](INSPECTION-03.md).
- Os schemas coletados dessas ferramentas não contêm outputSchema.

O vínculo de localização é comprovado pelos argumentos da busca. Distância e
entrega aparecem no resultado, mas isso não é comprovação independente de área
de entrega, preço final ou confirmação comercial do destino.

## API preparada

`createIfoodCatalog(client, options)` reutiliza callReadTool, OAuth/transporte e
discovery existentes. Importar/criar não conecta. Options: moneyUnit obrigatório
(`BRL` ou `cents`, somente depois de comprovar a unidade dos campos), fábrica
storeNotFoundError e maxPages opcional de 1 a 100 (padrão 20).

| Método | Comportamento |
| --- | --- |
| listSavedAddresses() | Lista opções `{ id, formatted }` da conta; não escolhe nem confirma destino |
| searchStores(query, address) | Resolve destino confirmado por ID/texto e busca apenas MERCHANT/RESTAURANT |
| getMenu(storeId, address) | Confere loja e navega ITEM/RESTAURANT com refinements.merchantId |
| getStore(storeId, address) | Extensão via getMerchant; só entrará na CatalogPort com aprovação da Ana Paula |

Os dois métodos preparados têm compatibilidade estrutural de assinatura,
mas **CatalogPort completa não está implementada**: faltam validateAddress(text) e quoteOrder(storeId,
items, address), agora obrigatório e retornando serviceFeeCents. Não há
validação de texto ou cotação arbitrária comprovadamente de leitura. Não usar cast para
entregar o objeto incompleto a criarAgente.

Não se copiaram Store, MenuItem, DeliveryAddress, CatalogPort ou a classe
StoreNotFoundError do Core. São validadores locais de wire, com saída inferida.
Na composição, injetar `storeNotFoundError: id => new StoreNotFoundError(id)` com
a classe real exportada pelo Core; um erro homônimo não satisfaz instanceof.
A forma `{ merchantId, found: false }` continua caso candidato simulado, não
resposta real homologada. Falha de rede/permissão/isError nunca vira loja ausente.

## Campos de estabelecimento observados

Caminhos relativos ao documento JSON decodificado da busca:

| Campo | Tipo observado | Uso |
| --- | --- | --- |
| results[].merchantId | string | ID original, sem normalização |
| results[].merchantName | string | Nome original |
| results[].isOpen | boolean | Abertura explícita |
| results[].deliveryMethod.fee | number | Frete candidato, unidade ainda pendente |
| results[].deliveryMethod.promotionalFee | number | Preservado; precedência comercial não comprovada |
| results[].minimumOrderAmount | number | Mínimo opcional na saída Core, quando informado |
| results[].straightLineDistanceKm | number | Evidência auxiliar; não inferir área de entrega |
| hasMore / nextPageToken | boolean / null nesta amostra | Paginação da consulta |
| resultKind / interpretedQuery / agentHints | string / string / object | Metadados preservados, sem executar instruções |

O mapeamento de frete exige fee explícito. Se promotionalFee informado divergir,
rejeita com delivery_fee_unconfirmed: esta amostra só observou valores iguais
e não comprova qual se aplica ou sob quais condições. Não escolhe promoção,
não usa zero como default e não deduz benefício. GetMerchant inspecionado usa deliveryMethods (array vazio), sem taxa
aplicável nesta amostra. A extensão getStore continua bloqueando com
delivery_fee_unconfirmed em vez de preencher frete. GetMenu confirma só
identidade/estado operacional da loja antes de consultar os itens.

Conversão financeira continua decimal por BigInt, sem arredondamento: BRL com
até duas casas, centavos somente inteiros, saída não negativa e inteira segura.
Sem unidade comprovada, a inspeção não define moneyUnit e não converte os
valores reais. Números JSON já imprecisos não podem ser recuperados; prefira
strings exatas quando disponíveis. Não atribuir unidade pela aparência.

## Endereços e metadados

ListAddresses real usa results[].addressId (string), formattedAddress (string)
e coordinates.latitude/longitude (number), no mesmo registro. A saída pública
usa formatted, copiando formattedAddress, sem reconstruir texto por heurística.

Listar opções não confirma endereço, mesmo com uma única opção ou hints de
uso anterior. O organizador deve escolher/confirmar pelo fluxo integrador. Em
cada consulta o adaptador captura id/texto antes do await, relê listAddresses,
confere correspondência exata e coordenadas válidas. Não há localização fixa,
primeiro endereço automático, fuzzy matching ou cache compartilhado de destino.
Texto sem ID, dados ausentes, IDs duplicados, texto divergente ou listagem de
endereços incompleta bloqueiam com address_resolution_required.

AgentHints e metadados adicionais são aceitos e ignorados para decisões. Nunca
substituem confirmação, consentimento, filtros, autorização ou política local.
A normalização/geocodificação de texto livre e o eventual cadastro seguem o
fluxo separado proposto em [ADDRESS-FLOWS.md](ADDRESS-FLOWS.md).

## Envelope, paginação e cardápio

Aceita structuredContent ou JSON em um bloco content[].text. Havendo ambas as
fontes JSON, devem concordar. Sem estrutura, textos múltiplos são ambíguos.
Não combina documentos, não procura campos/IDs recursivamente. Texto até 1 MiB,
até 100 blocos; isError true falha, nunca vira array vazio.

Resultados e flags essenciais são estritos; metadados adicionais são aceitos.
HasMore true exige nextPageToken não vazio; hasMore false com token não vazio
é contraditório. Campos alternativos de paginação ainda não mapeados (nextCursor,
hasNextPage, cursor, pageInfo, pagination) bloqueiam em vez de indicar fim.
ResultKind, quando informado, deve corresponder à operação esperada.

Página vazia com continuação é percorrida; tokens são encaminhados intactos.
Ciclo, limite, falha de página ou duplicatas de IDs com dados públicos conflitantes
rejeitam toda a consulta. Nenhuma lista parcial é apresentada como completa.

BrowseOffers exige merchantType e usa refinements.merchantId, não merchantId na
raiz. O filtro do servidor não é prova suficiente: cada item deve declarar o
merchantId solicitado. A CLI também verifica esse vínculo sem unidade monetária.
GetItem compara merchantId e itemId pedidos com os retornados antes de converter.
A inspeção 03 confirmou itemId/itemName, unitPrice/promotionalUnitPrice e
merchant.merchantId aninhado. A raiz histórica merchantId continua aceita, mas
quando ambas as associações existem precisam concordar. Available não veio
na amostra: mapMenuItem rejeita availability_unconfirmed, sem deduzir estoque
da presença na lista. Promoção de preço divergente falha item_price_unconfirmed.
Não inferir active como available nem preencher preço por outro campo.

GetItem retornou itemDescription, agora normalizado como description. Não
resolveu disponibilidade nem unidade; valores originais continuam preservados.
A continuação real de browseOffers foi observada em duas páginas na inspeção 05.
Não foi comprovado se browseOffers inclui todo o cardápio, inclusive itens
indisponíveis. Percorrer todas as páginas de ofertas não basta para comprovar
completude. Opções obrigatórias, categoria e características alimentares também
precisam de evidência; não certificar dieta por nome ou descrição.

## Inicialização e exemplo sem segredos

Carregar dotenv explicitamente na aplicação quando necessário. Configuração:
IFOOD_MCP_CLIENT_ID, IFOOD_MCP_CLIENT_SECRET, IFOOD_MCP_CALLBACK_URL (loopback com
porta fixa cadastrada) e IFOOD_MCP_ENDPOINT. OAuth local interativo com PKCE/state,
client_secret_post, tokens só em memória; não é autenticação pública multiusuário.

Exemplo após homologação do perfil e integração coordenada das branches:

```ts
import { createIfoodMcpClient, createIfoodCatalog, readIfoodMcpConfig } from './ifood/index.js';
import { StoreNotFoundError } from './core/index.js';
import type { CatalogPort, DeliveryAddress } from './core/index.js';

async function consultar(address: DeliveryAddress, moneyUnit: 'BRL' | 'cents', query: string) {
  const client = createIfoodMcpClient(readIfoodMcpConfig());
  try {
    await client.connect();
    const catalog = createIfoodCatalog(client, {
      moneyUnit, storeNotFoundError: id => new StoreNotFoundError(id),
    });
    const reads: Pick<CatalogPort, 'searchStores' | 'getMenu'> = catalog;
    const stores = await reads.searchStores(query, address); // endereço já confirmado
    return stores;
  } finally {
    await client.close();
  }
}
```

Na composição persistente, conectar uma vez por ciclo do consumidor e fechar no
desligamento. Close é terminal/idempotente; criar outro cliente para reconectar.
Catálogo não se apropria da conexão. Troca de destino exige invalidação do
retrato no Core. Não compartilhar credenciais entre consumidores.

Erros IfoodCatalogError usam códigos fixos, sem IDs, destino, consulta ou cause
remota. Incluem invalid_input/config/data/envelope, read_failed, tool_failed,
merchant_scope_mismatch, item_scope_mismatch, availability_unconfirmed,
item_price_unconfirmed, pagination_cycle/limit,
conflicting_duplicate, invalid_address, address_resolution_required e
delivery_fee_unconfirmed. Usar onDiagnostic para diagnósticos seguros do cliente;
não imprimir exceções arbitrárias, argumentos ou respostas.

## API existente: carrinho, pagamento e pedidos

Toda execução exige conexão/autenticação, ferramenta única no catálogo e
argumentos de acordo com seu schema corrente. Estar em `listTools()` não
concede autorização de execução. As allowlists IF-02–04 permanecem intactas.

| API | Ferramentas permitidas | Habilitação adicional |
| --- | --- | --- |
| `callReadTool(name, args)` | `getUser`, `listAddresses`, `browseOffers`, `searchOffers`, `getRecommendations`, `getMerchant`, `getItem` | Nenhuma; não autoriza divulgar dados |
| `callCartTool(name, args)` | `getCart`, `getCartDeliveryMethods` | Nenhuma |
| `callCartTool(name, args)` | `createCart`, `addItemToCart`, `updateCartItem`, `removeItemFromCart`, `setCartDelivery` | `allowCartMutations: true` ao criar o cliente |
| `callPaymentOrderTool(name, args)` | `listPaymentMethods`, `getOrder`, `trackOrder` | Nenhuma; leituras sensíveis |
| `callPaymentOrderTool(name, args)` | `setCartPayment` | `allowPaymentConfiguration: true`, independente do carrinho |
| Submissão | `submitOrder` | **Indisponível em todas as APIs**, sem habilitação nesta tarefa |

Para usar carrinho, o integrador obtém IDs reais de estabelecimento/produto e
endereço autorizado; confere schemas com `listTools()`; habilita mutações apenas
em código confiável; chama `createCart` com argumentos válidos; retém o `cartId`
real em armazenamento privado associado ao consumidor/sessão/loja; usa esse ID
em `getCart` e nas alterações subsequentes. Não confundir `itemId` com
`cartItemId`; não procurar qualquer UUID da resposta como se fosse `cartId`.
`getCartDeliveryMethods` consulta opções reais; o integrador seleciona e usa
`setCartDelivery` somente quando autorizado. Um carrinho MCP é associado a um
estabelecimento; propostas do Core com duas lojas exigirão carrinhos separados
e coordenação do time, não mistura automática de produtos. Por decisão oficial,
os custos compartilhados de cada loja pertencem somente aos participantes
daquela loja. Esta camada não calcula a distribuição.

Pagamento: consultar `listPaymentMethods` com argumentos reais; selecionar na
aplicação; só configurar via `setCartPayment` se habilitado e autorizado.
Não resolver a divergência UUID/nome de método inventando identificadores.
Pedidos: `getOrder` e `trackOrder` usam o pedido informado pelo chamador;
`trackOrder` faz uma página por chamada e não inicia polling. Respostas dessas
APIs continuam opacas, preservando `isError`/metadados/valores sem conversão.
Conferir `isError` antes de processar. Não publicar cartões, endereços,
documentos, tokens ou códigos de verificação no Telegram/logs.
Os exemplos e procedimentos detalhados das IF-01–04 estão no [README](README.md).

## Limitações e composição final

A decisão oficial de orçamento é produtos + parcela do frete + taxas - descontos
aplicáveis. Duas lojas usam dois carrinhos; custos compartilhados por loja somente
entre seus participantes. O Core implementa essas regras; o adaptador não calcula
orçamento, rateio, negociação ou descontos.

Benefícios anteriores vieram sem decomposição suficiente e o total mudou entre
createCart/getCart. Não reconstruir promoções, subtrair benefício duas vezes ou
atribuir descontos a participantes nesta camada. StoreOrder ainda depende da
reconciliação de taxa de serviço/benefícios com o Core em atualização.

SubmitOrder permanece indisponível. AuthorizedOrder sozinho não permite compra:
é necessário vincular organizador autorizado, consumidor/destino/loja, cartId
real, itens/opções/quantidades, pagamento, taxas, descontos e total atual revisado
à confirmação comercial explícita e válida. Mudança invalida confirmação; chave
de idempotência e registro durável devem prevenir repetição após timeout/reinício.
Nada disso foi habilitado nesta IF-05.

Próximos passos: executar o [roteiro manual](CATALOG-VALIDATION.md), conferir
getMerchant/browseOffers/getItem e paginação real; comprovar unidades, precedência
de frete e disponibilidade; ajustar somente os mapeamentos sustentados por
respostas reais sanitizadas. Ana Paula decide getStore na porta e a proposta de
fluxos de endereço; composição final e autenticação por consumidor continuam
separadas. Não ligar CatalogPort incompleta ao Core por coerção de tipos.

## Validação

As IF-01–04 têm evidências históricas no README, incluindo conexão/discovery,
getUser, preflight de endereço/loja/item, createCart/getCart e listPaymentMethods.
Esta revisão reprocessou arquivos privados 01/02/03. O replay local passou no
vínculo de endereço/estabelecimentos e na associação aninhada dos três produtos;
registrou disponibilidade ausente e unidade não comprovada.
Testes usam somente fixtures fictícias, preservando a suíte IF-01–04, com novos
casos para campos reais, metadados, continuidade contraditória, escopo sem moeda
e listagem de opções sem seleção. Resultados de check/build/diff check no plano.
A revisão anterior passou com 550 testes. Os resultados desta auditoria estão
no plano, incluindo novas regressões de campos/escopo e paginação opt-in.
Nenhum bug bloqueante foi encontrado pela revisão independente.
