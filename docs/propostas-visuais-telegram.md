# Metadados visuais da proposta preliminar no Telegram

Escopo: foto principal dos produtos escolhidos e avaliação informativa de cada
estabelecimento. Não muda seleção, classificação, orçamento, elegibilidade,
cascata de IA, preferências ou permissões comerciais.

## Evidência MCP consultada offline em 18/10/2026

Arquivos privados existentes em `~/.local/share/foodjam-validation/`, não
versionados nem reproduzidos aqui:

- `media-ratings-report-20261018.json`, SHA-256
  `e9466689f2eb6ec0d7970b50cc1738cba8adc008cc5a33e5e072124df05a2bdc`.
- `product-images-recheck-1792313328059.json`, SHA-256
  `a76949db1f8f0e47eab8e544ce116ada5c6e23fc11e40be64dd28005ee430d65`.
  Há 39 campos `itemImageUrl`, todos no hostname
  `static.ifood-static.com.br`; notas são números JSON e contagens inteiras.

Campos aproveitados: `searchOffers`/`browseOffers` ITEM `results[].itemImageUrl`;
`getMerchant` e listagens MERCHANT `reviewRating`/`ratingCount`; fallback MERCHANT
extraído de ITEM em `merchant.reviewRating`/`merchant.ratingCount`.
Não há consulta adicional `getItem`, nem avaliação individual do produto.

## Validação e transporte

- Imagem opcional: HTTPS, host exato comprovado acima, sem credenciais, porta
  alternativa, espaços, controles ou barras invertidas. Outros hosts, incluindo
  IPs locais/privados, são recusados. A query assinada é preservada.
- Download apenas dessa origem, `redirect: error`, MIME JPEG/PNG/WebP, máximo
  5.000.000 bytes inclusive durante streaming. Não há download arbitrário,
  resolução de redirecionamentos nem log de URL/erro remoto.
- Nota: somente número JSON finito entre 0 e 5. Contagem: inteiro seguro não
  negativo. Valores malformados são omitidos individualmente.
- Deduplicação ignora apenas os três metadados visuais; mantém conflitos de
  identidade, escopo, nome, preço e funcionamento conforme os contratos prévios.
- `getMerchant` prevalece; não combina sua nota com contagem antiga da listagem.
  Na ausência de nota atual, a avaliação da listagem pode complementar a mesma
  loja com nome coerente. A foto da busca permanece quando o menu não a repete.
- Os metadados não entram no prompt de classificação nem nas buscas como filtro.

## Apresentação e estabilidade

A proposta preliminar começa com um único resumo textual: título, cobertura por
pessoa, observações da amostra, pessoas sem item e avisos de catálogo/comerciais.
Não inclui lista de produtos, preços, subtotal ou total. O resumo é o único dono
dos botões e da identidade pública usada nos callbacks.

Depois, cada par produto/loja efetivamente selecionado recebe uma mensagem
individual, em resposta ao resumo, com nome do produto, pessoas/quantidades,
estabelecimento, sua própria avaliação, preço unitário comprovado ou incerteza,
e disponibilidade. Um produto compartilhado por duas pessoas ocupa uma única
mensagem com ambas; registros idênticos não repetem a mesma pessoa. Produtos
distintos continuam separados mesmo quando usam a mesma URL de imagem.
Nenhum candidato rejeitado recebe mensagem. Não há limite artificial de duas
fotos: envia no máximo uma por produto selecionado, conforme este novo contrato.

A mensagem de item usa `sendPhoto` com legenda HTML completa de até 1.024 unidades
UTF-16, contando também marcação e entidades de forma conservadora. Sem imagem
válida, legenda longa, falha ou timeout de mídia, usa `sendMessage` para aquele
item, sem truncamento nem reinserção no resumo. Itens não têm botões. As mensagens
são sequenciais; falha de um item não bloqueia os próximos. O resumo já está
entregue e interativo antes do download. Download+envio de foto têm prazo conjunto
de 2 segundos; fallback textual individual também tem prazo de 2 segundos.
São preservados HTTPS, host comprovado, bloqueio de redirecionamento, MIME e teto
de 5 MB. URLs e erros remotos não são registrados.

Reapresentar/revisar a mesma identidade não reenvia itens. Atualizações editam o
resumo com `editMessageText`, a foto com `editMessageCaption` e itens textuais com
`editMessageText`. Se a legenda crescer demais ou a edição for recusada, substitui
somente a mensagem daquele item por texto completo. Atualizações da mesma revisão
são serializadas; metadados atualizados durante o envio são reaplicados ao item.

Troca de alternativa, substituição, cancelamento e volta à coleta invalidam a
identidade do resumo e limpam resumo e mensagens de item. Cada envio é protegido
por token de apresentação e revisão do Core, com conferências antes/depois dos
awaits e registro síncrono do ID. Respostas tardias são removidas; uma edição tardia
repete a limpeza para não restaurar callbacks antigos. Mensagens de item nunca
são reconhecidas como cards de callback. O Core mantém sua validação independente.

A limpeza remota é best effort e limitada por tempo. Se o Telegram aceitar uma
requisição mas não devolver seu ID, não é possível garantir remoção física; se
exclusão falhar, mensagens históricas podem ficar visíveis. Os itens respondem ao
resumo original e nunca recebem a identidade de uma proposta nova. Callback de
resumo antigo permanece inválido mesmo se a remoção física falhar.

Avaliação aparece por loja como `⭐ 4,7 (850 avaliações)`; sem contagem, `⭐ 4,7`.
Sem nota válida, omite a linha. Nomes são escapados em HTML. Nenhum valor financeiro
é somado e nenhum orçamento final ou operação comercial é autorizado.

## Verificação e integração posterior ao PR #9

Base isolada: `3371fd4e55e40996020b1497e9ab8cc10e812594`. A referência local
`codex/if05-if06-main-integration` estava em `6d8a780`, pai desse checkpoint.
A instância ativa permaneceu no worktree `fix-open-store-discovery`, PID 89076,
sem interrupção, reinício ou novo polling.

Baseline offline: 1.395 testes, lint e typecheck aprovados. RED comprovado ao
executar os novos casos contra os arquivos originais do checkpoint: 30 falhas
esperadas em 66 casos, incluindo avaliação ausente na composição real. GREEN:
66/66 com a implementação restaurada. Regressão adicional de leitura assíncrona
atrasada: 1 falha esperada, depois 19/19 testes de mídia aprovados.
Verificações adicionais RED → GREEN: quatro URLs de sintaxe ambígua/credenciais
vazias (4 falhas, depois 40/40 testes do adaptador); duas corridas de cancelamento
identificadas na revisão independente (2 falhas, depois 21/21 testes de mídia).
A revisão independente confirmou ambas as correções sem impedimentos remanescentes.

Resultado final: `npm run check` aprovado, com lint, typecheck e **1.464 testes**
em 79 arquivos (1.395 anteriores + 69 novos). `npm run build` aprovado.
`git diff --check` e verificação de padrões de segredos aprovados. Não houve
alteração de dependências, composição real, cascata ou handlers comerciais.
As fronteiras MCP, HTTP/IA, download de mídia e Telegram são controladas nos testes.
Nenhuma chamada real a esses serviços foi feita por esta tarefa.

Plano de incorporação (não executado):

1. Conferir o HEAD atual remoto do PR #9 e a presença do checkpoint `3371fd4`.
2. Em worktree de integração próprio, assegurar primeiro esse checkpoint aprovado;
   se ainda estiver em `6d8a780`, incorporar a correção de lojas abertas antes.
3. Aplicar apenas o commit desta branch com `git cherry-pick <SHA-local>`; revisar
   o diff contra o checkpoint e resolver conflitos preservando os mesmos limites.
4. Repetir `npm run check`, `npm run build` e a inspeção das permissões comerciais.
5. Solicitar autorização específica para publicação ou validação remota. Não fazer
   push, merge, deploy, reinício do bot ou testes reais como parte deste plano.

## Refinamento do card unificado (checkpoint 5315593)

Implementado somente em worktree isolado; o bot ativo PID 95050 permanece na
versão visual anterior, sem interrupção nem chamadas reais por esta tarefa.
Baseline: 1.464 testes. RED: nove falhas esperadas em vinte casos do novo contrato
antes da implementação. GREEN: 29/29 casos novos e 1.493 testes na suíte completa.
A revisão independente identificou uma corrida de edição tardia que reaplicava
botões após cancelamento/substituição e falha de exclusão. Quatro regressões
(photo/text × cancelar/substituir) falharam em RED e passaram com a nova limpeza
pós-edição. Outra regressão garante que duas edições da mesma revisão não apaguem
o card vigente. A revisão posterior confirmou a correção sem novos bloqueadores.
Os testes do contrato anterior foram adaptados para a foto como card único,
preservando os cenários de URLs, fallback, timeout e concorrência. A composição
`criarAplicacaoReal` continua exercitada com MCP, IA, mídia e Telegram controlados.

Este refinamento não modifica contratos de descoberta, seleção, preços, cascata,
credenciais, permissões comerciais ou handlers de callbacks. Não há nova consulta
MCP para obter foto. Integração posterior exige conferir a base e repetir as
validações; publicação e ativação continuam fora desta tarefa.

## Refinamento por item (base e290370)

Mudança isolada em `codex/proposal-item-cards`, a partir do último commit aprovado.
O patch de diagnóstico ativo permanece em sua própria worktree e não é misturado
à mudança visual. Sem consultas reais, reinício, publicação ou alteração da
seleção/cascata/permissões comerciais.

RED: 31 dos 32 cenários iniciais do novo formato falharam no contrato anterior.
GREEN: regressões de resumo+itens, fallback, associação, deduplicação, edições,
limite de legenda, callbacks, limpeza e respostas tardias. Uma regressão adicional
reproduziu metadados antigos numa foto em voo antes da correção. Os testes do
contrato anterior de card único com foto foram substituídos pelo novo contrato;
os cenários de segurança e concorrência foram preservados e ampliados.

Validação local do novo contrato: 48 testes de mensagens por item; suíte completa
com 1.512 testes em 80 arquivos, lint/typecheck e build aprovados. Baseline de
1.493 testes aprovado antes da mudança. Os 29 testes do card único anterior foram
substituídos pelos 48 testes do novo formato, preservando e ampliando seus casos
de fallback, timeout, edição e concorrência. Nenhuma fixture MCP foi alterada.

A revisão independente reproduziu dois gaps antes da consolidação: catchup de
edição sem prazo bloqueava o próximo produto; item sem ID após falha textual não
era tentado novamente. Sete regressões adicionais falharam em RED e passaram em
GREEN. Edições de item e resumo agora têm prazo de 2 segundos; item ausente só é
retentado quando sua chave não está em envio. Itens já entregues não são reenviados.
Edição tardia remove apenas o ID original, preservando o substituto textual.

O caso de edição tardia após fallback também recusado foi reproduzido em RED e
corrigido: o ID abandonado é invalidado antes de tentar o texto; uma nova tentativa
não reutiliza esse ID. A limpeza tardia preserva o item novo. Revisão final:
100/100 testes selecionados, incluindo os 48 casos novos, sem bloqueadores.
