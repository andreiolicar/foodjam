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

Por enquanto, o projeto contém apenas a base para o desenvolvimento: pastas dos módulos, contratos compartilhados, configuração de ambiente e testes.

Ao executar, ele mostra `foodjam: bootstrap inicializado.` e encerra. As funcionalidades do MVP ainda serão desenvolvidas. Nenhum bot, modelo de IA ou conexão com o iFood é iniciado automaticamente.

## Tecnologias

- **Node.js e TypeScript** com verificação estrita de tipos e módulos ESM.
- **npm** para instalar dependências e executar os comandos.
- **tsx** para executar TypeScript durante o desenvolvimento.
- **ESLint e Vitest** para qualidade de código e testes.
- **dotenv** para carregar variáveis de ambiente.
- **grammY e SDK MCP** já instalados para as integrações futuras. Zod acompanha o SDK como dependência exigida.

## Como instalar e executar

Use **Node.js 24 LTS** ou **22.13.0+ na linha 22**, com npm. O repositório é privado: sua conta precisa ter acesso.

```bash
git clone https://github.com/andreiolicar/foodjam.git
cd foodjam
npm ci
npm run dev
```

Saída esperada:

```text
foodjam: bootstrap inicializado.
```

Para compilar e executar o JavaScript gerado:

```bash
npm run build
npm start
```

## Variáveis de ambiente

O projeto funciona sem credenciais nesta etapa. Para preparar sua configuração local, copie o exemplo:

```bash
cp .env.example .env
```

| Variável | Para que serve |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do bot, quando a integração Telegram for implementada. |
| `IFOOD_MCP_ENDPOINT` | Endpoint informado: `https://consumer-mcp.ifood.com.br/marketplace`. |
| `AI_PROVIDER` | Provedor de IA a ser escolhido. |
| `AI_MODEL` | Modelo de IA a ser escolhido. |
| `AI_API_KEY` | Chave do provedor, caso seja necessária. |

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
├── tests/                # Testes de inicialização
├── docs/architecture.md  # Arquitetura e limites dos módulos
├── .env.example          # Exemplo de configuração local
├── eslint.config.js      # Regras de qualidade de código
├── tsconfig.json         # Verificação de tipos de fontes e testes
├── tsconfig.build.json   # Compilação apenas das fontes para dist/
├── package.json          # Dependências e comandos
└── package-lock.json     # Versões exatas das dependências
```

O fluxo planejado é: **Telegram → Core / Agente IA → Integração MCP → iFood**.

O core controla as regras de negócio. Valores monetários usam **centavos inteiros**: `2590` representa R$ 25,90. O modelo de IA não deve fazer os cálculos financeiros nem autorizar a compra final.

Os contratos de `src/core/contracts.ts` são um ponto de partida e poderão mudar conforme a integração. Consulte [a arquitetura](docs/architecture.md) para conhecer os limites e as decisões do projeto.

## Comandos e testes

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Executa a inicialização com tsx. |
| `npm run build` | Compila TypeScript para a pasta `dist/`. |
| `npm start` | Executa a versão compilada. Requer o build antes. |
| `npm run lint` | Verifica as regras de qualidade do código. |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos. |
| `npm test` | Executa os testes uma vez. |
| `npm run check` | Executa lint, verificação de tipos e testes. |

Os testes atuais verificam a importação dos três módulos e a inicialização sem arquivo `.env` ou credenciais. Eles não acessam serviços externos nem simulam funcionalidades do MVP.

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
