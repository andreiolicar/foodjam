# Íris — Relatório de Teste de Pedido Colaborativo

**Projeto:** Íris — Hackathon SEMCOMP × iFood 2026  
**Data do teste:** 17/10/2026  
**Tipo:** Prova de conceito exploratória, com execução manual via OpenCode e MCP do iFood  
**Status:** Concluído com ressalvas — carrinho e rateio simulados; pedido não submetido

## 1. Objetivo

Verificar se o MCP do iFood permite reunir produtos destinados a diferentes participantes em **um único carrinho** e obter dados suficientes para que a Íris organize recomendações, respeite orçamentos e calcule um rateio coletivo.

Este teste **não** validou o bot no Telegram, a integração MCP em um backend próprio nem a conclusão de uma compra. O OpenCode foi usado como cliente de experimentação das ferramentas do MCP.

## 2. Cenário e critérios

Três participantes fictícios fizeram um pedido coletivo para o mesmo endereço de entrega, por intermédio de um consumidor autenticado que representa o organizador.

| Participante | Preferência/restrição | Limite individual, incluindo taxas |
| --- | --- | ---: |
| Andrei (organizador) | Hambúrguer | R$ 45,00 |
| Bia | Opção vegetariana | R$ 40,00 |
| Caio | Preferência por frango | R$ 35,00 |

Critérios definidos antes do teste:

1. Encontrar **um restaurante** com produtos compatíveis para os três.
2. Consultar informações reais de estabelecimento e itens; não inventar preços ou disponibilidade.
3. Pedir autorização antes de criar ou alterar o carrinho.
4. Montar um carrinho e verificar seus dados financeiros.
5. Calcular um rateio em centavos inteiros que some exatamente o total usado como referência.
6. Não executar `ifood_submitOrder`, não configurar pagamento e não iniciar checkout.

## 3. Ambiente e ferramentas

- **Cliente de teste:** OpenCode, em modo *Build* nas operações de escrita.
- **Modelo mostrado nas sessões:** GLM-5.3-Flash Free.
- **Integração:** servidor remoto do MCP do iFood, autenticado por OAuth.
- **Perfil e endereço:** obtidos de `ifood_getUser` e `ifood_listAddresses`; os dados pessoais completos foram omitidos deste relatório.
- **Restaurante selecionado:** Corta Pra Mim Hamburgueria Artesanal.

### Ferramentas observadas no teste

| Ferramenta | Chamadas registradas | Finalidade |
| --- | ---: | --- |
| `ifood_getUser` | 1 | Consultar usuário autenticado |
| `ifood_listAddresses` | 1 | Consultar endereços existentes |
| `ifood_searchOffers` | 6 | Buscar estabelecimentos e itens |
| `ifood_browseOffers` | 5 | Navegar catálogo e paginação |
| `ifood_getMerchant` | 3 | Verificar estabelecimentos |
| `ifood_getItem` | 4 | Verificar informações dos produtos |
| `ifood_createCart` | 1 | Criar carrinho coletivo |
| `ifood_getCart` | 3 | Consultar carrinho e totais |
| `ifood_getCartDeliveryMethods` | 2 | Consultar modalidade e custo de entrega |

Contagens conforme o relatório final do OpenCode. Não foram disponibilizados logs integrais das respostas para auditoria independente.

## 4. Execução e resultados

### 4.1 Descoberta e seleção

A busca localizou um estabelecimento com as três opções abaixo. Segundo os retornos relatados de `ifood_getItem`, todos os itens tinham o mesmo `merchantId`, estavam ativos e pertenciam ao restaurante selecionado.

| Participante | Produto | Valor bruto |
| --- | --- | ---: |
| Andrei | Tradicional One | R$ 35,90 |
| Bia | Vegetariano burger | R$ 39,90 |
| Caio | Nuggets (12 unidades, de frango) | R$ 32,90 |
| **Total** | | **R$ 108,70** |

A caracterização vegetariana foi inferida da descrição do produto; o teste não identificou atributo dietético estruturado suficiente para certificá-la de forma independente.

### 4.2 Criação e leitura do carrinho

Depois da autorização, `ifood_createCart` criou um carrinho. A leitura posterior confirmou os três itens, cada um com quantidade 1. Segundo a auditoria relatada, os itens foram incluídos na operação de criação, sem chamadas separadas a `ifood_addItemToCart`.

`ifood_getCartDeliveryMethods` apresentou entrega **Padrão**, com taxa informada de **R$ 0,00** e estimativa de **39–49 minutos**. Essa estimativa não é garantia de prazo.

### 4.3 Divergência financeira encontrada

| Componente | Valor observado |
| --- | ---: |
| Subtotal dos itens | R$ 108,70 |
| Taxa de serviço | R$ 2,17 |
| Entrega informada | R$ 0,00 |
| Benefícios no retorno de `createCart` | R$ 9,90 |
| **Total no retorno de `createCart`** | **R$ 110,87** |
| Benefícios no retorno de `getCart` | R$ 39,90 |
| **Total atualizado em `getCart`** | **R$ 80,87** |

O total de `getCart` foi observado de forma estável em leituras subsequentes, conforme o relatório. Entretanto, os benefícios não vieram decompostos por tipo, campanha ou item.

A diferença efetiva inferida entre os componentes conhecidos e o total atualizado é:

`R$ 108,70 + R$ 2,17 + R$ 0,00 − R$ 80,87 = R$ 30,00`

É **plausível**, mas **não comprovado**, que os R$ 39,90 informados em benefícios reúnam R$ 9,90 de frete promocional e R$ 30,00 de desconto nos produtos. Essa hipótese **não foi usada como fato** no relatório.

**Decisão:** para esta simulação, adotar os **R$ 80,87 retornados por `getCart`** como referência operacional, sem considerá-los garantia do total final de checkout. O ajuste de R$ 30,00 foi classificado como **diferença calculada, de origem não identificada**.

## 5. Política experimental de rateio

Para poder concluir a simulação sem atribuir indevidamente o desconto a uma pessoa, foi autorizada a seguinte **política de teste**, que não representa regra oficial do iFood:

- Cada participante recebe integralmente o valor bruto de seu item.
- Os R$ 2,17 de taxa de serviço são divididos igualmente; o centavo residual vai ao participante com maior subtotal bruto (Bia).
- A diferença efetiva de R$ 30,00 é distribuída proporcionalmente aos valores brutos dos itens, utilizando centavos inteiros e método dos maiores resíduos.
- O desempate do rateio proporcional segue maior subtotal bruto e, em seguida, nome.
- Os limites individuais devem ser respeitados; nenhuma compra é autorizada pelo cálculo.

### Rateio final da simulação

| Participante | Itens | Taxa de serviço | Ajuste proporcional | Total simulado | Limite | Resultado |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Andrei | R$ 35,90 | R$ 0,72 | −R$ 9,91 | **R$ 26,71** | R$ 45,00 | Dentro |
| Bia | R$ 39,90 | R$ 0,73 | −R$ 11,01 | **R$ 29,62** | R$ 40,00 | Dentro |
| Caio | R$ 32,90 | R$ 0,72 | −R$ 9,08 | **R$ 24,54** | R$ 35,00 | Dentro |
| **Total** | **R$ 108,70** | **R$ 2,17** | **−R$ 30,00** | **R$ 80,87** | | |

**Conferências aritméticas:** taxas = 72 + 73 + 72 = **217 centavos**; ajustes = 991 + 1.101 + 908 = **3.000 centavos**; participantes = 2.671 + 2.962 + 2.454 = **8.087 centavos**. A soma coincide exatamente com o total de referência de R$ 80,87.

O resumo inicial do OpenCode distribuiu o centavo adicional da taxa de serviço ao organizador (R$ 0,73 / R$ 0,72 / R$ 0,72); a tabela acima o atribui à Bia (R$ 0,72 / R$ 0,73 / R$ 0,72), aplicando de maneira consistente o desempate definido por maior subtotal bruto. Ambas as distribuições somam R$ 2,17, mas esta é a regra documentada para implementação.

A autorização anterior para o organizador assumir até R$ 0,40 do valor de Bia **não precisou ser utilizada** com esta política. O rateio é uma **simulação financeira condicionada à política aprovada**, não um rateio oficial do provedor.

## 6. Limitações e achados técnicos

| Código | Observação | Impacto / encaminhamento |
| --- | --- | --- |
| `MCP-01` | `searchOffers` com `refinements.merchantId` aparentemente retornou resultados globais. | Investigar contrato e filtros; alternativa observada: `browseOffers` com paginação. |
| `MCP-02` | `getCart` mostrou benefícios agregados sem discriminação por campanha, item ou entrega. | Impede atribuição auditável do desconto a participantes específicos. |
| `MCP-03` | Benefícios e total mudaram entre `createCart` e `getCart`, sem histórico de alterações explicitado na resposta. | Exige nova leitura do carrinho antes de confirmar ou mostrar um total. |
| `MCP-04` | `getCart` precisa de `cartId`; não foi identificada ferramenta para descobrir carrinho ativo sem ID. | Persistir o identificador da sessão do carrinho no backend. |
| `MCP-05` | Identificação de opção vegetariana baseada em texto descritivo, não em atributo dietético verificado. | Tratar restrições alimentares com cautela e pedir confirmação quando houver ambiguidade. |

Os itens acima são **observações do teste** e precisam ser confirmados com documentação ou engenharia do iFood antes de serem classificados como defeitos do serviço.

## 7. Segurança e fronteira de autorização

- `ifood_submitOrder`: **não chamado**.
- `ifood_setCartPayment`: **não chamado**.
- Checkout, pagamento e criação de pedido: **não executados nesta simulação**.
- Carrinho criado e consultado: **sim**; nenhuma compra foi concluída.
- O endereço detalhado do consumidor, identificadores de autenticação e o `cartId` completo **não devem ser publicados** no repositório. O identificador completo pode ficar em logs locais protegidos, se necessário para depuração.

A prova anterior do tutorial de configuração, que chegou à geração de um Pix, é **separada** deste teste colaborativo e não deve ser confundida com ele.

## 8. Resultado do teste

| Critério | Situação |
| --- | --- |
| Um restaurante com opções para três pessoas | **Atendido no cenário** |
| Consulta por ferramentas reais do MCP | **Atendido** |
| Carrinho único contendo três itens | **Atendido** |
| Consulta de entrega e total atualizado | **Atendido** |
| Rateio em centavos com soma exata | **Atendido sob política experimental** |
| Origem dos descontos auditável | **Não atendido** |
| Pagamento ou conclusão do pedido | **Fora do escopo** |
| Operação em grupo real do Telegram | **Não testado** |
| Integração no backend TypeScript da Íris | **Não testado** |

**Conclusão:** o teste oferece evidência de viabilidade da **composição comercial de um pedido coletivo em um carrinho do iFood**. A inteligência coletiva, o fluxo do Telegram, a autenticação no backend próprio e a reconciliação financeira confiável ainda exigem implementação e novos testes.

## 9. Recomendações e próximos passos

1. Implementar `src/ifood/` usando cliente MCP próprio, com autenticação OAuth, descoberta de ferramentas, erros e contratos extraídos dos schemas reais.
2. Guardar o `cartId` vinculado à sessão e ao organizador; não reutilizar indevidamente credenciais do OpenCode.
3. Implementar o rateio em `src/core/` usando centavos inteiros, política explícita de descontos, testes de arredondamento e verificação de limites.
4. Quando os componentes financeiros não forem conciliáveis, mostrar ao organizador o total atualizado do provedor e sinalizar a incerteza do rateio; **não finalizar a compra automaticamente**.
5. Validar, no Telegram, autorização do organizador, coleta privada de orçamento e revisão final antes do checkout.
6. Levar aos mentores os achados `MCP-01` a `MCP-04` e pedir esclarecimentos sobre a origem e a aplicação dos benefícios.

## 10. Feedback para a equipe MCP do iFood

Seria útil disponibilizar no retorno de `getCart` uma estrutura de benefícios com **tipo, valor, campanha, item beneficiado e impacto efetivo no total**, além de separar explicitamente descontos de entrega e descontos de produtos. Um histórico ou explicação das mudanças de valores entre `createCart` e `getCart` também melhoraria a auditabilidade do pedido. Para buscas, convém esclarecer a semântica e o comportamento do filtro `merchantId`.

---

**Fonte:** registros e resumos de execução do OpenCode compartilhados durante o hackathon em 17/10/2026. Este documento distingue resultados observados, cálculos derivados e hipóteses. Não houve acesso neste relatório ao payload JSON bruto integral das ferramentas.
