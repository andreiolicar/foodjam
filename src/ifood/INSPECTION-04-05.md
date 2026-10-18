# IF-05 — leituras reais 04/05 e bloqueios de homologação

IF-05 permanece aberta. Execução autônoma de leitura autorizada pelo responsável,
sem mutações. Branch feat/ifood-mcp; HEAD dd8587e preservado. Após git fetch,
Core consultado por git show em origin/main a806159bb05a46dfd3a3d452f29a5134b21a045a.
Nenhum arquivo do Core foi copiado ou alterado.

## Execução e cobertura

As duas conexões autenticaram, descobriram 23 ferramentas e encerraram. Não foi
necessária intervenção humana. Tokens continuaram somente em memória. As nove
respostas de ferramentas tiveram isError false e structuredContent idêntico ao
JSON de content[0].text. Nenhum segredo foi incluído nos relatórios.

| Leitura | Quantidade nesta execução |
| --- | ---: |
| listTools | 2 |
| getItem | 3 |
| browseOffers | 3 páginas no mesmo estabelecimento |
| listAddresses | 1 |
| getMerchant | 1 |
| searchOffers com resultKind ITEM | 1 |
| Total de leituras lógicas, incluindo discovery | 11 de 20 autorizadas |

Relatórios integrais 04/05, plano 05 e replay local ficam somente no diretório
privado ~/.local/share/foodjam-validation, fora do Git, arquivos modo 600 e
diretório 700. Não imprimir, compartilhar ou usar esses dados como fixtures.
O replay de 05 não efetuou rede e não entra no contador de leituras remotas.
Nenhuma ferramenta de carrinho/pagamento/pedido foi executada nesta etapa.

## Campos comprovados, sem dados pessoais

| Origem e caminho | Tipo e constatação |
| --- | --- |
| listAddresses.results[].addressId / formattedAddress | string; ID e texto no mesmo registro |
| listAddresses.results[].coordinates.latitude / longitude | number; localização do registro confirmado anteriormente |
| getItem.itemId / merchantId / merchantName / itemName | string; IDs correspondem aos solicitados e aos itens listados |
| getItem.itemDescription | string; nome real da descrição, agora reconhecido |
| getItem.unitPrice / promotionalUnitPrice / merchantMinimumOrderAmount | number; unidade monetária de saída não documentada |
| getItem.optionGroups | array vazio nos três itens; não prova estrutura de grupos não vazios |
| getItem.agentHints / appDeeplink | metadados presentes; não autorizam ações |
| browseOffers.results[].itemId / itemName | string |
| browseOffers.results[].merchant.merchantId | string; todos os itens pertencem ao estabelecimento solicitado |
| browseOffers.results[].unitPrice / promotionalUnitPrice | number; coincidem com getItem para os mesmos produtos |
| browseOffers.hasMore / nextPageToken | boolean e string ou null; continuação real observada |
| getMerchant.deliveryMethods | array vazio novamente; não há frete utilizável para Store |
| searchOffers ITEM.results[].itemEan | string adicional legítima; não mapeada para o Core |
| facetas maxItemPrice | intervalos numéricos, sem moeda/escala explícita da saída |

O endereço foi relido e associado por ID/texto/coordenadas ao mesmo registro.
As consultas usaram essa localização; isso comprova o contexto enviado, não uma
garantia independente de entrega/comercialização. Os nomes e valores reais não
foram copiados para código/documentação/fixtures.

GetItem e browseOffers não retornaram available ou outro indicador explícito de
disponibilidade dos produtos. IsOpen pertence à loja e não resolve esse campo.
Descrição oficial de getItem afirma que itens indisponíveis não são retornados.
Não inferir available true de uma leitura bem-sucedida, nem false de erro.
Não houve atributos alimentares/categoria explícitos homologáveis nas amostras.

Os preços base/promocionais coincidiram entre detalhe e listagem e entre si.
Isso confirma consistência nesta amostra, não BRL versus centavos, desconto
efetivo ou precedência quando os valores divergem. Nenhum outputSchema foi
fornecido para as quatro ferramentas de catálogo. BRL consta nos filtros de
entrada, não na documentação dos campos financeiros retornados.

## Paginação observada

A inspeção 04 retornou três itens, hasMore false e token null. Na inspeção 05,
pageSize 2 retornou dois itens, hasMore true e token opaco. A próxima consulta
preservou filtros/localização e reutilizou exatamente esse token: um item,
hasMore false e token null. Os três IDs são únicos e coincidem com os da 04;
todos os merchantId foram conferidos. Nenhum cursor foi inventado.

São três páginas remotas de browseOffers neste ciclo, respeitando o limite do
responsável. Continuação e término estão validados para esta amostra de uma
loja. Isso não homologa todas as lojas, indisponíveis, ciclos ou promoções reais.
Os casos adversos permanecem cobertos offline. Não repetir páginas sem nova
hipótese útil; o limite de 20 é teto, não obrigação de consumir chamadas.

## Correções e regressões

- Reconhecer itemDescription e conservar description legado; conflito explícito
  entre ambos falha. Preços originais preservados, sem escolher promoção.
- Diagnóstico de getItem agora informa disponibilidade não comprovada mesmo
  sem unidade. Ausência continua bloqueando mapMenuItem.
- CLI decide o perfil por args.resultKind. Antes, searchOffers ITEM era
  indevidamente lida como MERCHANT e marcava invalid_data. O relatório 05 bruto
  foi preservado; replay offline com a correção terminou sem falha de perfil
  estrutural, mantendo unit_unconfirmed e disponibilidade não comprovada.
- Fixtures com todos os valores substituídos reproduzem envelopes concordantes,
  campos, associação, falta de disponibilidade e continuação. Nenhum teste
  automatizado acessa MCP/OAuth real.

## Compatibilidade com o Core atual e decisões externas

CatalogPort agora exige quatro métodos: validateAddress, searchStores, getMenu
e quoteOrder(storeId, items, address), retornando serviceFeeCents. Compilação
virtual em memória contra os contratos de a806159 confirma compatibilidade de
assinatura apenas de Pick<CatalogPort, 'searchStores' | 'getMenu'>. Não comprova
semântica de menu completo nem unidades. A porta completa NÃO é implementada;
não integrar com cast nem adicionar resultados fictícios.

1. Provedor: documentar moeda/escala dos preços, frete e mínimo, precedência de
   promoções e fornecer disponibilidade/completude de cardápio. O getItem atual
   omite indisponíveis; não satisfaz sozinho o getMenu inclusivo do Core.
2. Ana Paula + integração: decidir como fornecer catálogo incompleto/de ofertas
   ao Core ou obter uma fonte oficial que satisfaça o contrato atual. Ausência
   de disponibilidade não será convertida em boolean inventado.
3. Endereço manual: nenhuma ferramenta independente comprovadamente de leitura
   valida texto. CreateAddress geocodifica/cadastra e permanece proibida. Separar
   aquisição, consentimento de escrita quando necessário e confirmação, conforme
   ADDRESS-FLOWS.md. Não devolver sucesso fictício de validateAddress.
4. QuoteOrder: discovery não apresentou cotação de serviço somente leitura para
   uma combinação arbitrária de itens. GetCart lê um carrinho já conhecido;
   não cota sozinho uma proposta nova. Criar/alterar carrinhos continua proibido
   nesta tarefa. Decidir com Ana Paula um contrato/fluxo de cotação autorizado,
   incluindo loja, itens/opções/quantidades/destino e validade dos totais. Não
   implementar serviceFeeCents zero como substituto de dado ausente.
5. GetStore permanece extensão; nesta amostra bloqueia por frete ausente.
   Entrada na CatalogPort depende da Ana Paula. Benefícios financeiros continuam
   sem decomposição comprovada; orçamento/rateio ficam no Core. SubmitOrder
   permanece indisponível, sem mudança de política ou permissão.

Não há nova consulta de leitura identificada no catálogo descoberto que resolva
essas lacunas documentais/semânticas. A investigação encerra neste bloqueio
externo, sem consumir o restante do teto com repetições. Tecnicamente ainda não
está pronta para integração integral. Após resolver essas decisões, repetir a
validação do perfil ajustado e só então compor cliente/porta no módulo da equipe.

## Verificação local da entrega

Npm run check aprovado: lint, tipos e 573 testes em 21 arquivos. Sete regressões
novas nesta etapa; testes anteriores preservados. Npm run build e git diff
--check aprovados, incluindo verificação separada do whitespace dos arquivos
novos ainda não rastreados. Compilação virtual contra o Core atual sem erros.
Revisão independente somente leitura: nenhum achado bloqueante ou importante.
Inspeção de 67 arquivos versionáveis sem credenciais configuradas, marcadores
de credencial de alta confiança ou literais privados extraídos das evidências.
Relatórios/plano/replay privados com modo 600, diretório 700. Sem alterações
fora de src/ifood e tests/ifood no repositório; sem commit, push, PR ou merge.
