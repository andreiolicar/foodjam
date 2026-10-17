# MCP-02 — Benefícios sem detalhamento e mudança do total do carrinho

**Projeto:** Íris | Hackathon SEMCOMP × iFood 2026  
**Data da observação:** 17/10/2026  
**Ferramentas:** `ifood_createCart`, `ifood_getCart`, `ifood_getCartDeliveryMethods`  
**Classificação:** Possível limitação de observabilidade / contrato de resposta — **falha do MCP não confirmada**  
**Status:** Aguardando esclarecimento da equipe iFood

## Contexto

Durante um teste de pedido colaborativo com três itens de um mesmo restaurante, o total e o valor agregado de benefícios mudaram entre a criação e a leitura do carrinho, sem alteração relatada dos itens. As respostas examinadas pelo agente não permitiram identificar a origem e a destinação dos descontos.

## Evidências observadas

| Campo | `ifood_createCart` | `ifood_getCart` |
| --- | ---: | ---: |
| Subtotal dos itens | R$ 108,70 | R$ 108,70 |
| Taxa de serviço | R$ 2,17 | R$ 2,17 |
| Entrega informada | R$ 0,00 | R$ 0,00 |
| Benefícios agregados | R$ 9,90 | R$ 39,90 |
| **Total retornado** | **R$ 110,87** | **R$ 80,87** |

- O total de **R$ 80,87** permaneceu estável em leituras posteriores de `ifood_getCart`, conforme os registros da sessão.
- A redução entre totais foi de **R$ 30,00**; o aumento dos benefícios agregados também foi de **R$ 30,00**.
- Com os componentes conhecidos, a diferença efetiva implícita no total atualizado é **R$ 30,00**: `108,70 + 2,17 + 0,00 − 80,87 = 30,00`.
- **Não foi identificada**, nos retornos analisados, uma decomposição dos R$ 39,90 por campanha, item ou desconto de entrega.

## Comportamento esperado e dúvida técnica

Para calcular um rateio auditável, o consumidor do MCP precisa distinguir:

- valor bruto dos itens e taxas efetivamente cobradas;
- desconto de item, desconto geral do carrinho e benefício de entrega;
- valor que cada benefício efetivamente abate do total;
- momento ou motivo de recálculo entre criação e consulta do carrinho.

**Questão para o iFood:** os R$ 9,90 representam benefício de frete já refletido na entrega de R$ 0,00 e os R$ 30,00 adicionais correspondem a uma promoção aplicada posteriormente? Essa composição é **apenas uma hipótese**, não uma conclusão do teste.

## Impacto

Em pedidos coletivos, não é possível atribuir com segurança um desconto a um participante específico ou distribuir um benefício geral sem conhecer sua origem. Um agente pode produzir um rateio cuja soma bate com o total, mas cuja distribuição não corresponde à regra comercial da promoção. Isso afeta transparência, explicabilidade e confiança na revisão financeira.

## Sugestão de melhoria

1. Expor em `ifood_getCart` uma lista estruturada de benefícios aplicados, incluindo **tipo, valor, campanha, escopo (item/carrinho/entrega) e desconto efetivo no total**, quando disponíveis.
2. Separar descontos já refletidos em preços ou frete daqueles que ainda devem ser subtraídos do total, evitando dupla contagem.
3. Documentar se valores e promoções podem ser recalculados entre `createCart` e `getCart`, com indicação de atualização ou versão do cálculo.
4. Esclarecer qual campo deve ser considerado o **total atual do carrinho** e em qual etapa ele pode mudar antes do checkout.

## Reprodução e limites da evidência

1. Com usuário de teste autenticado, criar carrinho com três itens do mesmo restaurante.
2. Registrar subtotal, taxas, benefícios e total do retorno de `ifood_createCart`.
3. Consultar `ifood_getCart` com o `cartId` retornado e comparar os componentes; repetir a leitura sem alterar o carrinho.
4. Inspecionar a eventual discriminação de descontos, campanhas e encargos.

**Importante:** esta ocorrência foi documentada a partir dos resultados e da auditoria relatados pelo OpenCode, **não** de um arquivo com os JSONs brutos integrais. Portanto, a ausência de campos foi observada nas respostas analisadas, e não comprovada para todas as versões ou contextos do MCP. Nenhum checkout ou pagamento foi realizado neste teste.

**Registro relacionado:** [Relatório de teste de pedido colaborativo](../teste-pedido-colaborativo-iris.md), seção 4.3 e achados `MCP-02`/`MCP-03`.
