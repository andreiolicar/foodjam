# IF-05 — plano e decisões de preparação

Objetivo: preparar catálogo somente leitura na branch feat/ifood-mcp, conforme
os requisitos IF-05 fornecidos pelo responsável. Execução local, sem commits.

Base inspecionada: dd8587ec90ab7ce0ca2cca83346d5d68bd74ff86.
Core consultado somente por git show: origin/main em
0150bb6376164ae2346fc20955993d4a37a9a998 (17/10/2026).
Lidos ports.ts, contracts.ts, index.ts, docs/api-core.md e
proposta-catalog-getstore.md; relatórios MCP-01/02 também consultados.

## Decisões da preparação inicial (histórico; reconciliação abaixo)

- Reutilizar callReadTool; não modificar OAuth, transporte, discovery ou permissões.
- Inferir resultados públicos a partir dos validadores locais; não criar cópias
  de CatalogPort, Store, MenuItem ou StoreNotFoundError.
- Injetar fábrica de StoreNotFoundError na composição; não copiar a classe do Core.
- Preparar searchOffers, browseOffers e getMerchant com perfil estrito candidato.
  Não há outputSchemas/payloads integrais confirmados no repositório. Este perfil
  NÃO constitui contrato oficial: integração real bloqueada até confrontação
  privada dos argumentos, campos, moeda, ausência de loja e paginação.
- Localização explícita e fixa por instância, sem consultar endereço automaticamente.
- Unidade financeira explícita (BRL ou centavos), conversão decimal exata.
- getStore é extensão do adaptador, sem modificar a porta compartilhada.
- submitOrder permanece bloqueada, inclusive diante de AuthorizedOrder.

## Execução inicial (histórico)

- [x] Testes controlados: envelope textual/estruturado, campos obrigatórios,
  lojas abertas/fechadas, indisponibilidade, dinheiro, erros e inexistência.
- [x] Implementar catalog-data.ts (validação local) e catalog.ts (orquestração),
  exportar fábrica/erro/opções via index.ts; testar sem MCP remoto.
- [x] Cobrir paginação, limite, ciclos, duplicatas e isolamento por merchantId.
- [x] Documentar API, exemplo, evidências anteriores, bloqueios e composição mínima
  em CATALOG.md; acrescentar link ao README, preservando histórico IF-01–04.
- [x] Rodar npm run check, npm run build, git diff --check; revisar escopo e dados.

Evidências: 495 testes em 18 arquivos; build e diff check aprovados. Compilação
virtual em memória contra CatalogPort/classe de erro de origin/main aprovada.
Revisão independente somente leitura: nenhum achado concreto no perfil candidato.
Inspeção de 56 arquivos versionáveis: nenhum caminho de credencial nem marcador
de chave privada/token de alta confiança; revisão das alterações sem dados reais.
Nenhuma alteração fora de src/ifood e tests/ifood. Sem commit/push/merge.

## Foco da revisão

- Não presumir que preço inteiro significa centavos nem preencher taxa ausente.
- Não confundir erro de transporte/permissão com loja inexistente.
- Não perder páginas nem atribuir ofertas globais à loja consultada.
- Não expor payloads/IDs/localização em erros de catálogo.
- Não prometer instanceof do Core sem injetar sua classe na composição final.

## Reconciliação solicitada — Core 9b0debb

A verificação anterior em 0150bb6 é histórica e não prova a porta atual.
A API atual exige validateAddress(text), searchStores(query, address) e
getMenu(storeId, address); DeliveryAddress tem formatted e id opcional.

Plano autorizado para esta revisão (skills de planejamento/TDD/verificação):
- [x] Remover localização fixa por instância; exigir endereço em cada consulta.
- [x] Resolver endereço salvo por listAddresses, sem escrita: ID único, texto
  normalizado exato e coordenadas válidas no mesmo registro. Perfil ainda candidato.
- [x] Não implementar validateAddress fictício nem alegar cobertura geográfica.
  Texto sem ID/geocodificação confirmada fica bloqueado; decidir com Ana Paula.
- [x] Preservar getStore como extensão que também recebe endereço.
- [x] Preparar CLI manual opt-in de leitura com catálogo real e relatório privado
  fora do repositório, resultados e schemas intactos; sem execução nesta tarefa.
- [x] Testar novo vínculo por endereço, paginação sem troca de destino e CLI offline.
- [x] Atualizar documentação e executar check, build e diff check.

Decisão oficial: orçamento usa produtos + parcela do frete + taxas - descontos
aplicáveis. Duas lojas usam dois carrinhos, custos compartilhados de cada loja
somente entre seus participantes. O Core implementa essas regras; nenhuma
alteração financeira, rateio ou regra de orçamento cabe a esta revisão iFood.

Verificação da reconciliação: npm run check aprovado com 533 testes em 20
arquivos; npm run build e git diff --check aprovados, incluindo whitespace dos
11 arquivos novos. Os 436 testes IF-01–04 permanecem preservados. Inspecionados
62 arquivos versionáveis sem marcadores de credenciais identificados; revisão
das alterações sem valores reais de endereço/coordenadas/conta.

Compatibilidade atual comprovada apenas para Pick<CatalogPort,
'searchStores' | 'getMenu'>, lendo contratos de 9b0debb do Git em memória.
A asserção adicional confirma que a porta completa NÃO está implementada.
Endereços sem ID/resolução oficial continuam bloqueados.

Revisão independente encontrou continuação desconhecida ignorada na raiz das
páginas e inconsistência da CLI diante de found:false. Ambos reproduzidos em
testes antes da correção; schema estrito e merchantMissing corrigiram os casos.
Revisor repetiu as reproduções offline e confirmou as correções.

Comando manual e relatório privado: CATALOG-VALIDATION.md. Nenhuma chamada ao
MCP nesta revisão; apenas git fetch autorizado. IF-05 EM ANDAMENTO, sem
homologação de dados reais e sem validateAddress. Sem commit/push/PR/merge.

## Evidências reais 01/02 e dois fluxos de endereço

Relatórios privados analisados localmente, sem nova conexão MCP. Somente
nomes/tipos/caminhos e conclusões sanitizadas podem ser versionados.

Evidência: listAddresses usa formattedAddress e metadado agentHints. A busca
searchOffers retornou estabelecimentos com deliveryMethod.fee/promotionalFee,
minimumOrderAmount e hasMore/nextPageToken. Unidades de saída não comprovadas.

Plano desta revisão, com regressões antes das correções:
- [x] Corrigir endereço salvo e oferecer listSavedAddresses como capacidade
  adicional, sem seleção/confirmacão automática ou alteração da CatalogPort.
- [x] Aceitar metadados adicionais sem executar agentHints; validar continuação
  conhecida e bloquear paginação alternativa não mapeada/contraditória.
- [x] Corrigir argumentos merchantType/resultKind/refinements.merchantId.
- [x] Atualizar mapeamento de estabelecimentos para campos observados, mantendo
  unidade explícita; fretes promocionais divergentes falham sem escolher regra.
- [x] Permitir getItem na CLI restrita de leitura e verificar vínculo/IDs mesmo
  sem unidade monetária; preservar payload só no relatório privado.
- [x] Documentar fluxo manual, consentimento e incompatibilidade validateAddress:
  createAddress é mutação, geocodificação/cadastro não serão habilitados aqui.
- [x] Preparar plano privado para getMerchant/browseOffers; item e cursor somente
  quando IDs/tokens forem efetivamente retornados, sem inventar identificadores.
- [x] Executar check/build/diff check, revisar segurança e escopo.

Resultado desta revisão: 550 testes em 20 arquivos; check/build/diff check
aprovados, incluindo whitespace dos 12 arquivos novos. Os 436 testes das
IF-01–04 foram preservados. Inspeção de 63 arquivos versionáveis sem marcadores
de credenciais identificados. Nenhuma alteração fora de src/ifood e tests/ifood.

Replay local dos relatórios privados passou: vínculo do endereço e estrutura
dos três estabelecimentos, fontes structured/text concordantes, sem verificar
unidade financeira. Compilação em memória contra o Core em refs locais passou
para os dois métodos de leitura; CatalogPort completa continua ausente.

Revisão independente: nenhum bug concreto bloqueante encontrado. Plano privado
03 preparado em modo 600, somente listAddresses/getMerchant/browseOffers, IDs e
localização copiados da evidência em memória e argumentos validados por schema.
Não há itemId nem token de cardápio nos relatórios 01/02; getItem e próxima
página só podem ser preparados depois de observá-los, sem placeholders reais.

Novo documento ADDRESS-FLOWS.md descreve ambos os fluxos e a proposta de mínima
entrada no Core para endereço comprovado, sujeita à Ana Paula. CreateAddress
permanece bloqueado; nenhuma escrita MCP ou nova chamada remota foi feita.
Unidade de saída, frete promocional, getMerchant/item/menu e completude ainda
pendentes. IF-05 ABERTA. Sem commit, push, PR, merge ou alteração do HEAD.

## Auditoria da inspeção 03 — plano autorizado

Somente leitura local do relatório privado e contratos de origin/main em refs
locais 9b0debb, sem fetch ou sincronização. O relatório registra listAddresses,
getMerchant e browseOffers, isError false, structured/text concordantes.

Evidência sanitizada: getMerchant tem deliveryMethods vazio, não deliveryMethod;
browseOffers tem unitPrice/promotionalUnitPrice e merchant.merchantId, sem flag
de disponibilidade. Três produtos, todos vinculados à loja solicitada. HasMore
false, token null, catalogSummary.totalItems coincide com a amostra; isso ainda
não prova inclusão de indisponíveis. Unidade monetária segue não comprovada.

- [x] Corrigir identidade de produto aninhada, recusando divergências entre
  vínculos, inclusive na CLI sem unidade financeira.
- [x] Reconhecer campos de preço observados sem assumir unidade, precedência
  promocional ou disponibilidade; ausência de available bloqueia MenuItem.
- [x] Separar identidade operacional da loja de seu frete: getMenu não precisa
  mapear Store para consultar itens; getStore com frete ausente falha explicitamente.
- [x] Paginação manual opt-in limitada a até cinco páginas por chamada declarada,
  sem cursor inventado: preservar cada resposta e interromper ciclo/limite/escopo.
- [x] Preparar plano privado 04: getItem com IDs observados e browseOffers com
  continuação condicionada a tokens realmente devolvidos, limite explícito.
- [x] Atualizar documentação sanitizada, preservar pendência de endereço manual
  com Ana Paula e executar check/build/diff check e revisão de escopo.

Verificação final da auditoria 03: 566 testes em 20 arquivos, npm run check,
build e git diff --check aprovados; 13 arquivos novos também revisados por
whitespace. 436 testes IF-01–04 preservados. Inspeção de 64 arquivos versionáveis
sem marcadores de credenciais identificados; nenhuma alteração fora de iFood.

Compilação apenas em memória contra origin/main local 9b0debb confirmou Store,
MenuItem e assinaturas searchStores/getMenu; porta completa continua pendente.
Replay controlado do relatório 03 passou no endereço/identidades e reconheceu
unit_unconfirmed e availabilityVerified false, sem chamar o MCP.

Revisão independente reproduziu duplicatas conflitantes aceitas entre páginas
da CLI. Regressores com e sem moneyUnit falharam antes da correção; mapa local
por consulta agora interrompe com conflicting_duplicate e preserva raw. Revisor
repetiu o teste e confirmou o fix, sem novo achado.

Plano privado 04 e baseline foram preparados em modo 600: três getItem com IDs
observados e browseOffers com maxPages 3, sem moneyUnit nem cursor inventado.
Nenhuma consulta nova ou operação de escrita MCP, commit, push, PR, merge ou
sincronização de branches. IF-05 permanece ABERTA.

## Execução autônoma 04/05 — Core a806159

Autorização posterior do responsável permite leituras autônomas (teto 20),
nunca mutações. Foram executadas 11 leituras incluindo duas descobertas e três
páginas de cardápio para uma loja. Evidências, correções, regressões, Core atual
com quoteOrder obrigatório e bloqueios externos em INSPECTION-04-05.md. Nenhum
commit/push/merge. IF-05 permanece aberta; unidades/disponibilidade, endereço
manual e cotação segura precisam de solução antes da composição integral.
