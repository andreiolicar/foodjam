# IF-05 — inspeção manual de catálogo no Mac

**IF-05 aberta.** Inspeções 04/05 executadas autonomamente sob autorização do
responsável, exclusivamente de leitura. Resultado atual, contagem de chamadas
e bloqueios em [INSPECTION-04-05.md](INSPECTION-04-05.md). Os comandos abaixo
registram o procedimento histórico; os relatórios já existem e não podem ser
sobrescritos. A investigação atual parou por lacunas externas de contrato/dados.

## Quarta inspeção executada (procedimento histórico)

A terceira leitura já foi auditada em [INSPECTION-03.md](INSPECTION-03.md).
Foi criado privadamente catalog-plan-04-items-pages.json (modo 600), com
getItem para os três produtos efetivamente observados e browseOffers limitado
a três páginas no mesmo destino/estabelecimento. Baseline financeiro original
em catalog-baseline-04-private.json, somente para comparação privada, sem unidade
inferida. Não compartilhar nem versionar plano, baseline ou respostas.

```bash
cd /Users/andrei/FoodJam
node --import tsx src/ifood/catalog-check-cli.ts \
  --report "$HOME/.local/share/foodjam-validation/catalog-report-04-items-pages.json" \
  < "$HOME/.local/share/foodjam-validation/catalog-plan-04-items-pages.json"
```

Não foi inventado cursor: relatório 03 tem hasMore false/token null. A nova
consulta começa sem token e só continua se a nova resposta retornar continuação.
Não há moneyUnit: unidade de preços/taxas ainda não foi comprovada. GetMerchant
não forneceu frete e browseOffers não forneceu disponibilidade; verificar se
getItem acrescenta os dados e comparar os preços originais antes de homologar.

## Inicialização e plano inicial reproduzível

Configurar credenciais no .env ignorado conforme README. Callback local e browser
são necessários para OAuth; não colocar credenciais no plano ou relatório.

```bash
cd /Users/andrei/FoodJam
umask 077
mkdir -p "$HOME/.local/share/foodjam-validation"
cp src/ifood/catalog-check.example.json "$HOME/.local/share/foodjam-validation/catalog-plan.json"
node --import tsx src/ifood/catalog-check-cli.ts \
  --report "$HOME/.local/share/foodjam-validation/catalog-report-initial-new.json" \
  < "$HOME/.local/share/foodjam-validation/catalog-plan.json"
```

O plano inicial só faz discovery e listAddresses({}). Para apenas discovery,
usar `{ "calls": [] }`. O schema da conexão vigente ainda é obrigatório.
Para o build, o equivalente é `node dist/ifood/catalog-check-cli.js`.

A CLI exige arquivo novo, absoluto, em diretório privado (modo 700) fora do repo;
cria relatório exclusivo modo 600, não sobrescreve nem segue arquivo existente.
Não baixar permissão desse diretório. Use nome novo para cada execução.
O relatório contém dados privados integrais: nunca Git, Telegram, chat ou logs.
A biblioteca não adiciona tokens/configuração OAuth ao relatório.

## Formato do plano e garantias

Objeto JSON privado, até 1 MiB:

- calls: até 20 `{ name, args, pagination? }`, em ordem. Nomes: listAddresses, searchOffers,
  browseOffers, getMerchant, getItem. Nenhum nome novo é habilitado por discovery.
  pagination opcional `{ maxPages }` (inteiro 1–5, primeira página incluída) só
  para searchOffers/browseOffers; fora dessas ferramentas é recusado.
- address opcional `{ formatted, id? }`, para comparar listAddresses com o destino
  fornecido. Formatted deve copiar o formattedAddress comprovado do provedor.
- moneyUnit opcional BRL/cents, só depois de comprovar a unidade de todos os campos
  financeiros. Sem ele, o relatório registra unit_unconfirmed e não converte.

Argumentos são exatamente os do plano, validados contra o schema do cliente.
Não gera coordenadas, IDs, cursores ou filtros. Por padrão consulta uma página;
com opt-in segue apenas nextPageToken realmente retornado, até maxPages.
No máximo 20 consultas declaradas × 5 páginas, todas de leitura. A descoberta
inclui todos os metadados reais, não autorização de executá-los. Annotations e
agentHints não selecionam endereço nem dispensam consentimento/confirmacão.

A CLI preserva args/result originais e schemas em tools, sem impressão de dados
privados no terminal. Profile é só validação adicional; não altera o result.
O tipo de listagem segue args.resultKind, inclusive searchOffers ITEM.
Sem moeda, verifica estrutura/paginação de busca e escopo de getMerchant,
browseOffers e getItem; compara ambos os IDs em getItem. O vínculo real de
browseOffers está em merchant.merchantId; não atribui itens globais à loja. Campos de preço,
disponibilidade e características ainda precisam ser conferidos no result real.

Saída 0 significa inspeção concluída, inclusive quando falta unidade/endereço de
referência; não homologação. Saída 1 indica falha de execução, perfil incompatível,
cancelamento, gravação ou encerramento. Falha de perfil ainda permite inspecionar
as demais chamadas explicitamente fornecidas; falha de execução interrompe.
Com paginação opt-in, perfil incompatível interrompe as páginas daquela
consulta, sem esconder as outras consultas explícitas do plano. Cursor repetido
ou limite com continuação grava paginationFailure e retorna 1. Duplicatas de ID
com preço/disponibilidade/dados públicos divergentes também interrompem, com
conflicting_duplicate, mesmo sem unidade monetária configurada. Cada página é
preservada separadamente em calls; nada é marcado homologado ou completo.
Sempre fecha conexão; SIGINT/SIGTERM também fecham. Um relatório parcial pode
existir após falha: não tratá-lo como catálogo completo.
Homologated e paginationVerified são marcadores conservadores fixos da CLI;
o estado efetivamente validado deve constar na auditoria sanitizada, mesmo que
uma página isolada informe hasMore false.

## Checklist da inspeção 04 e continuação

1. O documento de getMerchant já mostrou deliveryMethods vazio, sem frete.
   Conferir seu merchantId, estado, mínimo e métodos
   de entrega quando houver nova evidência. Não presumir a forma da linha de searchOffers.
2. Em browseOffers, conferir a localização usada e merchantId de cada item. O
   filtro refinements.merchantId não prova sozinho a associação. Oferta global,
   item sem vínculo ou de outra loja bloqueia o cardápio.
3. Os itemId e vínculos reais já foram usados no plano getItem. A inspeção
   getItem deve conferir identidade, nome/descrição, preços, disponibilidade,
   opções obrigatórias, restrições/características explícitas e lacunas.
4. Identificar caminhos/tipos de dinheiro e obter comprovação de unidade por
   documentação oficial, schema ou informação inequívoca do retorno. BRL nos
   filtros não prova unidade da saída. Comparar apresentação de um valor conhecido
   quando necessário. Não definir moneyUnit pela aparência de inteiro/decimal.
5. Preservar fee e promotionalFee. Quando divergirem, não escolher a menor taxa
   nem reconstruir desconto; esclarecer precedência/condições com o provedor.
   Falta de taxa não significa frete grátis e flag ausente não significa vendável.
6. Ler hasMore/nextPageToken reais. Preparar outra chamada com o token devolvido,
   mesmos filtros, localização e merchantId. Continuar mesmo com página vazia e
   token. Recusar ciclo/contradição e revisar duplicatas/conflitos entre páginas.
   Adaptador e inspeção recusam duplicatas públicas conflitantes; a inspeção
   preserva as páginas originais para comparação. Recusar continuação não
   mapeada. Nunca fornecer token fictício ou concluir completude da primeira página.
7. Confirmar se browseOffers entrega todo o menu, inclusive indisponíveis, ou só
   ofertas. Todas as páginas de ofertas não provam o universo exigido por getMenu.
8. Não inferir classificação alimentar por nomes, converter active em available
   ou assumir opções obrigatórias vazias. Registrar somente atributos explícitos.
9. Produzir síntese sanitizada de campos/unidades/lacunas; ajustar mapeamentos e
   fixtures com a evidência, depois repetir check/build. Não versionar raw result.

## Endereço manual e operações proibidas

Fluxos A/B e proposta à Ana Paula em [ADDRESS-FLOWS.md](ADDRESS-FLOWS.md).
CreateAddress documenta geocodificação + persistência e tem hints de escrita;
não é permitido usá-lo como validateAddress de leitura. A CLI recusa esse nome
antes de conectar. Não contornar com args, consentimento fictício ou alias.
Não criar endereço/carrinho para descobrir dado que falta em uma leitura.

## Estado das evidências

| Informação | Estado |
| --- | --- |
| ID/texto/coordenadas do endereço no mesmo registro | Observado no relatório 01; vínculo local reprocessado |
| Campo de texto | formattedAddress; adaptador corrigido |
| Busca de restaurantes para localização comprovada | Sucesso no relatório 02; três resultados |
| Funcionamento/nome/entrega/mínimo | Caminhos observados na busca, estrutura corrigida |
| Continuação da busca inspecionada | hasMore false e token null naquele termo/filtro |
| Unidade monetária/precedência de promoção | Não comprovadas |
| GetMerchant/browseOffers | Observados em 03/04/05; frete de detalhe e disponibilidade ausentes |
| Paginação real de ofertas da loja | Duas páginas em 05, token e término coerentes; escopo de uma loja |
| GetItem e menu completo | GetItem real observado; disponibilidade/unidades e inclusão de indisponíveis continuam bloqueadas |
| Fluxo manual sem escrita / validateAddress | Não confirmado; decisão conjunta pendente |

Orçamento/rateio ficam no Core: produtos + frete + taxas - descontos aplicáveis,
com custos por loja somente entre seus participantes. Esta inspeção não calcula
esses valores e não autoriza cadastro, pagamento, checkout ou compra.
