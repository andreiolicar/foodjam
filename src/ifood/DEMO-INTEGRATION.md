# Demo real — dois participantes e um restaurante

Estado em 18/10/2026: proposta preliminar validada com IA real, usando produtos
do snapshot MCP real. Carrinho ainda não criado; o preflight atual informa loja
fechada. Não houve compra, checkout ou configuração de pagamento.

## Evidência da demo 14

- Dois participantes de demonstração com preferências estruturadas. Não houve
  teste de mensagens de dois usuários reais no Telegram.
- Seis produtos reais selecionados das duas páginas/20 produtos coletados no
  ensaio 12, de uma loja encontrada na busca real 11. Snapshot histórico explícito,
  com hashes dos arquivos fixados no plano; não é um catálogo de exemplo.
- Core e LlmPort do time, sem reescrever agente, prompts, modelos ou seleção.
  Uma única chamada ao Groq: HTTP 200, aproximadamente 2,6 segundos.
- Proposta aceita pelo Core: duas linhas, uma por pessoa, do mesmo produto real;
  preparação agregada será um produto × duas unidades em um único restaurante.
- Preços/frete/disponibilidade desconhecidos permanecem ausentes. Nenhum dos
  seis produtos tinha available explícito. Não há total final nem orçamento
  confirmado antes do carrinho. Pendências: commercial_validation/catalog_incomplete.
- Zero novas chamadas MCP na geração da proposta; IA real sobre os dados
  previamente consultados. Depois houve um preflight MCP real de cinco leituras.

Relatórios e artefatos privados, fora do Git, modo 600:

- demo-plan-14-private.json — fontes, hashes, preferências e período de espera.
- demo-report-14-private.json — resultado do Core e diagnóstico HTTP sanitizado.
- demo-proposal-14-private.json — artefato aceito pela CLI de preparação;
  não é autorização e não contém carrinho histórico.
- demo-proposal-14-review-private.md — revisão legível, sem endereço completo,
  coordenadas, tokens ou identificadores de conta.
- demo-preflight-15-private.json — consulta real de conta/endereço/loja/produto.
- demo-cart-plan-15-private.json — plano de um carrinho, ainda não autorizado.

## Groq: o que foi comprovado

O diagnóstico 13 anterior guardava apenas HTTP 429/kind rate_limit. Não guardou
Retry-After nem mensagem suficiente para distinguir RPM, TPM, RPD ou TPD. Portanto
não é possível classificar retroativamente esse limite com precisão.

A tentativa 14 ocorreu 644 segundos após o diagnóstico anterior. Sem prazo
oficial preservado naquele diagnóstico, esse intervalo é uma espera local
conservadora, não prova da janela exata imposta pelo provedor. Não houve repetição
de chamadas em sequência para provocar/diagnosticar outro 429.

Na resposta 200, havia 999 requisições diárias restantes (limite 1000) e 5770
tokens por minuto restantes (limite 8000). São os indicadores daquele momento,
não uma garantia de cota futura. A [documentação oficial do Groq](https://console.groq.com/docs/rate-limits)
define os cabeçalhos de requests como RPD, os de tokens como TPM, e Retry-After
em segundos. Não interpretar remaining-requests como requisições por minuto.

A demo registra somente status, enum do limite, contadores, duração e espera;
nunca mensagem bruta, organização, URLs, headers de autorização ou credenciais.
429/5xx encerra a tentativa sem retry, inclusive se o corpo falhar. Novo plano
deve apontar previousReport para o último relatório e respeitar nextAttemptAt;
se o provedor não informou espera, requer avaliação manual. Até três HTTP são
permitidos apenas para o fallback de formato já existente; uma classificação.
No ensaio realizado foi necessário somente um HTTP. Modelos do .env preservados.

## Gate exato do carrinho

Preflight 15: listTools, getUser, listAddresses, getMerchant e getItem. A conta,
o endereço salvo confirmado, a loja e o produto coincidiram com a proposta.
getMerchant informou isOpen false; nenhuma mutação foi executada.

getItem retornou três grupos com minSelections 0 e maxSelections 4/1/2, com
5/2/2 opções respectivamente. Isso comprova que zero adicionais é permitido por
essas restrições, não que o produto esteja disponível agora. O retorno não
continha disponibilidade explícita.

Correção mínima: o preparador agora admite grupos somente quando todos têm ID,
minSelections exatamente zero, maxSelections inteiro não negativo e opções com
IDs válidos/únicos. Envia options: [] explicitamente nesses itens. Não escolhe
adicionais nem calcula seus preços. Grupos obrigatórios ou ambíguos continuam
bloqueados. A leitura real anterior ao ajuste permanece preservada, sem reescrita.

Para executar o teste faltam:

1. Loja informada como aberta numa nova verificação de leitura feita pelo
   preparador; não fazer polling contínuo nem tratar o snapshot antigo como atual.
2. Autorização humana específica para este artefato, conta e endereço: um único
   carrinho, duas unidades, sem adicionais, sem pagamento/checkout/submissão.
3. A CLI revalida conta, endereço, loja e produto antes da reserva persistente.
   Se composição/destino mudar, revisar a proposta; não recriar com novo ID para
   contornar uma reserva ambígua. Journal atual continua vazio.

Comando preparado, **não executado**, condicionado à autorização específica e à
abertura da loja. A CLI exige confirmação presencial vinculada ao hash do artefato:

```bash
cd /Users/andrei/.codex/worktrees/if05-real-integration/FoodJam
npm run preparar:ifood -- \
  --proposal "$HOME/.local/share/foodjam-validation/demo-proposal-14-private.json" \
  --journal "$HOME/.local/share/foodjam-validation/cart-journal" \
  --report "$HOME/.local/share/foodjam-validation/demo-cart-report-15-private.json" \
  --env /Users/andrei/FoodJam/.env
```

Após getCart, preservar summary.totalAmount e reavaliar itens/entrega/taxas.
Benefícios ambíguos bloqueiam por padrão. A alternativa proporcional de ajuste
não atribuído conserva o total do iFood, não presume origem de descontos e exige
aceite de cada comprador na revisão correspondente. Confirmação de orçamento e
política não autoriza compra. Vínculo atual cartId → endereço ainda precisa ser
comprovado: retorno parcial sem addressId pode manter a revisão bloqueada.

## Caminho mínimo para o Telegram existente

Inspeção somente leitura de origin/feat/telegram-bot-ts, sem integrar commits:
o código ativo dessa branch está em src/telegram-ts (Telegraf). iris.ts ainda
compõe CatalogoFake; handlers/finalizar.ts chama iris.propor e cancela a sessão
após recomendar. services/apresentacao.ts ainda serializa a proposta completa.
Na main desta integração, src/telegram/index.ts continua um placeholder.

Alinhar uma pequena mudança de composição/controlador com o responsável:

1. Reutilizar collector, identidade do organizador e coleta existente do Core.
   Encaminhar CoreSession/preferências para o fluxo de descoberta público.
2. Escolher/confirmar endereço salvo no privado. Injetar
   createIfoodDiscoveryCatalog + criarLlmDoAmbiente; chamar proporDescoberta,
   sem passar a porta parcial como se fosse CatalogPort cotada completa.
   O caminho real não deve instanciar CatalogoFake.
3. Exibir PreliminaryProposal com pendências, mantendo a sessão ativa. Não
   cancelar após recomendar nem enviar JSON/endereço/dados privados ao grupo.
4. Callback autenticado “Preparar” do organizador → authority + journal +
   prepareCommercialProposal. Não aceitar actorId/consentimento vindo do LLM.
5. Exibir revisão por loja e colher aceites individuais de política/excesso
   vinculados à revision. Não ligar iris.finalizar/submitOrder como compra.

Atualização de 18/10: o patch de integração foi preparado localmente contra a
referência mais recente do bot e testado com transportes controlados. O roteiro,
arquivos para revisão e comando estão em [TELEGRAM-DEMO.md](TELEGRAM-DEMO.md).
O ensaio com duas pessoas reais no Telegram e o ciclo comercial permanecem
pendentes; os testes controlados não são evidência desse ensaio.

## Código e Git

Esta rodada acrescenta scripts/demo-ifood.ts e tests/integration/ifood-demo.test.ts;
altera package.json, export de inputSchema em integracao-ifood.ts, injeção
opcional de fetch em core/llm-ambiente.ts (sem mudar configuração de modelos),
ifood/commercial.ts e regressões de modelo/opções/importação. Handoff atualizado.

Checkpoint anterior preservado no índice da branch codex/if05-real-integration:
80 arquivos idênticos à auditoria inicial, com snapshots privados. O novo patch
Telegram descrito em TELEGRAM-DEMO.md permanece fora desse índice, para revisão
separada. Sem commit, push, merge ou alteração da main. Checkout feat/ifood-mcp
e src/index.ts preservados. Relatórios, .env e tokens permanecem fora do Git.
Verificações finais e contagem de testes constam no relatório de entrega.
