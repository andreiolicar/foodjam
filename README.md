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
- **Bot do Telegram (grammY):** início por menção ou `/iniciar`, endereço e valores no privado, card da proposta com botões, `/montar` e `/cancelar`.
- **Modelo de IA:** qualquer API compatível com OpenAI, configurada no `.env`; sem chave, usa um modelo fake (heurístico, sem rede).
- **Catálogo:** nesta versão o core usa o catálogo fake (`CatalogoFake`, 5 lojas fictícias). O cliente MCP do iFood está em `feat/ifood-mcp`; ligar o catálogo do core a ele é o próximo passo.
- **Compra:** o core entrega o pedido autorizado e não compra nada; o executor do pedido no iFood ainda não existe.

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

Com `TELEGRAM_BOT_TOKEN` no `.env`, a saída esperada é:

```text
foodjam: bootstrap inicializado.
foodjam: bot @seu_bot iniciado.
```

Para desenvolver com recarga automática, use `npm run bot:dev`. Só um processo pode usar o mesmo token por vez (senão o Telegram responde 409); para testar em paralelo, cada pessoa cria o próprio bot no @BotFather.

No grupo: mencione o bot ou use `/iniciar`, cada pessoa escreve o que quer, e quem organizou usa `/montar` e decide pelos botões. Cada participante precisa mandar `/start` ao bot uma vez, para receber mensagens no privado.

Para compilar e executar o JavaScript gerado:

```bash
npm run build
npm start
```

## Variáveis de ambiente

Todas as variáveis são opcionais: sem elas, os testes e o simulador rodam com modelo e catálogo fakes. Para preparar sua configuração local, copie o exemplo:

```bash
cp .env.example .env
```

| Variável | Para que serve |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do bot (do @BotFather). Sem ele, o bot não sobe. |
| `ENDERECO_PADRAO` | Opcional: endereço oferecido ao organizador no início ([Sim] [Outro endereço]). Sem ele, o bot pede o endereço no privado. |
| `IFOOD_MCP_ENDPOINT` | Endpoint informado: `https://consumer-mcp.ifood.com.br/marketplace`. |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | Modelo de IA (API compatível com OpenAI). Os opcionais por nível e de reserva estão comentados no `.env.example`. |

A autenticação do iFood ainda precisa ser confirmada. As variáveis de credenciais dessa integração serão definidas depois dessa confirmação.

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

O fluxo é: **Telegram → Core / Agente IA → Integração MCP → iFood**. Hoje o trecho até o core funciona de ponta a ponta; o core fala com o catálogo por uma porta própria (`CatalogPort`), atendida pelo catálogo fake até a ligação com o MCP.

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
