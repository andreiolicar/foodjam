# IF-05 — integração real com o Core

Atualização prioritária em 18/10/2026: [DEMO-INTEGRATION.md](DEMO-INTEGRATION.md).
A demo com IA real passou para duas pessoas/uma loja usando o snapshot MCP real.
O preflight atual informa loja fechada; nenhum carrinho foi criado. O restante
deste documento registra as etapas e bloqueios anteriores.

Estado: parcialmente pronta. Descoberta e proposta preliminar foram executadas
com MCP real; preparação e rateio têm integração offline testada. O ciclo comercial
real da nova proposta não foi executado, pois nenhuma mutação específica foi
autorizada. O carrinho conhecido apresenta bloqueios reais descritos abaixo.

Atualização do desbloqueio comercial: [COMMERCIAL-UNBLOCK.md](COMMERCIAL-UNBLOCK.md).
Detalha a correlação histórica do endereço, a diferença financeira em centavos,
a política opcional de ajuste não atribuído com aceite de todos os compradores e
o bloqueio externo da IA. Após a configuração local, novas leituras MCP foram
executadas, mas o Groq retornou HTTP 429. O padrão comercial continua restritivo;
nenhuma criação de carrinho ou compra foi executada nessa rodada.

## Git e preservação do trabalho

Worktree gerenciado: /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam.
Branch codex/if05-real-integration, criada a partir de origin/main a806159, depois
de fetch e validação da branch original. Nenhum merge/rebase/cherry-pick/commit.
Os commits do Core/Telegram permanecem ancestrais da branch de integração.
A feature feat/ifood-mcp, HEAD dd8587e, e suas alterações locais foram preservadas
no checkout original. Snapshot privado de patch/arquivos não rastreados, com
hashes conferidos, em ~/.local/share/foodjam-validation/if05-backup-*.
IF-01–05 transportadas somente nos diretórios iFood/testes; manifests, scripts e
configurações da main preservados. Não se copiou .env. Dependências locais são
reutilizadas em node_modules ignorado; nenhuma dependência nova foi instalada.

## Contratos e API por fase

Store, MenuItem, DeliveryAddress, CotacaoPedido e CatalogPort cotada anteriores
continuam válidos, com seus campos obrigatórios e testes. Não há cast para passar
um adaptador incompleto ao agente. A composição real usa as novas portas por
fase no Core; contratos únicos estão em src/core/contracts.ts e ports.ts.

| API | Retorno/contrato | Estado para integração |
| --- | --- | --- |
| createIfoodMcpClient | OAuth, discovery, leituras e capacidades opt-in existentes | Operacional; tokens só em memória, consumidor de teste local |
| createIfoodCatalog | Dois métodos da CatalogPort cotada anterior | Preservado; não é a composição real principal, faltam validateAddress/quoteOrder |
| createIfoodDiscoveryCatalog.listSavedAddresses | DeliveryAddress[] | Real validado; ID/texto/coordenadas associados; não depende de moneyUnit |
| DiscoveryCatalogPort.searchStores | DiscoveryStore[] | Real validado; frete opcional, lojas fechadas preservadas no adaptador |
| DiscoveryCatalogPort.getStore | DiscoveryStore | GetMerchant real; não preenche frete quando deliveryMethods está vazio |
| DiscoveryCatalogPort.getMenu | DiscoveryMenu | Ofertas reais, vínculo por merchantId, cobertura offers_only, truncamento explícito |
| DiscoveryItem | Derivado de MenuItem, preço/disponibilidade opcionais | Ausente permanece desconhecido; false explícito continua indisponível |
| selecionarEnderecoSalvo → confirmarEndereco | Candidato → destino confirmado | Real validado; organizador escolhe registro existente antes da busca |
| coletarEnderecoDigitado | AddressRegistrationIntent | Coleta texto; não valida localização nem cadastra; exige etapa de consentimento |
| proporDescoberta | PreliminaryProposal | Real validado; sem total/rateio final e sem carrinhos de exploração |
| createPreparationAuthority | Permissão opaca por instância/contexto | Testado; evento confiável do organizador, não userConsent true |
| CommercialPreparationPort.prepare | CartObservation por loja | Implementado/testado offline; criação não executada nesta entrega |
| readIfoodCart | CartObservation de carrinho conhecido | Real validado; sem associá-lo à proposta nova |
| reviewCommercial / canConfirmCommercial | CommercialReview / gate de revisão | Rateio exato testado, bloqueia lacunas; não autoriza compra |
| validateAddress(text) da porta cotada | AddressValidation | Sem implementação real silenciosa; texto livre exige fluxo separado |
| quoteOrder da porta cotada | CotacaoPedido.serviceFeeCents | Não mapeado a feeTotalAmount; não há cotação arbitrária de leitura comprovada |
| submitOrder | Indisponível | Continua bloqueada em todas as APIs |

DiscoveryStore/DiscoveryItem derivam dos tipos existentes, sem preço bruto ou
escala ambígua no Core. CommercialShare usa feesCents para taxas agregadas e
discountCents explícito: não rebatiza todo encargo como taxa de serviço. Os textos
dos prompts/modelos existentes não foram alterados; somente suas assinaturas de
metadados foram generalizadas para reaproveitar classificação sem preço/estoque.

## Evidência real desta integração

Relatórios privados 06–09 fora do Git, modo 600. Quatro conexões/read checks:
35 leituras lógicas, incluindo quatro listTools. Foram executadas getUser (4),
listAddresses (8), searchOffers (7), getMerchant (2), getItem (1), browseOffers (6)
e getCart (3). Zero mutações, pagamentos ou compras. Os ensaios 07/08 pararam em
incompatibilidades reais; foram preservados. Não esconder essas execuções:

- 07: busca MERCHANT por produto vazia; carrinho conhecido tinha três itens,
  enquanto o contexto histórico usado esperava um. Escopo recusado corretamente.
- Correção: busca ITEM complementar quando MERCHANT não encontra; cada loja vem
  da própria oferta e cada produto tem associação validada. Composição integral
  do carrinho foi obtida da leitura já feita, não inventada.
- 08: restaurante real tem mais de três páginas. A porta de descoberta foi
  ajustada para devolver ofertas limitadas com truncated true, explicitamente;
  a fábrica estrita anterior continua recusando truncamento silencioso.
- 09: comando real final terminou com sucesso, 12 leituras incluindo discovery,
  endereço confirmado, 30 produtos reais em três páginas, duas escolhas para os
  dois participantes demonstrativos. Eles pediram o mesmo produto real; a proposta
  efetivamente validada usa uma loja. Duas lojas foram verificadas offline.

A seleção final foi literal, explicitamente indicada no relatório; não foi
utilizado FakeLlm nem catálogo fake. O .env local não configura provedor real de
modelo. O modo model está disponível, exige temProvedorReal e reutiliza o modelo
existente, mas não foi validado ao vivo nesta etapa. Preferências/nomes do grupo
são entradas demonstrativas, sem serem apresentados como pessoas reais.

O menu é limitado/ofertas, não um catálogo completo de indisponíveis. Todo
merchantId foi conferido. Metadados agentHints não selecionam destino, habilitam
operações ou dispensam autorização.

## Dinheiro e bloqueios exatos

A comparação de getItem/getCart para o mesmo item e quantidade confirmou preço
unitário numericamente idêntico. Calibração adicional: maxItemPrice documentado
em BRL excluiu o mesmo produto com metade do preço bruto e o incluiu com teto
igual. Isso sustenta o perfil operacional BRL da amostra por comportamento,
não pela magnitude dos números. Não é documentação universal de todos os campos,
verticais e promoções; unidade fica opção explícita, nunca default de produção.
Preços/frete/promocionais divergentes ou sem unidade ficam desconhecidos.

Após conversão decimal exata para centavos, o subtotal observado corresponde à
soma dos itens; frete e taxas agregadas têm campos próprios. O total final não
corresponde a subtotal + frete + taxas - benefitsTotalAmount - voucherTotalAmount.
CartObservation conserva os valores convertidos e registra
total_decomposition_mismatch. Por padrão o Core recusa split. A política opcional
proportional_unattributed_adjustment permite uma proposta de rateio do delta líquido
contra itens + entrega + taxas, sem chamar esse ajuste de desconto oficial nem
subtrair benefícios novamente. Só pode ser confirmada após aceite da revisão por
todos os compradores afetados; não resolve bloqueios de endereço ou dados ausentes.
O carrinho conhecido não é apresentado como o carrinho da nova proposta.

| Bloqueio | Evidência/campo que o resolveria |
| --- | --- |
| Escala financeira universal | Documentação oficial de unidade por campo para unitPrice, promotionalUnitPrice, fee/promotionalFee, mínimo e summary.*Amount; currency sozinho não define escala |
| Preço promocional divergente | Semântica oficial de preço efetivo/condições e representação de adicionais obrigatórios, confirmadas por produto/carrinho idênticos |
| Disponibilidade desconhecida | Indicador explícito por produto, ou garantia oficial de semântica de oferta suficiente para a fase comercial; getItem atual omite indisponíveis, não devolve available |
| Frete de detalhe ausente | Método de entrega selecionado aplicável ao destino e valor efetivo com unidade/condições; deliveryMethods vazio não significa frete grátis |
| Total não reconciliado | Fórmula oficial e decomposição de benefícios/vouchers/ajustes; alternativamente, política local explícita de ajuste não atribuído aceita por todos os compradores, sem alegar decomposição oficial |
| Endereço do carrinho não inequívoco | Vínculo oficial estável cartId → addressId confirmado, ou outra resposta comprovada equivalente; deliveryAddress.addressId é uma possibilidade suportada, mas NÃO apareceu na amostra |
| Menu completo | Endpoint/garantia de cobertura, inclusive indisponíveis; término de páginas de ofertas não prova esse universo |
| Opções de produto | Schema/retorno real de grupos não vazios e adicionais obrigatórios; o preparador recusa grupos não homologados |

## Preparação comercial e revisão

O evento confiável “preparar” do organizador chama prepareCommercialProposal,
que cria permissões opacas vinculadas à conta autenticada, sessão, proposta,
loja, endereço e itens/quantidades. O iFood verifica instância/contexto antes de
qualquer leitura ou escrita comercial. Origem do actorId deve ser o canal
confiável; saída de modelo/JSON userConsent não autoriza operação.

Cada loja tem sua própria reserva/carrinho. A chave persistente é a identidade
conta/sessão/proposta/loja; ordem das propriedades, endereço ou composição
alterados não liberam nova criação para uma reserva ambígua. A permissão continua
vinculada ao payload exato. Registro privado é reservado atomicamente e sincronizado
em disco ANTES de createCart; cartId só é gravado após confirmação. Timeouts e
crashes pendentes exigem reconciliação, nunca exclusão automática da reserva.

Repetir a mesma preparação lê o carrinho conhecido. Mudança da proposta não
atualiza itens silenciosamente; divergência é recusada e requer revisão explícita.
Trocar somente proposalId para contornar reserva é proibido pelo controlador.
Persistir propostas e registros; a autoridade em memória é recriada somente por
novo evento autenticado. A transição do estado atual da sessão deve ser serializada
pelo controlador, reaproveitando a fila do agente existente.

Preparador relê endereço, abertura da loja e detalhes dos itens; confere IDs,
quantidades e grupos de opções. Available false bloqueia, ausência não vira true.
GetCart não confirma sozinho preço/estoque/entrega de uma compra futura. Falha de
uma loja bloqueia o consolidado, mantendo a observação das outras separadamente.

O Core distribui entrega/taxas só entre compradores da loja. Benefício agregado
bloqueia por padrão (block_unattributed). A política explícita proportional_items
atribui desconto proporcional ao valor bruto dos itens, com resto determinístico
em centavos; benefícios maiores que essa base são recusados. Só aplicar quando
a fórmula comercial reconciliar e o time tiver escolhido essa política.

O total individual inclui itens + entrega + taxas - desconto. Cada excesso exige
aceite autenticado da própria pessoa, vinculado à revisão. Mudança em composição,
valores, política ou carrinho muda a revisão e invalida aceites anteriores.
CanConfirmCommercial verifica revisão, não compra e não produz submitOrder.

## Endereços

Salvar/validar/confirmar são etapas diferentes. A integração demonstrada seleciona
um registro salvo e reutiliza a confirmação do Core. Texto manual produz somente
AddressRegistrationIntent; nenhuma coordenada ou DeliveryAddress validado é
inventado. CreateAddress pode persistir diretamente; não está exposta como leitura.
A execução do cadastro e o fluxo de candidatos ainda precisam de uma implementação
de mutação específica, com consentimento próprio, e teste autorizado. Esse ponto
continua pendente, separado da demonstração com endereço salvo. Ver ADDRESS-FLOWS.md.

## Comandos no Mac

Ponto de entrada real inicial: scripts/integracao-ifood.ts, não o catálogo fake
usado nos simuladores existentes. Nenhuma alteração no Telegram ou src/index.ts.

```bash
cd /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam
npm run integrar:ifood -- \
  --input "$HOME/.local/share/foodjam-validation/integration-plan-08-private.json" \
  --report "$HOME/.local/share/foodjam-validation/integration-report-next-private.json" \
  --env /Users/andrei/FoodJam/.env
```

O relatório precisa de nome novo; não repetir a leitura sem hipótese. Exit 0
indica execução da leitura, não homologação comercial. Terminal só imprime estado;
proposta/destino/IDs/valores ficam no relatório privado. O ensaio 09 já foi executado.

Preparação futura, **não executada nesta tarefa** e condicionada à autorização
específica do teste. O artefato privado commercial-proposal-review.json contém a
proposta real e a chave local pseudônima da conta; não é um ID iFood inventado.
Diretório de journal deve existir, modo 700, fora do Git.

```bash
npm run preparar:ifood -- \
  --proposal "$HOME/.local/share/foodjam-validation/commercial-proposal-review.json" \
  --journal "$HOME/.local/share/foodjam-validation/cart-journal" \
  --report "$HOME/.local/share/foodjam-validation/commercial-report-next-private.json" \
  --env /Users/andrei/FoodJam/.env
```

A CLI exige TTY e frase vinculada ao hash da composição/política/conta antes de
habilitar mutações; depois verifica getUser novamente. Operador local é o ator
confiável somente desta demonstração. Não usar esse mecanismo como autenticação
do Telegram. Não há autorização para pagamento, cadastro de endereço ou compra.

## Conexão mínima com Telegram

1. Capturar preferências com o fluxo existente; disponibilizar provedor real de
   IA para coleta/classificação, ou usar entrada estruturada/matching literal
   explicitamente. Não apresentar matching literal como IA validada.
2. Mapear IDs da sessão/organizador pelo canal, listar destinos no privado,
   selecionar via selecionarEnderecoSalvo e confirmar com confirmarEndereco.
3. Chamar proporDescoberta na mesma fila de sessão. Apresentar escolhas,
   cobertura limitada, valores conhecidos e pendências; não anunciar total final.
4. Só o callback autenticado “Preparar” do organizador usa autoridade/porta
   comercial com journal durável e conta MCP correspondente. Não aceitar actorId
   de texto/LLM. Registrar proposta atual antes de chamar a camada comercial.
5. Apresentar CartObservation e CommercialReview por loja. Se blocked, mostrar
   lacuna sem total consolidado inventado. Se review_required, colher aceites
   pessoais de excesso e confirmação do organizador para a revisão exata.
6. Encerrar o cliente no desligamento; nenhuma chamada de submissão é ligada.

## Próximas ações e perguntas ao iFood

- Time: revisar/selecionar política de benefícios e aprovar um teste específico
  de preparação; não basta autorização genérica para implementar código.
- Mentor: qual é a fórmula de summary.totalAmount, e quais descontos já estão
  incluídos/sobrepostos? Como obter decomposição que feche em centavos?
- Mentor: como recuperar inequivocamente o addressId de getCart? Existe operação
  de leitura que faça esse vínculo para carrinhos existentes?
- Mentor: as unidades monetárias de catálogo, frete, taxas e summary são todas
  BRL? Qual contrato oficial permite distinguir preço base/promocional/efetivo?
- Mentor: como confirmar disponibilidade e opções obrigatórias no preparo, e
  existe menu inclusivo dos indisponíveis? Quais códigos distinguem inexistência,
  fechamento da loja e falha de permissão?
- Mentor: há validação de endereço sem persistência e cotação read-only? Caso não,
  quais garantias de idempotência e reconciliação são oferecidas para criação?
- Responsável Telegram: ligar os callbacks descritos sem alterar compras nem
  compartilhar OAuth entre consumidores. OAuth atual é local e de usuário de teste.

A demonstração real completa de novos carrinhos + rateio permanece não validada:
zero escritas executadas, endereço de carrinho sem ID inequívoco e fórmula de
benefícios ainda não reconciliada. Os testes offline cobrem o caminho completo
incluindo duas lojas, centavos, falha parcial, autorização e revisão.

## Arquivos e verificação final

- Core: contracts.ts/ports.ts acrescentam as fases; discovery-flow.ts faz aquisição
  salva e proposta preliminar; commercial-flow.ts faz autorização, coordenação,
  descontos, rateio e revisão; schemas.ts valida os novos artefatos. Index exporta
  essas APIs. Prompts/elegibilidade tiveram só tipos de metadados generalizados.
- iFood: discovery.ts, commercial.ts, cart-observation.ts e cart-journal.ts;
  catalog-data.ts mantém validação estrita e acrescenta parser preliminar sem
  preço obrigatório. Index publica as novas capacidades. IF-01–05 preservadas.
- Composição: scripts/integracao-ifood.ts e scripts/preparar-ifood.ts; duas entradas
  npm adicionadas sem mudar dependências. Telegram/src/index.ts intactos.
- Testes: dois arquivos novos de Core, três de iFood e um de integração; testes
  anteriores preservados. Import smoke inclui as novas APIs/CLIs sem efeitos.

Verificação da etapa anterior: npm run check aprovado com 1156 testes em 49 arquivos, lint e
TypeScript estrito; npm run build e git diff --check aprovados, também whitespace
separado de 64 arquivos não rastreados. Revisão independente: achados de preço/frete
ausentes, mutabilidade e idempotência corrigidos com regressões; confirmação final
sem bloqueantes restantes nesses achados. Os 156 arquivos versionáveis foram
inspecionados sem credenciais configuradas ou dados pessoais das evidências.
Apenas IDs comerciais dos smoke tests anteriores permanecem nos arquivos legados;
nenhum ID/dado real foi adicionado às novas fixtures. Relatórios/proposta privados
permanecem fora do Git. Patch, HEAD e arquivos não rastreados do checkout original
foram comparados ao backup e permanecem intactos. Sem commit, push, PR ou merge.
