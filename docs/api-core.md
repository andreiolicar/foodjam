# API do core (Íris) para o bot do Telegram

O bot **não faz requisição HTTP** ao agente: ele importa o core e chama funções no mesmo processo. Toda a regra de negócio (fases, preços, rateio, quem pode fechar) fica no core; o bot só traduz o Telegram para chamadas e apresenta o resultado.

## Montando o agente

```ts
import { CatalogoFake, criarAgente, criarLlmDoAmbiente } from './core/index.js';

const iris = criarAgente({
  catalog: new CatalogoFake(),           // trocar pela CatalogPort real do módulo iFood
  llm: criarLlmDoAmbiente(process.env),  // sem AI_PROVIDER: modelo fake, sem rede
  onError: (e) => console.error(e),
});
```

Para desenvolver o bot sem chave nem iFood, use exatamente isso: o catálogo fake tem 5 lojas e o modelo fake responde por palavras-chave. A ligação final fica em `src/index.ts`, combinada entre o time.

## Identificadores

| Core | Telegram |
|---|---|
| `sessionId` | `String(ctx.chat.id)` — uma sessão por grupo |
| `participantId` | `String(ctx.from.id)` |
| `displayName` | `ctx.from.first_name` (só usado quando a pessoa aparece pela primeira vez) |

## Chamadas

Todas devolvem `Promise<Resposta>` e **não lançam exceção** para casos esperados: o resultado vem em `outcome`.

| Evento no Telegram | Chamada |
|---|---|
| Alguém menciona o bot | `iris.iniciar(chatId, { id, displayName })` — quem mencionou vira organizador |
| Mensagem no grupo durante o pedido | `iris.mensagem({ sessionId, participantId, text }, displayName)` |
| Botão "Montar pedido" | `iris.propor(chatId, quemClicou)` |
| Botão "Confirmar pedido" | `iris.fechar(chatId, quemClicou)` |
| Botão "Voltar para a coleta" | `iris.reabrirColeta(chatId, quemClicou)` |
| Botão "Cancelar" | `iris.cancelar(chatId, quemClicou)` |
| Mostrar estado | `iris.obter(chatId)` |

Não precisa checar se quem clicou é o organizador: o core recusa com `outcome: 'not_authorized'` e já devolve a mensagem privada. Mensagens de pessoas diferentes no mesmo grupo podem chegar ao mesmo tempo: o core processa uma de cada vez por grupo.

`mensagem` decide sozinha o que fazer pela fase: na coleta registra preferências; com proposta na mesa interpreta pedidos de troca ("troca o meu por um café").

## `Resposta`

```ts
interface Resposta {
  outcome: string;            // ver tabela abaixo
  actions: CoreAction[];      // envie todas, na ordem
  session?: CoreSession;
  proposal?: Proposal;        // desenhar quando vier
  order?: AuthorizedOrder;    // pedido autorizado (fechamento)
  problems?: ProblemaProposta[];
  discarded?: Descarte[];     // diagnóstico; não precisa mostrar
  uncertain?: ItemIncerto[];  // itens a confirmar com quem tem restrição
}
```

### `actions`

- `send_message` **com** `participantId`: mensagem só para aquela pessoa (pergunta de esclarecimento, recusa, aviso). Bots só conseguem mandar DM para quem já iniciou conversa com eles; se falhar, responda no grupo em reply à mensagem da pessoa.
- `send_message` **sem** `participantId`: mensagem para o grupo.
- `session_updated`: a sessão mudou; use para atualizar o que estiver na tela, se quiser.

### `outcome`

| outcome | O que o bot faz |
|---|---|
| `started` / `already_active` | Avisar que o pedido começou / já está em andamento |
| `preference_updated` | Opcional: reagir à mensagem (ex.: 👍) |
| `question` | Já há mensagem privada de confirmação nas actions |
| `clarification` | Já há pergunta privada nas actions |
| `filtered` / `irrelevant` / `not_adjustment` | Nada |
| `proposed` / `adjusted` | Desenhar `proposal` com os botões Confirmar / Voltar / Cancelar |
| `rejected` | Troca recusada; a explicação está nas actions |
| `closed` | Mostrar o resumo de `order` e entregar ao executor do pedido |
| `already_closed` | Mostrar o mesmo resumo; **não** executar de novo |
| `close_rejected` | Algo mudou no catálogo; mostrar aviso e oferecer "Montar pedido" de novo |
| `no_candidates` / `no_valid_option` / `model_failed` | Não deu para propor; já há mensagem nas actions |
| `not_authorized` / `invalid_state` / `no_session` / `session_finished` | Mensagem privada já nas actions (quando há quem avisar) |
| `error` | Erro inesperado (já registrado em `onError`); mensagem genérica nas actions |

## Desenhando a proposta

- Dinheiro vem em **centavos inteiros**: `2590` → `R$ 25,90` (`(c / 100).toFixed(2).replace('.', ',')`). Nunca some valores no bot: use `subtotalCents`, `totalCents` e `split`.
- Por loja (`proposal.orders`): nome da loja (via catálogo), itens por pessoa, entrega, total.
- Rateio (`proposal.split.shares`): quanto cada pessoa paga (itens + parte da entrega).
- `item.isSubstitute`: marcar como "sugestão parecida".
- `proposal.uncoveredParticipantIds`: quem ficou sem item.
- `proposal.justification`: texto curto da Íris, pode ir no topo.
- **Nunca mostre `preferences.budgetCents` no grupo**: o orçamento é privado.

## Fechamento

`order` (`AuthorizedOrder`) é a fronteira com quem executa a compra no iFood: pedidos por loja, rateio e a autorização (quem, quando, qual proposta). O core não compra nada. Com `already_closed`, o `order` é o mesmo da primeira vez: use `order.proposalId` como chave para não executar duas vezes.
