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

A proposta preliminar usa uma única mensagem `sendPhoto` com `InputFile`, legenda
HTML compacta e o mesmo teclado de revisão, alternativa, retorno e cancelamento.
A foto principal é a primeira URL válida de um produto efetivamente selecionado,
conferido pelo par produto/loja. Todos os produtos e participantes continuam no
texto. Não há fotos complementares separadas. A própria mensagem com foto recebe
a identidade do card e a revisão da proposta.

A legenda preserva lojas, avaliações, produtos, pessoas, quantidades, preço unitário
comprovado ou sua incerteza, disponibilidade, cobertura e avisos comerciais.
Nenhum nome ou aviso é truncado. O limite é conservador: até 1.024 unidades UTF-16
contando também a marcação HTML e entidades escapadas, garantindo caber após a
interpretação do Telegram. Se exceder, usa o card textual completo sem download.

A tentativa única de foto (download e envio juntos) tem prazo de 2 segundos e
aborto; mesmo se o transporte ignorar o sinal, o fluxo passa ao texto completo.
Foto ausente, inválida, redirecionada, grande, inacessível ou recusada pelo Telegram
resulta em `sendMessage` com o card completo e todos os botões. Nenhum segundo
produto é enviado como foto extra. Atualizar/reapresentar a mesma revisão não
reenvia a foto. Trocar para alternativa cria o card da nova revisão.

O estado registra se o card é foto ou texto. Atualizações usam `editMessageCaption`
ou `editMessageText`, respectivamente. Se uma legenda crescer além do limite ou
for recusada, substitui a foto pelo card textual completo e invalida a mensagem
anterior. Um erro benigno de mensagem não modificada não gera novo card.

Substituição, retorno à coleta ou cancelamento invalidam a identidade do card
anterior imediatamente. A limpeza de fotos/botões é best effort e tem prazo, sem
atrasar o novo card. Uma resposta tardia de mídia é removida quando seu ID fica
disponível; nunca é registrada como card, mesmo se o fallback já foi entregue.
Se o Telegram aceitar uma requisição mas não devolver o ID, não é possível garantir
a remoção física da mensagem; seus callbacks continuam sem identidade válida.
Uma falha de exclusão também pode deixar mensagem histórica visível, cujos botões
são recusados. A revisão e o token da apresentação são conferidos antes e depois
dos awaits e imediatamente antes de registrar a mensagem. A proteção existente do
Core recusa callbacks antigos, inclusive antes da atualização visual.

Avaliação aparece por loja como `⭐ 4,7 (850 avaliações)`; sem contagem, `⭐ 4,7`.
Sem nota válida, omite a linha. Zero só aparece quando explicitamente comprovado.
Nomes e produtos mantêm escape HTML também nas legendas. Avaliações são exclusivas
de cada estabelecimento, inclusive nas propostas com duas lojas.

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
