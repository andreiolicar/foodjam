# Orçamento de tempo da descoberta preliminar

Base isolada: `4330b5da05bfc57a6b7166203150405294699391`.
Branch: `codex/discovery-time-budget`.

## Evidência real e limites

O evento sanitizado do ensaio de 18/10/2026, 08h49–08h50, informa:

- `no_candidates`, `time_limit` e `pagination_truncated`;
- quatro termos pesquisados, 39 lojas candidatas, uma revalidação;
- zero lojas aceitas com menu e zero produtos no Core;
- nove chamadas **lógicas da porta**, não nove chamadas MCP/HTTP.

Os logs não guardam duração por ferramenta, páginas, horário do evento de
descoberta ou conteúdo dos candidatos. Não permitem afirmar o tempo total exato,
o número bruto de ferramentas/páginas, nem que faltavam produtos compatíveis.
Também não comprovam que uma loja ou oferta estava validada antes do deadline.

O código anterior aguardava todas as buscas MERCHANT/ITEM e suas páginas antes
de verificar lojas. Cada método resolvia novamente o endereço por `listAddresses`.
`getMenu` ainda faz uma revalidação independente `getMerchant` antes do browse.
Com quatro termos, nove chamadas lógicas e uma loja verificada, o fluxo situa o
esgotamento após `getStore` e antes de iniciar `getMenu`: não havia produto
validado que pudesse ser apresentado com segurança. Isso não prova inexistência
no catálogo geral.

## Correção localizada

- Prazo total preservado: 45 segundos por padrão; limites existentes continuam
  validados e não foram aumentados.
- A porta opcional `forDiscovery` valida a localização uma vez e retorna um
  escopo restrito ao mesmo endereço. Uma nova descoberta resolve novamente o
  endereço. Não há cache de disponibilidade, preço, avaliação, loja ou produtos.
- Recuperação inicial usa uma página por consulta e por menu, sinalizando
  truncamento. Uso direto da porta sem esse contexto mantém paginação e regras
  anteriores; `onlyOpen`, cursores, IDs e escopos continuam validados.
- Duas consultas lógicas podem aguardar em paralelo, em fila distribuída entre
  desejos. Aproximadamente metade do orçamento de chamadas e do tempo fica
  reservada para revalidar lojas e consultar menus. A resolução de endereço
  também conta no orçamento lógico.
- Uma leitura simples recebe uma fatia proporcional ao tempo restante e número
  de termos. O menu recebe duas fatias porque executa duas ferramentas. Nenhuma
  fatia ultrapassa o deadline global. Esgotar uma fatia registra `time_limit`,
  mesmo quando ainda há tempo reservado para outros candidatos.
- Timeout cancela a leitura atual; erro real de transporte/validação continua
  sendo erro, sem simular lista vazia. Outra candidata pode usar a oportunidade
  restante. Lojas/produtos já comprovados são preservados.
- O sinal chega tanto ao SDK quanto ao fetch do transporte, isolado por chamada
  com `AsyncLocalStorage`. Sucesso não aborta sinais concluídos: o SDK enviaria
  `notifications/cancelled` desnecessárias. Timers e listeners locais são limpos.
  Cada ferramenta usa um sinal filho, desligado do orçamento lógico ao concluir;
  cancelar o próximo passo de um menu não cancela a ferramenta anterior.
- Retornos e callbacks de truncamento tardios não alteram o resultado concluído
  nem iniciam páginas adicionais depois do cancelamento.

Cancelamento HTTP não prova que o servidor remoto interrompeu todo o trabalho
interno. O limite de paralelismo é do cliente; não se promete um SLA remoto.
O benchmark conta ferramentas de catálogo, sem handshake/listagem de ferramentas
do bootstrap, e não é medição do servidor real.

## RED → GREEN e desempenho controlado

Transporte sintético com quatro termos para três participantes, duas lojas,
paginação disponível e latência de 1.800 ms por ferramenta:

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Tempo até o resultado | 46.800 ms | 19.800 ms |
| Chamadas MCP de catálogo | 26 | 15 |
| Leituras do endereço | 9 | 1 |
| Produtos validados | 0 | 3 |

O RED inicial teve seis falhas em sete casos. GREEN cobre consulta lenta,
preservação dos candidatos após limite adicional, catálogo vazio, três
associações corretas, incompatibilidade semântica rejeitada e metadados/filtros
preservados. Outro teste usa 4.000 ms por ferramenta e mantém os três produtos
dentro da janela original de 45 segundos.

A revisão reproduziu dois problemas adicionais antes da correção: fatia curta
para menu composto e cancelamento após sucesso. Ambos falharam em RED e passaram
em GREEN, incluindo Client/Server do SDK reais em transporte de memória. O teste
do fetch fornecido ao transporte também falhou antes de ligar o sinal individual
ao HTTP; depois confirmou cancelamento de uma leitura sem cancelar a concorrente.

Regressões adicionais verificam endereço divergente, novas operações sem cache
de loja/endereço anterior e propagação de falha real. Os 1.576 testes da base
permanecem: **1.589 testes em 83 arquivos**, lint, typecheck e build aprovados.
A revisão final executou 70 testes selecionados e não encontrou bloqueadores.

Compatibilidade semântica, limite de até duas lojas por proposta, preços,
avaliações, imagens, callbacks e bloqueios comerciais continuam cobertos pela
suíte completa. Não houve chamadas reais MCP/IA/Telegram, alteração de ambientes,
reinício do bot, push, merge ou cutover nesta tarefa.
