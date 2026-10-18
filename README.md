# foodjam

Agente de IA para organizar pedidos coletivos em grupos do Telegram, com integração ao MCP do iFood.

Projeto do **Hackathon SEMCOMP × iFood 2026**, no desafio **Vendendo com Agentes**.

## O que queremos construir

O objetivo do MVP é ajudar um grupo a fazer um pedido em conjunto:

1. Reunir os participantes e suas preferências, restrições alimentares e orçamentos.
2. Consultar as opções disponíveis por meio do MCP do iFood.
3. Organizar uma proposta de pedido e calcular o valor de cada pessoa.
4. Solicitar autorização explícita da pessoa responsável antes de concluir uma compra.

## O que funciona hoje

- **Core (Íris):** coleta de preferências em linguagem natural (em lote), endereço de entrega, proposta com 1 ou 2 lojas e alternativa, rateio em centavos com entrega e taxa de serviço, orçamento resolvido no privado, ajustes por texto e fechamento idempotente com `AuthorizedOrder`. Veja [a API do core](docs/api-core.md).
- **Bot do Telegram (grammY):** início por menção ou `/iniciar`, endereço confirmado no grupo e confirmações individuais de orçamento no privado, card da proposta com botões, `/montar` e `/cancelar`.
- **Modelo de IA em produção:** Groq real obrigatório. Configuração ausente ou falha do provedor interrompe a operação; não há fallback silencioso para modelo fake.
- **Catálogo em produção:** adaptador MCP real da IF-05, com uma conexão autenticada compartilhada durante a execução. Preços e disponibilidade desconhecidos permanecem pendentes.
- **Demo integrada:** o bot mostra uma proposta preliminar, com revisão, outra opção, ajustes e cancelamento. Preparação comercial e aceites financeiros ficam pendentes; nenhuma compra ou criação automática de carrinho é executada. Veja [a experiência coletiva IF-06](src/ifood/IF-06.md) e [o handoff grammY + IF-05](src/ifood/GRAMMY-INTEGRATION.md).

Sem `TELEGRAM_BOT_TOKEN`, `npm run dev` mostra `foodjam: bootstrap inicializado.`, avisa que o bot não foi iniciado e encerra.

## Tecnologias

- **Node.js e TypeScript** com verificação estrita de tipos e módulos ESM.
- **npm** para instalar dependências e executar os comandos.
- **tsx** para executar TypeScript durante o desenvolvimento.
- **ESLint e Vitest** para qualidade de código e testes.
- **dotenv** para carregar variáveis de ambiente.
- **grammY** para o bot do Telegram.
- **Zod** para validar a saída do modelo e os contratos; **SDK MCP** para a integração com o iFood.

## Como instalar e executar

Use **Node.js 24 LTS** ou **22.13.0+ na linha 22**, com npm. O repositório é privado: sua conta precisa ter acesso.

```bash
git clone https://github.com/andreiolicar/foodjam.git
cd foodjam
npm ci
npm run dev
```

Com Telegram, MCP e Groq configurados e OAuth autorizado, a composição registra as fontes:

```text
foodjam: bootstrap inicializado.
FoodJam fontes: catalog=ifood-mcp llm=groq modo=preliminar interface=grammy
foodjam: interface grammY iniciada em modo preliminar.
```

Para desenvolver com recarga automática, use `npm run bot:dev`. Só um processo pode usar o mesmo token por vez (senão o Telegram responde 409); para testar em paralelo, cada pessoa cria o próprio bot no @BotFather.

No grupo: mencione o bot ou use `/iniciar`, cada pessoa escreve o que quer, e quem organizou usa `/montar` e decide pelos botões. Cada participante precisa mandar `/start` ao bot uma vez, para receber mensagens no privado.

Para compilar e executar o JavaScript gerado:

```bash
npm run build
npm start
```

## Variáveis de ambiente

Os testes usam respostas controladas. A entrada de produção exige Telegram, MCP e Groq reais. Os fakes continuam disponíveis para testes e simuladores explícitos. Para preparar sua configuração local, consulte o handoff e o exemplo:

```bash
cp .env.example .env
```

| Variável | Para que serve |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do bot (do @BotFather). Sem ele, o bot não sobe. |
| Endereço de entrega | Na demo real, selecionado de `listAddresses` e confirmado pelo organizador no grupo; não é inferido de `ENDERECO_PADRAO`. |
| `IFOOD_MCP_ENDPOINT` | Endpoint informado: `https://consumer-mcp.ifood.com.br/marketplace`. |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | Modelo de IA (API compatível com OpenAI). Os opcionais por nível e de reserva estão comentados no `.env.example`. |

O MCP exige `IFOOD_MCP_CLIENT_ID`, `IFOOD_MCP_CLIENT_SECRET` e `IFOOD_MCP_CALLBACK_URL`, além de OAuth interativo local. Consulte [a inicialização do iFood](src/ifood/README.md).

**Nunca envie tokens ou chaves para o Git.** O arquivo `.env` está ignorado; o `.env.example` deve conter apenas exemplos sem segredos.

## Organização do código

```text
foodjam/
├── src/
│   ├── telegram/         # Conversas, botões e mensagens do bot
│   ├── core/             # Agente de IA, regras e contracts.ts
│   ├── ifood/            # Integração com o MCP do iFood
│   └── index.ts          # Ponto de entrada da aplicação
├── tests/
│   ├── core/             # Regras de negócio do core
│   └── telegram/         # Bot de verdade (grammY + core) com a API do Telegram simulada
├── scripts/              # Simulador de conversa e avaliação da coleta
├── entregaveis/          # Entregáveis do hackathon
├── docs/
│   ├── api-core.md       # API do core para o bot (fluxo, botões, outcomes)
│   ├── core-decisoes.md  # Decisões e medições do core (modelos, tokens)
│   ├── architecture.md  # Arquitetura e limites dos módulos
│   ├── teste-pedido-colaborativo-iris.md
│   └── feedback-mcp/
│       └── MCP-02-beneficios-e-total-do-carrinho.md
├── .env.example          # Exemplo de configuração local
├── eslint.config.js      # Regras de qualidade de código
├── tsconfig.json         # Verificação de tipos de fontes e testes
├── tsconfig.build.json   # Compilação apenas das fontes para dist/
├── package.json          # Dependências e comandos
└── package-lock.json     # Versões exatas das dependências
```

O fluxo é: **Telegram → Core / Agente IA → Integração MCP → iFood**. A entrada única `src/index.ts` usa a composição real de `src/app.ts` e a porta de descoberta, que representa informações comerciais ainda não confirmadas. A porta cotada e seus testes permanecem preservados; o bot real não usa catálogos simulados.

O core controla as regras de negócio. Valores monetários usam **centavos inteiros**: `2590` representa R$ 25,90. O modelo de IA não deve fazer os cálculos financeiros nem autorizar a compra final.

Os contratos de `src/core/contracts.ts` são um ponto de partida e poderão mudar conforme a integração. Consulte [a arquitetura](docs/architecture.md) para conhecer os limites e as decisões do projeto.

## Documentação

- [API do core](docs/api-core.md): como o bot usa o core (fluxo, botões, outcomes, orçamento e fechamento).
- [Decisões do core](docs/core-decisoes.md): escolhas de modelo, lote e medições.
- [Arquitetura](docs/architecture.md): responsabilidades e limites dos módulos.
- [Teste de pedido colaborativo](docs/teste-pedido-colaborativo-iris.md): relatório do teste realizado com a Íris.
- [Feedback MCP-02](docs/feedback-mcp/MCP-02-beneficios-e-total-do-carrinho.md): observações sobre benefícios e alterações no total do carrinho.

Os relatórios foram mantidos com seus nomes e conteúdos originais.

## Comandos e testes

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe o bot com tsx (precisa de `TELEGRAM_BOT_TOKEN`). |
| `npm run bot:dev` | Igual ao `dev`, com recarga automática ao editar o código. |
| `npm run simular` | Simula um grupo no terminal, sem Telegram. |
| `npm run build` | Compila TypeScript para a pasta `dist/`. |
| `npm start` | Executa a versão compilada. Requer o build antes. |
| `npm run lint` | Verifica as regras de qualidade do código. |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos. |
| `npm test` | Executa os testes uma vez. |
| `npm run check` | Executa lint, verificação de tipos e testes. |

Os testes cobrem as regras de negócio do core e os fluxos do bot (com o grammY de verdade e a API do Telegram simulada), além da inicialização sem `.env`. Nenhum teste acessa serviços externos.

## Como a equipe deve trabalhar

| Responsável | Módulo | Branch |
| --- | --- | --- |
| Desenvolvedor 1 — Andrei | [iFood](src/ifood/README.md) | `feat/ifood-mcp` |
| Desenvolvedor 2 — Allan | [Telegram](src/telegram/README.md) | `feat/telegram-bot` |
| Desenvolvedor 3 — Ana Paula| [Core / Agente IA](src/core/README.md) | `feat/core-agent` |

Comece pela `main` atualizada e crie sua branch. Exemplo para a integração iFood:

```bash
git switch main
git pull --ff-only
git switch -c feat/ifood-mcp
```

Cada desenvolvedor trabalha principalmente na sua pasta. Combinem mudanças nos contratos compartilhados antes de implementá-las e coordenem alterações nas dependências e no ponto de entrada.

Antes de abrir um **pull request para `main`**, execute:

```bash
npm run check
npm run build
```

No PR, explique o que mudou e como testar. As alterações entram por pull requests; evite commits diretos na `main`.

Nos imports locais de TypeScript, use a extensão `.js`, para que o código também funcione após a compilação. Para importar apenas contratos, use `import type`.
