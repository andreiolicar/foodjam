# Gate do Groq para a demo Telegram

Estado em 18/10/2026. Nenhuma configuração privada foi alterada nesta investigação.

## Evidências

- O último relatório de produção guardava apenas HTTP 429. O roteiro chama
  `coleta_lote` (`fast`) antes de qualquer proposta; a configuração local anterior
  ao relatório indicava `qwen/qwen3.8-27b`. A identificação antiga é reconstruída
  pelo roteiro/configuração, não um campo preservado naquele relatório.
- O diagnóstico 13, mais antigo, falhou em `proposta_classificacao` (`capable`),
  sem informação suficiente para classificar o limite exato. Não confundir os
  dois incidentes.
- Uma nova tentativa controlada de coleta, sem MCP e com três mensagens de
  demonstração, confirmou diretamente: fase `coleta_lote`, tier `fast`, modelo
  `qwen/qwen3.8-27b`, HTTP 429, dimensão **tokens por minuto (TPM)**.
- Foram preservados teto/saldo de 8.000 tokens por minuto e teto/saldo de 1.000
  requisições por dia. Não veio espera utilizável. Nenhuma repetição ou reserva
  foi acionada após esse 429.
- O saldo cheio torna plausível uma requisição grande para esse teto; não é prova
  da contagem de tokens solicitada, que não foi preservada. Não atribuir a falha
  definitivamente a RPM, cota diária ou tamanho de prompt sem mais evidência.
- GET autenticado `/models`: HTTP 200, modelos Qwen 27B, GPT-OSS 120B e 20B
  listados. Isso comprova presença no catálogo da conta, **não saldo de geração**.

A documentação oficial do [Groq](https://console.groq.com/docs/rate-limits)
identifica os cabeçalhos de requests como RPD, os de tokens como TPM e Retry-After
em segundos. Os limites são organizacionais; não presumir reserva independente
nem disponibilidade com base no modelo estar listado.

## Configuração existente e política

| Papel | Configuração observada |
| --- | --- |
| fast | `qwen/qwen3.8-27b` |
| fast fallback | `openai/gpt-oss-20b` |
| capable | `openai/gpt-oss-120b` |
| capable fallback | ausente |
| AI_MODEL genérico | `openai/gpt-oss-20b` (sobrescrito pelos tiers acima) |

O Core já permite fallback configurado, inclusive após 429. Porém a proteção da
demo interrompe 429/5xx antes que `OpenAiCompatLlm` receba a resposta e crie
`LlmHttpError`. Assim ela bloqueia retry **e** troca automática de modelo. Isso é
uma política explícita da demo, não prova de falta de suporte no Core.

Adicionar apenas `AI_MODEL_CAPABLE_FALLBACK=openai/gpt-oss-20b` não resolve a
coleta fast atual e não atravessa esse gate. A opção exige aprovação da equipe e
uma decisão explícita sobre a política de reserva; não foi aplicada.

## Alteração técnica preparada

A mesma proteção agora está em `telegram-ts/llm-runtime.ts`, usada por `iris.ts`.
Ela preserva fase, tier, modelo, status, dimensão, contadores e prazo de espera
quando informado, mantendo bloqueio sem repetição. Nenhum prompt, corpo bruto,
cabeçalho arbitrário, chave ou identificador pessoal entra no diagnóstico.
O extrator sanitizado já usado no roteiro antigo foi compartilhado em
`core/llm-http-evidence.ts`, sem alterar regras do agente ou seus prompts.

## Alternativa aprovada e testada

Um teste de **uma única requisição** com `AI_MODEL_FAST=openai/gpt-oss-20b`
somente no processo, usando o modelo já configurado como reserva. O arquivo
`.env`, o capable 120B e as regras da equipe continuam intactos. A reserva não
será considerada disponível antes da resposta real e sua validação pelo Core.

Após aprovação explícita para teste e demo temporária, o roteiro privado
`groq-reserve-coleta-probe.mts` foi executado uma vez. Resultado: **um HTTP 200**,
três `preference_updated` validados pelo Core. As mensagens do teste são
sintéticas; isso não substitui a validação das três pessoas no grupo.
A seleção temporária fast 20B está autorizada para a demo, com capable 120B
preservado. Não foi habilitado fallback automático nem alterado o `.env`. Um
429 continua encerrando a tentativa, sem polling ou repetição sem espera comprovada.

## Demo e aceite

A entrada de produção continua carregando token Telegram do arquivo privado e
MCP/Groq do `.env` original. Não são necessários IDs manuais. A coleta distingue
mensagem recebida, preferência reconhecida, inclusão no Core e pessoa sem item.
Uma proposta aceita precisa de leitura MCP bem-sucedida, associação dos itens à
loja, classificação por IA real e apresentação legível no grupo. Uma resposta
200 isolada ou mensagens recebidas não provam esses passos.

A demo completa permanece pendente. O teste Qwen retornou 429, mas o teste
autorizado de coleta com fast 20B retornou 200. A tentativa de iniciar o bot
encontrou **HTTP 401 no Telegram getMe** com o token do arquivo privado, antes
do OAuth MCP/polling. O processo encerrou; não existe bot dessa tentativa rodando.
Foi solicitada correção local do token, sem envio de credenciais pelo chat.
Os exemplos de diagnóstico são sintéticos e não substituem as três preferências
reais dos integrantes. Nenhum carrinho, pagamento ou pedido será executado.

## Comandos preparados

Configuração atual, sem mudança de modelo (o último teste Qwen ainda deu 429):

```bash
cd /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam
node --env-file="$HOME/.local/share/foodjam-validation/telegram-demo.env" \
  --import tsx /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam/src/telegram-ts/bot.ts \
  --env /Users/andrei/FoodJam/.env
```

Após a correção do token Telegram, a demo temporária aprovada usa esta seleção
só no processo. A primeira inicialização foi tentada, mas bloqueada pelo 401:

```bash
cd /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam
AI_MODEL_FAST=openai/gpt-oss-20b \
node --env-file="$HOME/.local/share/foodjam-validation/telegram-demo.env" \
  --import tsx /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam/src/telegram-ts/bot.ts \
  --env /Users/andrei/FoodJam/.env
```

O capable continua 120B e não ganha fallback implicitamente. Os três integrantes
precisam enviar suas preferências no grupo e conferir os resultados de coleta,
classificação e cobertura; não anunciar sucesso a partir de exemplos sintéticos.

Verificações desta rodada: `npm run check` com **1.200 testes/57 arquivos**,
`npm run build`, `git diff --check` e `git diff --cached --check` aprovados.
Os 80 arquivos do checkpoint original continuam intactos no índice. Sem commit,
push, merge, carrinho ou compra. Handlers e regras de negócio não foram alterados.

Na retomada após aprovação: 16 testes de Telegram passaram novamente, sem
chamadas remotas nos testes. O token tem formato esperado e Node/dotenv leem o
mesmo valor, sem espaços nas bordas; a rejeição 401 veio da API do Telegram.
Nenhuma mensagem foi enviada ao grupo durante a inicialização rejeitada.

## Token corrigido e processo existente

Após a atualização local do token, `getMe` e `getWebhookInfo` retornaram HTTP
200. Privacy Mode está desativado na configuração global e não há webhook.
Foi encontrada uma instância de `src/telegram-ts/bot.ts` no worktree de
integração, com os dois arquivos privados corretos, sem confirmação do override
fast 20B. Não foi aberto outro polling nem interrompida essa instância.
Antes de reiniciar com a seleção aprovada, foi solicitado confirmar se existe
coleta/proposta ativa, pois esse estado está em memória.


## Ensaio do grupo em 18/10: coleta válida, classificação rejeitada

Duas mensagens recebidas, duas preferências reconhecidas e duas pessoas incluídas.
A coleta com fast 20B respondeu HTTP 200. O capable 120B respondeu HTTP 200
nas tentativas de classificação, mas retornou `pessoas` com sete entradas:
um objeto, cinco strings e um array. O Core rejeitou a estrutura. **Não foi
HTTP 429 nessa rodada**. Os diagnósticos iniciais não guardavam a rejeição Zod.

A reprodução de leitura com as duas preferências (identificadores anônimos)
repetiu o problema. Apenas fixar a quantidade de pessoas no JSON Schema não
resolveu. `strict: true` foi rejeitado pelo provedor com `json_validate_failed`.
A documentação distingue o formato best-effort de aderência obrigatória:
[Groq Structured Outputs](https://console.groq.com/docs/structured-outputs).

Correção de compatibilidade: o runtime Telegram inicia **somente o modelo
`openai/gpt-oss-120b`, quando o host é `api.groq.com`**, no modo `json_object`
já implementado pelo Core. O schema segue nas instruções de formato existentes
e o Zod continua obrigatório, incluindo pertencimento de pessoa e quantidade de
desejos. Modelos, configuração privada, prompts de negócio e regras não mudaram.
Os outros modelos/provedores continuam com seu modo anterior. 429 mantém o gate
sem retry/fallback automático.

Uma execução com o runtime corrigido e o snapshot real recém-consultado produziu
proposta no Core: duas pessoas consideradas e uma com item; IDs pertencentes ao
catálogo capturado. Houve duas respostas HTTP 200: a primeira inválida foi
rejeitada e a segunda validada pela correção já prevista no Core. Isso prova a
classificação e composição com IA real; **não prova entrega dessa proposta ao
grupo**. A consulta usou um restaurante e seis ofertas, sem cobertura completa.
Preço, disponibilidade e total comercial continuam pendentes.

O processo anterior também encerrou após o ensaio; a causa exata do polling não
foi preservada. As sessões eram somente em memória. Agora o encerramento registra
uma categoria fechada (conflito, autenticação, rede etc.), sem erro bruto. Não
foi adicionada reconexão automática nem repetição de consultas.

Diagnósticos novos registram fase, tentativa, resultado, categoria e códigos/
caminhos sanitizados de validação, sem IDs, prompts ou respostas privadas.
Teste da composição de produção reproduz a lista heterogênea e exige rejeição,
correção validada e apresentação sem IDs internos. O ensaio de grupo precisa ser
repetido após reiniciar, com nova confirmação do endereço e duas preferências.


## Reteste do grupo às 02:01 e correção da classificação em lote

O reteste comprovou que mudar apenas para `json_object` não era suficiente:
as duas preferências foram reconhecidas, todas as consultas MCP tiveram êxito,
mas ambas as tentativas de classificação novamente falharam no schema, com HTTP
200. A reprodução anterior com IDs anônimos não bastava para homologar o grupo.

A classificação preliminar em `discovery-flow.ts` agora usa uma pessoa por
chamada, sequencialmente, com o mesmo prompt, modelo, schema dinâmico e mecanismo
de correção do Core. Apenas as saídas validadas são reunidas para a seleção.
Uma falha individual interrompe a proposta inteira; não significa pessoa sem
item. Pessoa sem item só resulta de classificação válida sem candidato compatível.
A coleta coletiva em lote e as regras de seleção/orçamento não foram reescritas.
Custo: uma chamada por pessoa em vez de uma chamada coletiva (até duas tentativas
por pessoa, conforme o Core); 429/5xx continuam bloqueando novas chamadas.

Foi capturado um checkpoint privado da sessão efetiva do bot, sem incluir tokens
nem credenciais. A validação usou a sessão real do grupo, os dois participantes
originais e a conexão MCP/IA já autenticada: novas consultas de leitura ao catálogo,
um restaurante, seis ofertas e **duas classificações válidas na primeira tentativa**.
O Core produziu uma proposta com IDs pertencentes ao catálogo retornado. Cobertura
**1 de 2**, com preço e disponibilidade desconhecidos. Essa validação não enviou
mensagem ao grupo e não autoriza afirmar entrega no Telegram.

A composição `iniciarIris` aceita o `SessionStore` existente do Core como dependência
opcional, permitindo preservar a sessão durante o reinício local. Nenhum arquivo de
sessão ou informação pessoal entra no Git. O preload privado de recuperação exige
que o endereço anteriormente confirmado ainda corresponda ao registro salvo; só
então restaura o organizador/coleta. O grupo volta a ser vinculado pelo `ctx.chat.id`
no `/iniciar`, sem informar IDs manualmente. A recuperação não concede consentimento
comercial nem restaura carrinho, pagamento ou autorização de compra.

A demo de snapshots limita uma classificação por participante, bloqueando repetição
por pessoa e IDs alheios ao plano, em vez do antigo limite de uma classificação para
todo o grupo. Testes existentes foram mantidos e suas respostas controladas agora
respeitam a granularidade da requisição individual.
