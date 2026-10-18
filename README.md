# foodjam

**Íris**, agente de IA que organiza pedidos coletivos de comida em grupos do Telegram, com catálogo real do iFood via MCP.

🌐 **Site do projeto:** [foodjam.online](https://foodjam.online/)

Projeto do **Hackathon SEMCOMP × iFood 2026**, desafio **Vendendo com Agentes**.

## O problema e a solução

Pedir comida em grupo costuma virar uma conversa longa: cada um quer uma coisa, tem restrições, um limite de gasto, e alguém precisa juntar tudo, achar lojas que atendam e dividir a conta.

A Íris entra no grupo, entende em linguagem natural o que cada pessoa quer, busca opções no iFood e devolve uma proposta de pedido com no máximo duas lojas. Quem organizou decide pelos botões.

## Como funciona no grupo

1. **Início:** alguém menciona o bot ou usa `/iniciar` e vira o organizador.
2. **Endereço:** a Íris mostra um endereço salvo na conta iFood, e o organizador confirma no grupo ou percorre os outros. `/endereco` troca o endereço depois.
3. **Coleta:** cada pessoa responde à mensagem da Íris com o que quer ("dois pães de queijo e um café", "sou vegetariano", "até 30 reais"). Mensagens próximas são processadas em lote.
4. **Proposta:** o organizador usa `/montar`. A Íris mostra uma proposta preliminar com fotos e avaliações, quem recebe o quê e quem ficou sem item. Os botões permitem ver outra opção, voltar para a coleta ou cancelar. Novas mensagens ajustam a proposta.
5. **Carrinho (opcional):** com a preparação comercial habilitada, o organizador pode montar o carrinho no iFood para revisar valores reais. **Nenhuma compra ou pagamento é feito:** o fechamento fica bloqueado nesta versão.

Orçamentos são privados: perguntas sobre valor vão no privado, e cada pessoa precisa mandar `/start` ao bot uma vez.

## Princípios

- **A IA interpreta, o código decide.** O modelo extrai preferências e casa desejos com itens do cardápio. Preços, lojas, pedido mínimo, rateio e autorização ficam em código testado.
- **Dinheiro em centavos inteiros** (`2590` = R$ 25,90). O rateio fecha sempre no centavo.
- **Sem valor inventado.** Preço, frete ou taxa que o iFood não confirmou aparecem como "a confirmar".
- **Só o organizador** confirma endereço, monta, prepara carrinho e cancela.
- **Dados pessoais e segredos não vão para logs nem para o Git.**

## Arquitetura

```text
Telegram (grammY)  →  Core / Íris (regras + IA)  →  Integração MCP  →  iFood
```

| Módulo | O que faz | Responsável |
| --- | --- | --- |
| [`src/telegram`](src/telegram/README.md) | Mensagens, botões, cards da proposta e lotes de mensagens | Allan |
| [`src/core`](src/core/README.md) | Sessão, coleta, descoberta, proposta, rateio, orçamento e cascata de LLMs | Ana Paula |
| [`src/ifood`](src/ifood/README.md) | Cliente MCP com OAuth, catálogo, endereços e carrinho (com allowlists por operação) | Andrei |
| `src/app.ts` | Composição real: Telegram + core + Groq + MCP | — |

O core não conhece Telegram nem iFood: ele usa portas próprias (`ports.ts`) e contratos compartilhados (`contracts.ts`).

**IA:** qualquer API compatível com OpenAI. Em produção, Groq é o provedor principal, com Gemini e OpenRouter como reservas em cascata. Se um provedor falha (cota, timeout, erro), o próximo é usado.

## Como rodar

Requisitos: **Node.js 24 LTS** (ou 22.13+) e acesso ao repositório.

```bash
git clone https://github.com/andreiolicar/foodjam.git
cd foodjam
npm ci
cp .env.example .env   # preencha as variáveis abaixo
npm run dev            # ou: npm run dev -- --env caminho/do/.env
```

Sem `TELEGRAM_BOT_TOKEN`, o bot não sobe. Com tudo configurado, o log mostra `catalog=ifood-mcp llm=groq modo=preliminar`. Só um processo pode usar cada token; para testar em paralelo, crie seu próprio bot no @BotFather.

Para testar sem Telegram nem iFood, use `npm run simular`, que simula um grupo no terminal com catálogo fake.

### Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do bot (@BotFather). |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL*`, `AI_API_KEY` | Provedor principal de IA (Groq na produção). |
| `AI_2_*`, `AI_3_*` | Provedores reserva da cascata (Gemini, OpenRouter). |
| `IFOOD_MCP_ENDPOINT`, `IFOOD_MCP_CLIENT_ID`, `IFOOD_MCP_CLIENT_SECRET`, `IFOOD_MCP_CALLBACK_URL` | MCP do iFood. O OAuth é interativo na primeira execução. |
| `FOODJAM_CART_PREPARATION_ENABLED`, `FOODJAM_CART_JOURNAL_DIR` | Opcional: habilita "Preparar carrinho" e define onde fica o registro privado dos carrinhos. |
| `FOODJAM_DISCOVERY_*` | Opcional: limites da busca no catálogo (termos, lojas, itens, tempo). |

Detalhes em [`.env.example`](.env.example) e em [`src/ifood/README.md`](src/ifood/README.md). **Nunca faça commit do `.env`.**

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` / `npm run bot:dev` | Sobe o bot (o segundo recarrega ao editar). |
| `npm run simular` | Simula um grupo no terminal, sem Telegram. |
| `npm run avaliar:coleta` | Mede a qualidade da coleta com um provedor de IA. |
| `npm run listar:modelos` | Lista os ids de modelo de um provedor. |
| `npm run check` | Lint, tipos e testes. **Rode antes de abrir PR.** |
| `npm run build` / `npm start` | Compila para `dist/` e executa. |

Os testes (Vitest) cobrem as regras do core, o cliente MCP e os fluxos do bot com o grammY de verdade e a API do Telegram simulada. Nenhum teste acessa a rede.

## Estrutura

```text
src/
├── core/        # Íris: regras de negócio, prompts, LLM e contratos
├── telegram/    # Bot grammY
├── ifood/       # Integração MCP (e documentação de cada etapa IF-0x)
├── app.ts       # Composição real
└── index.ts     # Entrada
tests/           # core, ifood, telegram e integração
scripts/         # Simulador, avaliação da coleta e utilitários do iFood
docs/            # Arquitetura, API do core, decisões e relatórios
```

## Documentação

- [Arquitetura](docs/architecture.md): limites e responsabilidades dos módulos.
- [API do core](docs/api-core.md): fluxo, botões e outcomes usados pelo bot.
- [Decisões do core](docs/core-decisoes.md): escolha de modelos, lote e medições.
- [Integração iFood](docs/integracao-ifood.md) e [handoff grammY + MCP](src/ifood/GRAMMY-INTEGRATION.md).
- [Experiência coletiva (IF-06)](src/ifood/IF-06.md) e [revisão de carrinho no Telegram](docs/telegram-cart-review.md).
- [Teste de pedido colaborativo](docs/teste-pedido-colaborativo-iris.md) e [feedback MCP-02](docs/feedback-mcp/MCP-02-beneficios-e-total-do-carrinho.md).

## Contribuindo

Crie uma branch a partir da `main` atualizada, trabalhe principalmente no seu módulo e abra um pull request. Mudanças em `src/core/contracts.ts` são compartilhadas: combine com a equipe antes. Antes do PR, rode `npm run check` e `npm run build`.

Convenções: TypeScript estrito com ESM, imports locais com extensão `.js` e `import type` para tipos.

## Limitações conhecidas

- **Sem compra:** pagamento e envio do pedido estão bloqueados; a proposta é preliminar.
- **Endereço só da conta:** endereços novos precisam ser cadastrados no app do iFood.
- **Descontos sem detalhamento:** o MCP ainda não detalha os benefícios do carrinho (ver MCP-02), então o rateio final depende de validação.
