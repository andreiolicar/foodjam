# Íris

Agente de IA para organizar pedidos coletivos em grupos do Telegram, com integração ao MCP do iFood. Projeto do Hackathon SEMCOMP × iFood 2026, desafio **Vendendo com Agentes**.

## Estado atual e objetivo do MVP

Este repositório entrega apenas a fundação: configuração, contratos internos, fronteiras dos módulos e testes de inicialização. O comando de desenvolvimento imprime `Íris: bootstrap inicializado.` e encerra normalmente. Não abre conexões, inicia bots, executa modelos, acessa o MCP nem cria serviços simulados.

O MVP futuro deverá coletar preferências e restrições dos participantes, organizar uma sessão coletiva, consultar as operações disponíveis no iFood e apresentar uma proposta de pedido com rateio. O core deverá validar o orçamento, calcular valores deterministicamente e exigir autorização explícita para uma compra. Essas funcionalidades ainda não estão implementadas.

## Tecnologias

- Node.js LTS: **22.13.0+ na linha 22 ou 24.x**; recomendado Node 24 LTS. O intervalo exato aceito está em `package.json` e acompanha os requisitos de ESLint e Vitest.
- npm e lockfile versionado para instalações reproduzíveis.
- TypeScript 6.0, strict mode, ESM e resolução `NodeNext`.
- tsx para desenvolvimento; ESLint com flat config; Vitest para testes; dotenv para carregar `.env`.
- [grammY](https://grammy.dev/guide/getting-started) e [SDK TypeScript MCP v1](https://ts.sdk.modelcontextprotocol.io/) preparados para integração futura, sem inicialização automática. Zod é peer obrigatório desse SDK.

As versões diretas estão fixadas no `package.json`. TypeScript 6.0 foi escolhido dentro do intervalo aceito por `typescript-eslint` 8.71.2 (`>=4.8.4 <6.1.0`), conforme os metadados npm. A matriz de suporte também está na [documentação do typescript-eslint](https://typescript-eslint.io/users/dependency-versions/).

Não há framework web configurado, banco de dados ou Docker. O SDK MCP v1 inclui dependências transitivas para servidores; a Íris não as utiliza para subir uma aplicação web.

## Estrutura

```text
iris/
├── src/
│   ├── telegram/
│   │   ├── index.ts
│   │   └── README.md
│   ├── core/
│   │   ├── index.ts
│   │   ├── contracts.ts
│   │   └── README.md
│   ├── ifood/
│   │   ├── index.ts
│   │   └── README.md
│   └── index.ts
├── tests/
│   └── smoke.test.ts
├── docs/
│   └── architecture.md
├── .env.example
├── .gitignore
├── .editorconfig
├── eslint.config.js
├── tsconfig.json
├── tsconfig.build.json
├── package.json
├── package-lock.json
└── README.md
```

`iris/` representa a raiz do repositório; o nome da pasta local pode ser diferente. `tsconfig.json` verifica fontes e testes. `tsconfig.build.json` compila apenas `src/` para `dist/`, mantendo o ponto de entrada compilado em `dist/index.js`.

## Instalar e executar

```bash
git clone https://github.com/andreiolicar/iris.git
cd iris
npm ci
npm run dev
```

O repositório é privado: é necessário ter acesso concedido à sua conta. Na preparação inicial, `npm install` gera o lockfile; após clonar, prefira `npm ci` para respeitá-lo.

Para executar a versão compilada:

```bash
npm run build
npm start
```

Os comandos de execução funcionam sem `.env` ou credenciais. Não há servidor persistente nesta etapa; o processo termina após confirmar a inicialização.

## Ambiente

Opcionalmente, crie seu arquivo local:

```bash
cp .env.example .env
```

| Variável | Uso futuro |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do bot do Telegram. |
| `IFOOD_MCP_ENDPOINT` | Endpoint conhecido: `https://consumer-mcp.ifood.com.br/marketplace`. |
| `AI_PROVIDER` | Provedor de IA a definir pela equipe. |
| `AI_MODEL` | Modelo a definir pela equipe. |
| `AI_API_KEY` | Espaço reservado para a chave do provedor, se exigida. |

O bootstrap apenas carrega variáveis locais usando dotenv; não valida nem consome essas configurações de integração. O mecanismo de autenticação do iFood ainda não foi confirmado. Quando for conhecido, documentar e adicionar somente os nomes necessários de variáveis ao `.env.example`. Não presumir Bearer, OAuth ou API key.

Nunca versionar segredos. `.env`, variantes locais de ambiente, `.npmrc`, certificados, chaves e pastas de credenciais estão ignorados pelo Git. O `.env.example` contém apenas campos vazios e o endpoint público informado.

## Qualidade e testes

| Comando | Resultado esperado |
| --- | --- |
| `npm run dev` | Executa o bootstrap com tsx e encerra. |
| `npm run build` | Compila as fontes para `dist/`. |
| `npm start` | Executa `dist/index.js` após o build. |
| `npm run lint` | Valida fontes, testes e configuração ESLint, sem aceitar avisos. |
| `npm run typecheck` | Verifica tipos de fontes e testes sem emitir arquivos. |
| `npm test` | Executa os testes uma vez, sem modo watch. |
| `npm run check` | Executa lint, typecheck e testes em sequência. |

Os smoke tests verificam a importação dos três módulos e executam o ponto de entrada em um diretório temporário vazio, com ambiente vazio e limite de tempo. Não simulam pedidos ou funcionalidades do MVP. Nenhum teste depende de serviços externos.

## Trabalho dos desenvolvedores

| Responsável | Pasta principal | Branch |
| --- | --- | --- |
| Desenvolvedor 1 — Andrei | `src/ifood/` | `feat/ifood-mcp` |
| Desenvolvedor 2 | `src/telegram/` | `feat/telegram-bot` |
| Desenvolvedor 3 | `src/core/` | `feat/core-agent` |

Cada pessoa deve partir da `main` atualizada e criar sua branch local, por exemplo:

```bash
git switch main
git pull --ff-only
git switch -c feat/ifood-mcp
```

Substitua o nome da branch conforme a responsabilidade. Trabalhe prioritariamente na sua pasta. Comunique mudanças em `src/core/contracts.ts` aos outros dois desenvolvedores antes de integrá-las; são contratos iniciais e poderão evoluir conforme a integração.

Antes de abrir um pull request para `main`, execute `npm run check` e `npm run build`. Inclua no PR o comportamento alterado, os contratos afetados e como validar. Coordene mudanças em `package.json`, `package-lock.json` e `src/index.ts` para evitar conflitos; atualize o lockfile junto com as dependências. Não faça commits diretos em `main` após este bootstrap. As branches de trabalho acima são a convenção da equipe e serão criadas pelos responsáveis ao iniciar suas tarefas.

Imports locais em TypeScript devem usar a extensão `.js` para funcionar também no JavaScript compilado. Use `import type` para contratos. O core não deve importar grammY nem acessar o transporte MCP diretamente; consulte [a arquitetura](docs/architecture.md) e os READMEs de cada módulo antes de implementar.
