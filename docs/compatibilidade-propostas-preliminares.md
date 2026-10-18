# Compatibilidade conservadora na descoberta preliminar

Base: `412dc303420344707c65e27b867b6441901278ae`.
Branch isolada: `codex/semantic-compatibility-guard`.

## Diagnóstico do ensaio de 18/10/2026

O log sanitizado existente da instância PID 6038 confirma três classificações
Groq com HTTP 200 e uma descoberta `preliminary_ready`: três buscas, uma loja,
doze produtos e cobertura limitada por paginação, catálogo parcial, produtos,
tempo e janela de classificação. O log não guarda nomes/IDs dos candidatos nem
as listas brutas `atende`/`substitutos`. Não permite afirmar se havia cappuccino
ou croissant na amostra, nem atribuir a classificação exata ao provedor. O relato
de “sugestão parecida” corresponde ao indicador de substituto na apresentação.

A reprodução controlada demonstrou um defeito independente no Core: a saída da
IA era filtrada apenas por elegibilidade/IDs e categorias amplas. Cappuccino e
água eram bebidas; croissant e misto eram comidas. O filtro aceitava ambos os
erros em `atende` e `substitutos`. As combinações, ordenadas por pessoas com item
antes da quantidade de substitutos, então favoreciam cobertura artificial.

## Política implementada

A IA continua classificando e ordenando candidatos. Antes de gerar qualquer
combinação, o Core aplica a mesma prova conservadora a ambas as listas:

- Pedido específico exige identidade no início do nome real do produto, com
  palavras inteiras normalizadas, plurais simples e equivalências explícitas.
  A regra vale também para nomes desconhecidos; não depende de uma lista dos
  três produtos do ensaio. Não usa aproximação por distância de edição.
- Grafias/sinônimos como cappuccino/capuccino, hambúrguer/hamburger,
  refrigerante/refri, mandioca/aipim e pão francês/pão de sal são normalizados.
  Sinônimo desconhecido não é inventado ou inferido pelo guardrail.
- Qualificadores, números e “com” são preservados: pão com queijo não demonstra
  pão de queijo; suco artificial não demonstra suco natural; pizza de três
  queijos não demonstra pizza de quatro queijos.
- Insumos como pó, cápsula, sachê, concentrado, mistura, café moído, em grãos ou
  solúvel exigem o mesmo formato explicitamente solicitado. Uma categoria
  declarada contraditória pode vetar o item, mas nunca comprova sua identidade.
- Pedidos amplos usam evidência positiva de tipos de produto reconhecidos.
  Café da manhã admite alimentos e bebidas pertinentes; “lanche”, “almoço” e
  indiferença alimentar preservam variedade. Nomes desconhecidos não viram
  comida pela ausência de um termo de bebida. Taxas, categorias e acompanhamentos
  genéricos não são provas de uma refeição.
- Descrição, nome da loja, preço e categoria comercial não justificam identidade
  de um produto específico. Restrições alimentares e rejeições anteriores ao
  classificador continuam prevalecendo.

Sem evidência, o ID é descartado antes das combinações. A ordenação e os limites
de consulta/duas lojas permanecem iguais; “Outra opção” usa somente classificações
já filtradas. Nenhum produto, nome ou preço é criado para aumentar a cobertura.

## Cobertura e limites

O resumo mantém “X de Y pessoas com item” e separa pessoas com item do pedido,
com alternativa compatível e sem item adequado. Uma pessoa com algum substituto
fica no grupo de alternativas; os grupos são exclusivos. A contagem representa
pessoas com algum item, sem prometer atendimento de todos os desejos de uma
pessoa. Quem não recebeu item continua na sessão e aparece como sem item
compatível nesta amostra. Sem nenhuma escolha, permanece o fluxo existente
`no_candidates`, que não afirma ausência do produto no catálogo geral.

Cards individuais, fotos, avaliações, preços unitários e callbacks não mudaram.
O resumo não repete a lista de produtos nem adiciona subtotal ou total.

O guardrail é deliberadamente conservador: nomes comerciais, ordem diferente de
palavras, formatos/qualificadores não demonstrados e sinônimos desconhecidos podem
ser omitidos mesmo quando a IA os aceitaria. Não é uma ontologia universal nem um
analisador completo de nomes internamente contraditórios. Qualidades subjetivas
como “leve” continuam dependendo da classificação da IA; não se inventam dados
nutricionais. Essa limitação não dispensa as restrições alimentares existentes.

## Regressões e validação offline

| Cenário | Antes | Depois |
| --- | --- | --- |
| A: misto, cappuccino e croissant; catálogo só com misto e água | IA podia produzir 3/3 | Só o misto para quem pediu; 1/3 e duas pessoas sem item |
| B: os três produtos reais presentes | A ordem de IDs incompatíveis podia dominar | 3/3, cada produto associado ao participante correto, até duas lojas |
| C: café da manhã amplo | Bebidas pertinentes podiam ser vetadas como comida | Variedade pertinente preservada, sem impor um produto específico |
| D: IA marca incompatível em `atende` ou `substitutos` | Categorias amplas deixavam passar | Core descarta em ambas as listas e também nas alternativas |

Baseline: 1.523 testes. RED inicial: dez falhas em 29 casos, incluindo a falsa
cobertura 3/3. Regressões adicionais reproduziram os bypasses de qualificadores,
conectores, números, desconhecidos e insumos antes das respectivas correções.
GREEN final: 51 testes de compatibilidade pela descoberta real do Core e dois
novos cenários na composição `criarAplicacaoReal`, com MCP/HTTP/Telegram controlados.

O teste existente de lojas abertas passou isoladamente, mas falhou após o caso
de duas lojas por reaproveitar o mock HTTP que ainda pedia açaí. O `beforeEach`
agora restaura a implementação padrão; nenhum dado de catálogo ou asserção
existente foi alterado para esconder a rejeição semântica.

`npm run check`: **1.576 testes em 81 arquivos**, lint e typecheck aprovados.
`npm run build`: aprovado. A revisão independente confirmou os achados corrigidos,
sem bloqueadores remanescentes no escopo. Não houve chamadas reais MCP, IA ou
Telegram, alterações de credenciais, reinício do bot, push ou cutover.

Não foram alterados contratos MCP, descoberta de lojas abertas, limites de rede,
cascata Groq → Gemini → OpenRouter, preços ou permissões comerciais. A composição
continua preliminar; carrinhos, pagamentos, compras e `submitOrder` não receberam
nenhum novo caminho de execução.
