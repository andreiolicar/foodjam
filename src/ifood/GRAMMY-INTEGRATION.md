# Handoff — Telegram grammY + IF-05 real

**Atualização IF-06:** endereço no grupo, descoberta multiloja e perfil de preços estão documentados em [IF-06.md](IF-06.md). As seções abaixo descrevem o gate e o ensaio da IF-05 anteriores a essa mudança; para testar a versão preparada, siga IF-06.md. A instância ao vivo não foi reiniciada pela IF-06.

## Base e preservação

Base: `origin/main` em `50a30ccc4b91959661ef1ecff07c55f67134d34c`.
Branch local: `codex/if05-grammy-integration`.
Worktree: `/Users/andrei/.codex/worktrees/if05-grammy-main/FoodJam`.

O worktree `codex/if05-real-integration`, seu índice e seus arquivos locais permanecem preservados. A migração usa cópias das fontes IF-05 e uma nova branch baseada na main, sem merge, rebase ou commits. Um backup privado contém os arquivos locais, os patches, o índice original e seus hashes. Relatórios e configurações privados não foram incorporados ao repositório.

Este documento descreve a composição atual. Documentos anteriores sobre `src/telegram-ts/` são o histórico da IF-05, não o comando da nova aplicação. O bot antigo permaneceu ativo durante a implementação; a nova entrada não foi iniciada em paralelo.

## Diferenças e escolha de integração

| Aspecto | Integração anterior | Nova composição |
| --- | --- | --- |
| Telegram | Telegraf em `src/telegram-ts/` | grammY da main em `src/telegram/` |
| Entrada | Bot da prova de conceito | `src/index.ts` → `criarAplicacaoReal` em `src/app.ts` |
| Interface | Coleta e apresentação da prova | Handlers, cards HTML, callbacks, privados e agrupador da main |
| Catálogo | Adaptador real IF-05 | Mesmo adaptador, uma conexão MCP, sem mutações habilitadas |
| Core | API de descoberta parcial | API compatível com os handlers, nomes, alternativa, ajustes e cancelamento |
| Comercial | Ainda pendente | Card explicitamente preliminar, sem botão de compra |

Não foi copiado o bot Telegraf nem adicionada sua dependência. A entrada principal não instancia `CatalogoFake`, `FakeLlm` ou heurística de reserva. Os fakes e a API cotada permanecem para os testes e simuladores existentes.

Arquivos centrais da adaptação: `src/app.ts`, `src/index.ts`, `src/core/discovery-agent.ts`, `discovery-flow.ts`, `llm-runtime.ts`, contratos aditivos em `agente.ts`, `contracts.ts`, `ports.ts`, `schemas.ts`, `sessao.ts`, e apresentação/handlers em `src/telegram/`. A implementação IF-01–IF-05 e seus testes foram transportados sem sobrescrever o worktree original. Os prompts e regras cotadas do Core não foram reescritos.

## Contratos e funcionalidades

- `DiscoveryCatalogPort`, `DiscoveryStore`, `DiscoveryItem` e `PreliminaryProposal` preservam a ausência de dados. Preços só viram centavos com unidade explicitamente comprovada/configurada; magnitude não define unidade.
- `Resposta` e `CoreSession` recebem campos opcionais de proposta preliminar; `SessionRecord` guarda os nomes e itens do catálogo consultado. Não são preenchidos os valores obrigatórios de uma proposta cotada com números fictícios.
- `confirmarEndereco` aceita opcionalmente o candidato apresentado. Na composição real, a mensagem privada, o organizador e esse candidato precisam corresponder. Um teclado antigo não confirma um endereço novo.
- O agrupador grammY, a coleta do Core e o provedor configurado são reutilizados. A classificação da IF-05 continua por pessoa, com os schemas e a validação do Core.
- O card usa nomes do MCP e dos participantes, mostra cobertura e substituições e não publica IDs internos nem endereço. Preço desconhecido, disponibilidade desconhecida, frete, taxas, descontos, total final e verificação do orçamento ficam explicitamente pendentes.
- Outra opção troca por uma alternativa já classificada na mesma amostra, sem nova chamada ao modelo. Ausência de alternativa é informada. Ajustes invalidam a proposta anterior e passam novamente pelo Core.
- Cancelamento e revisão são restritos ao organizador; callbacks de cards substituídos são rejeitados. Mensagens privadas e botões de orçamento da interface original permanecem, assim como os testes do fluxo cotado. No modo preliminar, nenhum clique registra aceite de valor desconhecido.
- `Revisar proposta preliminar` substitui `Confirmar pedido` na produção. Mesmo um callback antigo/forjado de confirmação não chama `fechar` ou executor. A fachada real também bloqueia `fechar`.

## Reconciliação da cascata com a main

A composição real reutiliza a fábrica `criarLlmDoAmbiente` e a `LlmEmCascata` da equipe. Ordem de produção: Groq (`AI_*`) → Gemini (`AI_2_*`) → OpenRouter (`AI_3_*`). Cada reserva configurada exige endpoint HTTPS, chave própria e modelos fast/capable; configuração parcial ou ordem incorreta impede a inicialização. Ausência de reservas permite somente Groq, sem promessa de resiliência entre provedores. Não há fallback fake. O modo `json_object` do Groq 120B e os modelos configurados são preservados.

Cada operação percorre provedores elegíveis uma única vez. Na cascata não há repetição HTTP nem troca interna de modelo após 429: prioriza-se outro provedor. Os modelos reserva continuam disponíveis no adaptador simples dos simuladores. HTTP 429, 5xx, autenticação, rede, timeout, JSON inválido e saída fora do schema Zod permitem fallback. O cooldown é por provedor: 60 s para 429/erro genérico, 30 s para indisponibilidade/rede/timeout, 1 h para autenticação/cota/plano. `Retry-After` numérico ou HTTP-date pode ampliar a espera. Sem evidência de espera, esses prazos são política local, não promessa do servidor. Saída inválida não impõe cooldown; cada provedor ainda recebe no máximo uma tentativa por operação.

Prazo padrão: 8 s por provedor, incluindo o último, configurável por `AI_TIMEOUT_POR_PROVEDOR_MS`; o limite total de 30 s por geração e o cancelamento do Core prevalecem. Negociação de formato pode consumir até três requisições por provedor dentro desse prazo. Todos falhando/em cooldown: erro controlado, sem repetir a cascata automaticamente, preservando sessão/preferências. Logs contêm somente fase, tier, modelo, fonte, status, contagens e motivos sanitizados. Nenhuma operação comercial foi liberada.

### Smoke test posterior — exige autorização separada

1. Configurar localmente as reservas com os modelos aprovados, sem enviar credenciais ao chat ou ao Git. Conferir presença e ordem; não mudar os modelos para obter cota silenciosamente.
2. Em processo sem polling, executar uma coleta fast e uma classificação capable por provedor (máximo seis gerações) usando o catálogo previamente validado, sem carrinhos. Respeitar qualquer `Retry-After`; parar por cota/autenticação. Isso verifica acesso e schemas reais, não comprova disponibilidade permanente.
3. Após autorização de troca controlada, iniciar somente uma instância no worktree de integração e conferir `catalog=ifood-mcp llm=groq cascade=groq,gemini,openrouter`. Repetir o ensaio de duas pessoas, endereço no grupo e revisão preliminar. A cascata simulada não substitui esse smoke real.

## Execução histórica no Mac

**Não executar enquanto o bot antigo usa o mesmo token.** Após revisão do responsável pelo Telegram e troca controlada autorizada do processo, usar:

```bash
cd /Users/andrei/.codex/worktrees/if05-grammy-main/FoodJam

AI_MODEL_FAST=openai/gpt-oss-20b \
node --env-file="$HOME/.local/share/foodjam-validation/telegram-demo.env" \
  --import tsx src/index.ts \
  --env /Users/andrei/FoodJam/.env
```

O override fast 20B é o temporário já aprovado para a demo; o `.env` e o modelo capable da equipe ficam intactos. Ele não comprova cota disponível. Não configurar outra reserva silenciosamente.

Os arquivos privados permanecem separados: Telegram via `--env-file`; MCP/Groq via `--env`. OAuth pode exigir navegador e usa tokens em memória. A conexão é mantida durante o processo, com encerramento controlado em SIGINT/SIGTERM. Ausência de MCP, Groq ou endereço comprovado não gera proposta fake. O gate global antigo foi substituído pelo cooldown independente descrito acima.

Diagnóstico esperado: `catalog=ifood-mcp llm=groq modo=preliminar interface=grammy`. Não são registrados tokens, endereços, prompts, payloads ou erros brutos.

### Roteiro curto

1. Todos usam `/start` no privado. O organizador usa `/iniciar` no grupo existente; IDs vêm de `ctx.chat.id` e `ctx.from.id`.
2. O organizador confere e confirma o endereço salvo na mensagem privada atual. `Outro endereço` percorre os registros salvos; não cadastra um endereço digitado.
3. Duas pessoas respondem diretamente a uma mensagem do bot com preferências e orçamento. Isso permite a recepção com Privacy Mode; observar a reação de recebimento e eventuais esclarecimentos privados. Recebimento não equivale a preferência reconhecida.
4. O organizador usa `/montar` (ou `/finalizar`). Conferir no card os dois participantes, os atendidos e os que ficaram sem item. Não presumir cobertura completa.
5. Testar revisão, outra opção quando disponível, ajuste por texto, voltar para a coleta e cancelamento. Nenhuma etapa cria carrinho ou compra.

## Registro histórico da migração inicial

As seções a seguir registram o primeiro checkpoint da migração. O ensaio coletivo posterior, endereço no grupo, busca por desejos e preços unitários comprovados estão em [IF-06.md](IF-06.md); não confundir esses registros com homologação comercial.

### Cobertura e limites iniciais

A nova composição foi verificada com a API grammY real e respostas MCP/Groq controladas, pela mesma fábrica usada na produção. O teste faz os IDs aleatórios do adaptador chegarem ao Core e os nomes ao card; os construtores fake são proibidos. Também verifica autorização, confirmação bloqueada, callbacks antigos, alternativas, ajustes e cancelamento. Isso **não equivale a um ensaio real desta nova interface no grupo**: não houve chamadas reais MCP/Groq/Telegram nem polling novo nesta migração.

Para a demo, a fachada consulta a primeira loja aberta encontrada, uma página e até seis ofertas. O card identifica a amostra incompleta. Não representa um cardápio completo nem otimização entre todas as lojas. Uma loja fechada não produz proposta. Disponibilidade desconhecida não vira `true`. Ausência de candidato nessa amostra não prova ausência de ofertas no iFood.

Persistência de sessão, roteamento privado, cards e confirmação do endereço é em memória. Não restaurar callbacks de outra execução como se fossem atuais. O organizador precisa confirmar novamente após reinício.

Continuam pendentes: validação/geocodificação de endereço digitado, comprovação geral das unidades monetárias do catálogo, associação comercial do endereço, composição de benefícios e reconciliação financeira no carrinho. `createAddress` não é validação silenciosa. A confirmação do endereço salvo nesta demo comprova o vínculo para busca, não a entrega comercial de um carrinho.

A etapa comercial exige desenho/autorização específica, carrinho por estabelecimento associado à sessão/proposta/usuário, idempotência persistente, consulta de valores atuais, política explícita de ajuste não atribuído e aceites dos afetados antes da revisão final. Os handlers privados de orçamento não substituem esses aceites vinculados ao carrinho. Nenhuma mutação, pagamento, checkout ou `submitOrder` está habilitada nesta composição.

## Gate para a demonstração

O menor próximo passo é revisar o patch com o responsável pelo Telegram, autorizar a troca do processo antigo e executar o roteiro acima. Dependências externas: token válido, OAuth local, loja aberta e cota/respostas válidas do Groq. A migração está preparada para teste integrado; a validação real da nova interface e o ciclo comercial continuam abertos. Não há commit, publicação ou alteração da main nesta entrega.

## Verificação desta migração

- Main antes da adaptação: 622 testes aprovados.
- `npm run check`: lint e typecheck aprovados; 1.267 testes em 65 arquivos aprovados.
- `npm run build`, `git diff --check` e `git diff --cached --check`: aprovados.
- Teste de importação atualizado para a entrada única grammY e sua fábrica: nenhuma autenticação, rede, listener ou polling durante importação.
- Preservação: 190 arquivos do worktree anterior com hashes idênticos, índice binário e HEAD idênticos ao backup. Bot anterior continua ativo; nenhum novo processo iniciado.
- Revisão dos 115 arquivos alterados/adicionados: nenhum segredo dos ambientes locais ou relatório/configuração privado incorporado. O novo índice permanece vazio; alterações não commitadas.
