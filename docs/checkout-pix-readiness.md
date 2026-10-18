# Checkout e Pix — capacidades comprovadas e bloqueadores

Status: **BLOCKED**. Base de desenvolvimento: main `bc8092d89ca0195fb3873c0d1399917f5cb5c8d2`,
após integração do PR #9, incluindo a correção de quantidade `75d2e8d` e a UX do PR #10.
Este checkpoint implementa a conferência somente leitura e registra contratos
reais. Não habilita pagamento/submissão baseados em respostas desconhecidas.

## Inspeção autenticada de 18/10/2026

O cliente OAuth/transporte existente conectou e enumerou **23 ferramentas**.
A inspeção de catálogo executou somente `listTools`; depois uma conexão de leitura
consultou o carrinho já registrado no journal e os métodos da respectiva loja:
**um getCart e um listPaymentMethods**, sem mutações. As conexões foram encerradas.
Não houve polling novo, chamada de IA ou mensagem no Telegram.

Nome, descrição e inputSchema das cinco ferramentas foram extraídos fielmente
para `mcp-checkout-contracts.json`; outros metadados não foram incluídos.
Nenhuma delas fornece `outputSchema`. As annotations são genéricas e não concedem
permissão de escrita. As allowlists e os gates independentes continuam necessários.

| Ferramenta descoberta | Contrato de entrada comprovado | Limite da evidência |
| --- | --- | --- |
| `listPaymentMethods` | `merchantId`: UUID da loja do carrinho | Resposta real contém `paymentMethods[]` e `agentHints.nextStepBeforeCheckout` |
| `setCartPayment` | `cartId`: UUID; `paymentMethodId`: UUID; `cardTokenId`: UUID opcional | Seleciona/modifica pagamento do carrinho. Nenhuma execução realizada |
| `submitOrder` | `cartId`: UUID obrigatório; `userConsent`: boolean opcional no schema; `document`: string opcional | Descrição exige confirmação explícita; o Core precisará exigir consentimento válido, apesar de opcional no schema. Não foi executada |
| `getOrder` | `orderId`: string | Pedido real e formato da resposta não disponíveis nesta inspeção |
| `trackOrder` | `orderId`: string; `nextPageToken`: string opcional | Descrição menciona eventos e dicas de polling; formato/intervalo retornado não comprovados |

## Pix

A resposta real da loja contém um método com `kind` e `brand` iguais a `PIX`,
`displayName` igual a `Pix`, e um `paymentMethodId` que satisfaz UUID. O identificador real ficou somente
na evidência privada. Não usar a string literal `PIX` como ID: a descrição dá esse
exemplo, mas o inputSchema vigente exige UUID. Para Pix, omitir `cardTokenId`.

O hint retornado solicita `setCartPayment` com o método escolhido pelo usuário antes
do checkout. Portanto a seleção exige uma escrita separada no carrinho, que não foi
autorizada nem executada durante a investigação.

`submitOrder` está de fato disponível; não há bloqueador de ausência dessa ferramenta.
Porém o catálogo não documenta o formato de seu resultado, onde obter a identidade
do pedido, em qual etapa o Pix é gerado, nem os campos do código copia e cola,
QR Code e vencimento. Não há ferramenta separada de Pix/QR na lista descoberta.
`getOrder` menciona pagamento na descrição, mas não comprova esses campos.
Não chamar `getOrder`/`trackOrder` com IDs inventados ou de carrinhos.

Falta documentação específica ou uma resposta autorizada/sanitizada que prove esses
contratos. A presença de Pix na lista não prova exposição de código Pix pelo MCP.
Não confundir essa lacuna com prova de que o serviço não suporta Pix.

## Bloqueadores comerciais atuais

1. A leitura atual de `getCart` retornou `deliveryAddress` com dados textuais,
   **sem `addressId`**. Não foi comprovado campo equivalente. O ID enviado em
   `createCart` não confirma por si só o vínculo retornado. A pendência de endereço
   continua bloqueando a confirmação.
2. Agregados retornados novamente: subtotal R$ 35,99, entrega R$ 0,00, taxas R$ 0,99,
   benefícios R$ 22,98, voucher R$ 0,00, total remoto R$ 18,99. A decomposição usada
   pelo guardrail resulta em R$ 14,00, diferença de R$ 4,99. Falta a definição de
   `benefitsTotalAmount` e de sua relação com os demais agregados. Não mudar sinais,
   fórmula, descontos ou tolerância para forçar igualdade.
3. O carrinho existente nasceu antes da correção de quantidade. Não corrigir,
   recriar ou submeter esse carrinho implicitamente; a composição correta precisa
   ser comprovada na revisão autorizada. O journal existente não foi alterado.
4. Contratos de retorno de submissão e Pix continuam desconhecidos. Fixtures
   inventadas desses retornos não seriam validação do MCP real.

## Caminho mínimo para homologação posterior

### Parte comprovável implementada

Após preparar o carrinho pelo botão vigente, o organizador pode enviar `/checkout`
no privado. A rota usa a sessão vinculada à preparação, exige o organizador e a
mesma identidade/composição/endereço, e compartilha a trava/prazo comercial.
Não funciona no grupo, antes de preparar ou depois de substituir a proposta.

A composição real relê os carrinhos registrados no journal, sem criá-los. Somente
lojas com observação de carrinho comprovada têm métodos consultados. O parser aceita
`paymentMethods[]` com IDs UUID e `kind` inequívoco, rejeita IDs repetidos/ambíguos,
não usa o rótulo exibido como prova de Pix e descarta tokens de cartão.
As duas lojas permanecem separadas; falha de leitura não inventa um método.

O privado mostra disponibilidade de Pix, total remoto explicitamente não confirmado
e pendências comerciais. Não expõe IDs de carrinho/pagamento ou tokens. Não oferece
botão de compra, não seleciona método e não contém executor de submissão. Bloqueios
de retorno da submissão e de dados Pix permanecem mesmo com carrinho reconciliado.

### Etapas ainda bloqueadas

Antes de implementar/habilitar a escrita de checkout, obter os contratos ausentes
e resolver as evidências de endereço, composição e valores. Reutilizar as camadas
e o journal existentes, sem alterar descoberta, cascata de IA ou cards individuais.

1. Reler o carrinho conhecido e validar loja, itens, quantidades e endereço; conservar
   todos os agregados remotos e bloquear qualquer pendência não reconciliada.
2. Consultar métodos reais; apresentar Pix privadamente ao organizador. A escolha
   explícita autoriza somente a configuração daquele carrinho, não a compra.
3. Registrar duravelmente a tentativa antes de `setCartPayment`; resultado incerto
   exige leitura/reconciliação, sem repetir automaticamente a escrita.
4. Reler o carrinho após a configuração. Exibir valores/condições finais no privado;
   qualquer mudança invalida a confirmação anterior. Uma confirmação por loja,
   conta, carrinho e revisão vigente, alertando sobre pedido efetivo/possível cobrança.
5. Somente a confirmação inequívoca do organizador poderá autorizar `submitOrder`
   com `userConsent: true`. Reservar e sincronizar o journal antes do envio; guardar
   resultado/identidade antes das leituras seguintes. Sem retry automático, inclusive
   após timeout, reinício ou clique duplicado. Sem idempotency key inventada.
6. Ler/acompanhar exclusivamente a identidade de pedido comprovada. Mostrar código
   Pix e vencimento somente quando retornados em campos homologados, no privado,
   sem logs de pagamento. Resposta sem esses dados não pode produzir Pix fabricado.

Duas lojas exigem carrinhos, confirmações, pedidos e pagamentos independentes;
falha parcial não pode ser apresentada como sucesso coletivo.

Os testes futuros de transporte controlado deverão cobrir o caminho completo depois
de homologados os formatos, além de rejeição, preço alterado, endereço divergente,
pendências financeiras, respostas ambíguas, cliques duplicados, callbacks antigos,
reinício e ausência de capacidade. A regressão atual cobre a composição real
`criarAplicacaoReal` em transporte controlado: proposta, carrinho consolidado, preço
atualizado na releitura, Pix com formato observado e conferência somente no privado do organizador.
Há testes de recusa, UUID inválido, IDs duplicados, isError, capacidade ausente,
duas lojas, autorização, concorrência, troca e timeout. Não há teste de compra
completa ou de geração Pix inventada neste checkpoint.

As referências de parceiros fornecidas para módulos food/groceries não são o contrato
do MCP. A tentativa de leitura dessas duas páginas recebeu HTTP 403 neste ambiente;
nenhum campo dessas APIs foi transplantado para o fluxo.

## Segurança operacional

PID ativo e journal privados preservados. Nenhuma chamada de `setCartPayment`,
`submitOrder`, `createCart`, entrega ou cadastro de endereço foi executada.
A aplicação continua sem executor habilitado para submissão. Este relatório não
autoriza pedido real nem substitui a confirmação futura do organizador.
