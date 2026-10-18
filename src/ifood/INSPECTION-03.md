# IF-05 — auditoria sanitizada da inspeção 03

IF-05 aberta. O responsável executou a inspeção no Mac; esta auditoria somente
leu/reprocessou arquivos privados, sem novas chamadas MCP. A referência local
origin/main é 9b0debb; contracts.ts e ports.ts foram lidos via Git, sem fetch,
sincronização ou alterações no Core/Telegram/composição.

## Execução observada

| Ferramenta | Resultado |
| --- | --- |
| listAddresses | Resposta presente, isError false |
| getMerchant | Resposta presente, isError false, ID corresponde ao solicitado |
| browseOffers | Resposta presente, isError false, três produtos |

As três respostas aparecem em structuredContent e content[0].text como JSON
concordante. Não há falha de chamada registrada. O relatório não contém trilha
OAuth/HTTP completa; não se deduz código HTTP ou detalhes da troca de tokens.
O invalid_data anterior do perfil de browseOffers era falha da interpretação de
vínculo aninhado, não erro MCP nem lista vazia.

## Campos de getMerchant

| Caminho no documento decodificado | Tipo/estado |
| --- | --- |
| $.merchantId / $.merchantName | string |
| $.merchantType | string |
| $.isOpen | boolean |
| $.operatingHours.today / $.operatingHours.weekly | array / object |
| $.minimumOrderAmount | number, unidade não comprovada |
| $.deliveryMethods | array vazio nesta resposta |
| $.catalogSummary.totalItems | number, contagem coincide com três itens da amostra |
| $.straightLineDistanceKm | number |
| $.agentHints / $.catalogSummary.navigationHint | object / string, não são autorização |

Não existe deliveryMethod singular nem taxa utilizável nessa resposta. Não
converter array vazio em entrega grátis nem selecionar um método fictício.
A extensão getStore continua disponível, mas falha delivery_fee_unconfirmed
sem taxa comprovada. Consultar menu só exige identidade operacional da loja:
getMenu não exige mapear Store/frete para então navegar os itens.

## Campos de browseOffers

| Caminho | Tipo/estado |
| --- | --- |
| $.resultKind / $.merchantType | string |
| $.results | array de três produtos |
| $.results[*].itemId / itemName | string |
| $.results[*].merchant.merchantId | string, todos correspondem ao solicitado |
| $.results[*].merchant.merchantName / isOpen | string / boolean |
| $.results[*].merchant.deliveryMethod.fee / promotionalFee | number |
| $.results[*].merchant.minimumOrderAmount | number |
| $.results[*].unitPrice / promotionalUnitPrice | number |
| $.results[*].available | ausente em todos os itens |
| $.hasMore | boolean false nesta consulta |
| $.nextPageToken | null nesta consulta |
| $.agentHints | object, ignorado para decisões |

O vínculo é aninhado, não um merchantId obrigatório na raiz do produto. Os três
produtos têm itemId único e merchant.merchantId correspondente à loja consultada.
Não houve item estrangeiro observado. O adaptador confere cada item; quando há
vínculo tanto na raiz quanto aninhado, ambos precisam concordar. Nunca reatribui
um resultado global ao restaurante escolhido.

Os argumentos de browseOffers/getMerchant usam a mesma localização comprovada.
O filtro refinements.merchantId funcionou nesta amostra; isso não elimina o
risco anterior de respostas globais nem substitui conferência por item.

Nenhuma flag equivalente de disponibilidade foi observada. Presença na busca,
loja aberta e contagem de catálogo não provam que o item está disponível.
Mapeamento para MenuItem exige boolean explícito comprovado: sem ele, falha
availability_unconfirmed. Não usar active, status ou nome como equivalência
sem evidência semântica. Itens com available false explícito são preservados.

## Dinheiro e prova faltante

UnitPrice/promotionalUnitPrice foram iguais em cada item desta amostra. Isso
não prova a unidade, a precedência promocional ou as condições comerciais.
Não há currency, unidade declarada nem outputSchema para esses campos no
material coletado. As descrições de getMerchant/browseOffers/getItem não
especificam a escala financeira de saída. BRL nos filtros de entrada não é
prova da unidade dos valores retornados.

O catálogo de ferramentas inclui getCart/createCart, mas não houve execução de
carrinho nesta inspeção nem resposta correlacionada desses produtos no relatório.
As descrições coletadas dessas ferramentas também não declaram unidade de saída.
Narrativas de testes anteriores não substituem comparação dos mesmos campos/IDs.
Não criar carrinho para resolver a dúvida nesta auditoria somente leitura.

Falta uma definição oficial por campo (moeda e escala), um outputSchema descritivo
ou evidência oficial inequívoca correlacionando os mesmos itens/quantidades às
linhas e totais de um carrinho já autorizado, sem misturar descontos/complementos.
Uma comparação de aparência/magnitude isolada não basta. Não presumir que todos
os campos/ferramentas usam a mesma unidade.

MoneyUnit segue ausente no plano real. Valores originais são preservados no
relatório privado e no baseline; nenhuma conversão real foi declarada homologada.
Conversões em testes usam unidades explicitamente fictícias/definidas pela fixture.
Frete ou preço promocional divergente bloqueia até esclarecer qual é aplicável.

## Paginação e completude

A resposta observada termina com hasMore false e token null. Não existe cursor
real para adicionar ao plano agora. A contagem de três itens coincide com
catalogSummary.totalItems, mas ambas podem descrever somente ofertas ativas;
isso não comprova cardápio completo incluindo indisponíveis.

A quarta inspeção repete browseOffers com opt-in de até três páginas (primeira
incluída), sem inserir token inicial. Só continua com nextPageToken realmente
retornado. Preserva filtro/localização, recusa token repetido, hasMore/token
contraditórios, duplicatas conflitantes entre páginas e escopo errado, e
sinaliza limite sem sucesso parcial. SIGINT ou
SIGTERM também encerram. A CLI mantém cada página original no relatório privado.
PaginationVerified/homologated continuam false: término de paginação não prova
cobertura semântica de getMenu.

## Compatibilidade e correções

- Store: busca tem ID/nome/abertura e caminhos de taxa/mínimo; unidade ainda falta.
  GetMerchant confirma identidade operacional, mas não entrega taxa na amostra.
- MenuItem: identidade e preços têm campos observados corrigidos; disponibilidade
  e unidade faltam. Nenhum MenuItem falso é gerado com preço/available padrão.
- SearchStores(query,address): assinatura compatível; homologação financeira pendente.
- GetMenu(storeId,address): assinatura compatível; vínculo aninhado corrigido e
  preflight de identidade separado do frete. Ainda bloqueado onde faltam dados.
- GetStore é extensão: não se exige alteração da CatalogPort.
- ValidateAddress continua ausente; CatalogPort completa não pode ser conectada
  por cast. Decisões sobre fluxo digitado estão em ADDRESS-FLOWS.md.

## Quarta inspeção preparada

Arquivos privados fora do repo, modo 600: catalog-plan-04-items-pages.json e
catalog-baseline-04-private.json. O plano contém três getItem com IDs efetivamente
retornados e pertencimento verificado, depois browseOffers com paginação limitada.
O baseline guarda os valores originais de browseOffers para comparação; não
publicar nenhum dos dois arquivos. Argumentos passaram nos inputSchemas coletados.

```bash
cd /Users/andrei/FoodJam
node --import tsx src/ifood/catalog-check-cli.ts \
  --report "$HOME/.local/share/foodjam-validation/catalog-report-04-items-pages.json" \
  < "$HOME/.local/share/foodjam-validation/catalog-plan-04-items-pages.json"
```

O relatório de saída precisa ser novo. Inspecionar preço/disponibilidade e
características de getItem contra o baseline e a leitura atual de browseOffers.
Não pressupor que getItem tenha o mesmo wire de browseOffers: seus IDs são
conferidos, mas os demais campos só poderão ser homologados quando observados.
Mudança de preço deve ser registrada, não escondida como equivalência.

Depois: comprovar moeda/escala por campo, disponibilidade explícita ou semântica
oficial equivalente, taxa aplicável, comportamento de promoções e inclusão de
indisponíveis; conferir paginação com continuação real se ocorrer. Ana Paula
continua responsável pela decisão de aquisição/consentimento do endereço manual.
CreateAddress e submitOrder permanecem bloqueados; sem cadastro, compra ou
alteração de contratos compartilhados nesta auditoria.

Validação local das alterações: 566 testes em 20 arquivos, check/build/diff check
aprovados, preservando IF-01–04. Revisão independente confirmou a correção de
duplicatas conflitantes entre páginas; nenhuma nova operação MCP foi executada.
