# IF-05 — gate comercial e decisões concretas

Atualização posterior: [DEMO-INTEGRATION.md](DEMO-INTEGRATION.md). A tentativa 14
com IA real foi aceita para duas pessoas/uma loja. A análise abaixo descreve o
estado anterior; o preflight 15 atual ainda bloqueia criação por loja fechada.

Estado: parcialmente pronta. Catálogo real e proposta preliminar literal já
validados com 30 produtos. IA real e ciclo comercial completo continuam pendentes.
Auditoria comercial feita com arquivos privados existentes. Após atualização do
.env pelo responsável, houve 19 leituras MCP e tentativas reais de IA, sem
mutações e sem submissão. Fetch confirmou origin/main a806159; branches paralelas
receberam novos commits, que não foram integrados nem sobrescritos.

## Endereço: causa precisa

Correlação local dos relatórios 09 e do histórico de ferramentas, lido em modo
somente leitura no banco local do OpenCode:

- A entrada da criação histórica contém addressId igual ao endereço confirmado.
  A saída dessa mesma criação contém o cartId posteriormente consultado. Não
  confundir ausência de addressId na **saída** com divergência na **entrada**.
- listAddresses associa addressId, formattedAddress, location.street/number/
  neighborhood/city/state, postalCode e coordinates ao mesmo registro.
- getCart.deliveryAddress contém somente streetName, streetNumber e neighborhood.
  Os três campos correspondem ao registro salvo. Não houve divergência observada.
- O retorno não contém addressId, cidade, estado, CEP ou coordenadas. Três campos
  coincidentes são evidência parcial, não identificação global inequívoca.
- getUser identifica a conta por e-mail, sem ID estável do provedor. O hash local
  usado na integração serve para escopo privado, não é um ID de usuário iFood.
  getUser/listAddresses/getCart foram lidos pela mesma conexão no ensaio 09; o
  histórico de criação em outra sessão não contém prova de proprietário por ID.

Portanto: identificador existe na requisição histórica e no registro salvo, mas
falta no **estado atual retornado do carrinho**. Não foi demonstrada troca de
registro ou de usuário; falta comprovação completa do vínculo atual. O código
passa a distinguir address_binding_mismatch (ID efetivamente diferente) de
address_binding_unconfirmed (ID ausente). Também não aceita dois IDs ausentes
como se fossem iguais. Correspondência parcial não remove o bloqueio.

Estratégia verificável para teste controlado:

1. Reautenticar a conta, reler endereços e confirmar ID/texto do mesmo registro.
2. Autorizar a composição específica; conservar privadamente contexto exato,
   hash da proposta, escopo da conta e entrada/saída da criação com o cartId.
   O journal atual evita duplicidades, mas não constitui sozinho prova de destino.
3. Conferir os campos retornados e recusar qualquer divergência. Para validar o
   vínculo atual, obter do iFood cartId → addressId ou localização completa estável
   equivalente. Se isso não existir, o time precisa aprovar uma etapa distinta de
   conferência humana do destino no aplicativo oficial e definir sua evidência,
   validade e invalidação após alterações. Esse aceite não foi implementado nem
   presumido. Nunca sintetizar addressId a partir de texto.
4. Não associar o carrinho histórico à proposta nova: a composição atual contém
   três itens e é independente das escolhas preliminares da demonstração.

Pergunta objetiva ao mentor: qual resposta de leitura confirma o addressId e o
proprietário de um cartId já existente? Qual garantia liga esses campos à criação
e permite detectar alteração posterior do destino?

## Financeiro: campos e diferença observada

Valores do carrinho histórico, sob o perfil BRL operacional testado anteriormente.
Conversão decimal exata; não são preços garantidos para uma proposta futura.

| Caminho no getCart | Centavos | Conferência |
| --- | ---: | --- |
| summary.subtotalAmount | 10870 | Igual à soma de items[].unitPrice × quantity |
| summary.deliveryFeeAmount | 0 | Igual a deliveryMethod.fee, zero explícito nesta amostra |
| summary.feeTotalAmount | 217 | Igual à soma de fees[].amount |
| summary.benefitsTotalAmount | 3990 | Agregado informado, sem origem/atribuição comprovada |
| summary.voucherTotalAmount | 0 | Zero explícito |
| summary.totalAmount | 8087 | Referência do total atual retornado pelo iFood |

Itens + entrega + taxas = 11087. Subtraindo os benefícios e voucher informados,
a fórmula produziria 7097; o total retornado é 990 maior. O delta líquido contra
itens + entrega + taxas é crédito de 3000. Isso **não prova** desconto oficial de
3000, nem explica a diferença de 990 ou a origem/sobreposição dos 3990.

Precisamos da fórmula oficial de summary.totalAmount, da semântica de cada
agregado e da identificação de benefícios já incluídos nos preços/subtotal.
Não há evidência para chamar feeTotalAmount de taxa de serviço exclusivamente.
Unidades universais por campo e promoções condicionais continuam dependendo do
provedor; moneyUnit permanece uma opção explícita, nunca inferida pela magnitude.

## Política opcional implementada para revisão

O padrão block_unattributed continua bloqueando. proportional_items anterior
permanece exigindo decomposição exata dos benefícios reportados. Nova opção:
proportional_unattributed_adjustment, ainda não selecionada no artefato privado
de preparação e não aprovada automaticamente para participantes.

- Usa subtotal + entrega + taxas e o total retornado, conservando todos os
  benefícios/vouchers originais na observação. Não os subtrai novamente.
- Distribui o crédito ou encargo líquido sem origem atribuída proporcionalmente
  ao valor bruto dos itens dos compradores **daquela loja**, usando BigInt e
  maiores restos em centavos; desempate pela ordem da proposta.
- Entrega/taxas continuam divididas igualmente apenas entre compradores da loja.
  Cada carrinho é conferido separadamente; não compensa parcela negativa de uma
  loja usando outra. Soma individual/consolidada deve coincidir com o total remoto.
- CommercialShare acrescenta unattributedAdjustment com creditCents/debitCents.
  Não são benefícios oficiais nem substituem os campos originais. CommercialReview
  acrescenta adjustmentPolicy com requiredParticipantIds.
- Só tolera total_decomposition_mismatch; endereço, unidade, subtotal, frete,
  taxas, composição ou dados ausentes continuam bloqueantes.
- A confirmação exige evento autenticado de **cada comprador afetado** aceitando
  a política e seus valores na mesma revisão, além do organizador. O excesso de
  orçamento continua exigindo aceite próprio. Qualquer mudança invalida aceites.
  canConfirmCommercial recebe eventos já autenticados pelo controlador; IDs de
  texto/LLM/JSON arbitrário não são autenticação. Não há autorização de compra.

Decisão do time/participantes: aceitar essa política local transparente ou manter
o bloqueio até esclarecimento oficial. Não apresentar a política como rateio
oficial do iFood. Não liberar submissão futura por esta decisão isoladamente.

## IA real: configurada, execução bloqueada por limite do provedor

Inicialmente a configuração da Ana Paula não estava disponível neste Mac. Durante
a tarefa o responsável atualizou o .env original; presença do provedor real e
construção do adaptador foram verificadas sem imprimir valores. Foi usado o
adaptador openai-compat existente e o provedor configurado pelo time (Groq).
FakeLlm não foi usado como evidência. Prompts/agente/modelos não foram reescritos.

runIntegrationRead agora recusa modo model sem LlmPort antes de acessar o MCP,
sem fallback literal. Testes controlados verificam as fases; não homologam Groq.
Não se deve compartilhar AI_API_KEY nem outras credenciais no chat.

Ensaios reais e limites registrados privadamente:

| Ensaio | Evidência | Resultado |
| --- | --- | --- |
| 10 | 6 leituras; busca anterior retornou 3 ofertas de lojas fechadas | Filtradas pelo Core; nenhum candidato e nenhuma chamada de IA. Exit 0 de leitura não prova proposta |
| 11 | 6 leituras; preferência genérica de demonstração retornou 20 lojas abertas em 2 páginas | Ainda havia continuação; busca interrompida pelo limite, sem IA |
| 12 | 7 leituras; um candidato da busca 11, mesma conta/endereço, getMerchant aberto e 20 produtos reais em 2 páginas | IA acionada duas vezes, uma resposta e uma falha; nenhuma proposta aceita |
| 13 | Replay explícito das respostas MCP reais do 12, com IA real e zero novas leituras MCP | Duas tentativas; uma falha genérica e uma LlmHttpError HTTP 429, kind rate_limit; Core interrompeu a classificação |

As duas páginas do cardápio pertencem integralmente ao merchantId selecionado e
ainda têm continuação. A seleção de um candidato no ensaio 12 reaproveita a
recuperação real do 11, sem afirmar busca global completa nem ótima. A porta
de cardápio foi a implementação real; não houve catálogo simulado. No total:
listTools × 3, getUser × 3, listAddresses × 6, searchOffers × 4,
getMerchant × 1, browseOffers × 2. Todas as respostas de ferramentas registradas
nessa rodada vieram sem isError true. Nenhum getCart novo foi necessário.

O limite de requisições do Groq é bloqueio externo confirmado, separado do MCP.
A primeira falha genérica/primeira resposta não permitem afirmar a causa de
todas as tentativas; não se conclui que a chave esteja inválida nem que haja
defeito nos prompts. Nenhuma proposta gerada com IA real foi homologada. Não
continuar repetindo consultas: Ana Paula deve conferir a cota/modelo configurado
e definir a próxima tentativa, sem trocar provedor/modelos silenciosamente.

Plano privado pronto: ~/.local/share/foodjam-validation/integration-plan-10-model-private.json.
Usa o endereço comprovado e solicita modo model, sem associar o carrinho histórico.
Esse plano já foi executado no ensaio 10. O comando ilustra a execução quando
houver disponibilidade comercial e cota; usar nome de relatório novo. --env deve
apontar para o arquivo local configurado, atualizado pelo usuário nesta tarefa:

```bash
cd /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam
npm run integrar:ifood -- \
  --input "$HOME/.local/share/foodjam-validation/integration-plan-10-model-private.json" \
  --report "$HOME/.local/share/foodjam-validation/integration-report-next-model-private.json" \
  --env /Users/andrei/FoodJam/.env
```

Não executar o mesmo plano indefinidamente; o produto daquela busca estava em
lojas fechadas no ensaio 10. A CLI não imprime prompts, payloads ou erros
brutos. Sua captura genérica de falha ainda exige distinguir nos dados privados
se o catálogo chegou a responder; indisponibilidade do modelo não invalida a
leitura MCP anterior. Plano limitado a três páginas por loja, 14 leituras totais.

## Preparação, teste controlado e Telegram

Preparação já disponível: evento autenticado do organizador → autoridade opaca
vinculada à composição/conta → uma reserva persistente por sessão/proposta/loja
→ createCart → getCart → revisão. Repetição lê o carrinho registrado; timeout
ambíguo bloqueia recriação. Duas lojas preservam falhas parciais e não anunciam
sucesso consolidado. Criar uma proposta nova para contornar reserva é proibido.

Condições para o próximo teste de carrinho: autorização humana nova para a
composição/conta/endereço exatos, produtos sem opções obrigatórias desconhecidas,
journal privado durável, conta conferida e plano de conferência do destino.
Autorização de criar não aprova valores, política de ajuste, pagamento ou compra.
O comando preparar:ifood do handoff exige TTY/frase de confirmação e **não foi
executado**. Nenhuma mutação desta tarefa estava autorizada.

Para Telegram: descoberta/preliminar podem ser conectadas com limitações visíveis.
O ciclo comercial ainda não está homologado para uso real completo. É necessário
persistir a proposta atual, serializar eventos, autenticar callbacks do organizador,
conferir a conta MCP, apresentar pendências por loja e colher aceites individuais
da política/excesso vinculados à revisão. Não ligar submitOrder nem converter
blocked em sucesso. Endereço digitado continua intenção: validar, confirmar e
cadastrar são etapas separadas; createAddress requer consentimento de escrita.

## Evidências e verificação

Auditoria sanitizada privada: commercial-unblock-audit-private.json, fora do Git.
Snapshot privado das alterações anteriores preservado antes desta rodada.
Fixture financeira conserva preços/quantidades/agregados observados, substituindo
IDs e endereço por dados fictícios identificados; nunca entra no fluxo de produção.
Regressões cobrem ajuste positivo/negativo, duas lojas, centavos, aceites/revisão,
outros bloqueios, endereço ausente/divergente e modo model sem configuração.
Revisão independente sem achados bloqueantes nos cálculos/gates.

Verificação final: npm run check com 1168 testes em 49 arquivos, lint e TypeScript
aprovados; npm run build e git diff --check aprovados. O lint inicial apontou aspas
duplas na fixture gerada; corrigidas e check integral executado novamente. Scan
de 158 arquivos versionáveis sem credenciais configuradas nem dados pessoais das
evidências; inspeção repetida para a chave nova de IA, sem correspondências.
Checkout original conferido contra backup: patch e 16 arquivos não rastreados
preservados. Nenhum commit, push, merge ou alteração de Telegram/src/index.ts.
IF-05 permanece aberta: IA sem proposta validada, destino comercial incompleto
e teste de criação ainda dependente de autorização específica.
