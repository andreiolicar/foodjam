# Arquitetura da Íris

## Escopo desta entrega

Bootstrap do projeto para três desenvolvedores trabalharem em paralelo. Há apenas pontos de entrada de módulos, tipos compartilhados, carregamento opcional de ambiente e uma confirmação de inicialização. Não há bot ativo, agente de IA, estado persistente, conexão MCP ou checkout, real ou simulado.

## Fluxo previsto

```text
Telegram → Core / Agente IA → Integração MCP → iFood
Telegram ← Core / Agente IA ← Integração MCP ← iFood
```

O fluxo representa a arquitetura futura, não conexões executadas pelo bootstrap.

1. **Telegram (`src/telegram/`)** traduz mensagens e interações da plataforma para os contratos internos e apresenta as ações produzidas pelo core.
2. **Core (`src/core/`)** controla as regras de negócio, sessões, participantes, preferências, orçamento e autorização. A integração com o modelo de IA e a orquestração de ferramentas ficam sob seu controle.
3. **Integração MCP (`src/ifood/`)** concentra autenticação, transporte, descoberta e execução das ferramentas realmente disponibilizadas pelo iFood, com tratamento de resultados e erros.
4. **iFood** é o sistema externo acessado pelo MCP; seus nomes de ferramentas, parâmetros, permissões e mecanismos de autenticação ainda precisam ser descobertos.

## Dependências e limites

- `src/index.ts` é o ponto único de composição. Hoje carrega dotenv e confirma a inicialização; não importa adaptadores para abrir conexões.
- Telegram poderá consumir a API pública do core e seus contratos. Não importa a integração iFood diretamente nem decide regras comerciais.
- O core deve permanecer independente de tipos do Telegram e de detalhes de transporte do SDK MCP. Quando houver ferramentas reais descobertas, a equipe definirá a menor interface interna necessária para conectá-las ao core pelo ponto de composição.
- O adaptador iFood não controla conversas, orçamento, rateio ou autorização de compra. Importar qualquer módulo não deve abrir conexões ou iniciar processos automaticamente.
- Ainda não existem interfaces de clientes, implementações simuladas ou camadas de persistência. Serão adicionadas somente quando a integração exigir.

## Contratos iniciais

`src/core/contracts.ts` contém identificadores de sessão e participante, preferências/restrições, participante, estado de sessão, mensagem de entrada e ações de saída para a interface conversacional. `src/core/index.ts` reexporta esses tipos.

São contratos internos provisórios. Identificadores são strings opacas para o core; a interface Telegram fará o mapeamento necessário. Nenhum nome de ferramenta oficial do iFood é presumido. Não há contrato de checkout ou compra autorizada nesta fase.

Todos os valores monetários são **centavos inteiros de BRL**. Por exemplo, R$ 25,90 corresponde a `2590`. O alias `MoneyCents` documenta essa unidade, mas é um `number` e não valida valores em runtime. Nas futuras fronteiras de entrada, o core deverá exigir inteiros seguros e não negativos, usando `Number.isSafeInteger`, e validar também os resultados. Não realizar cálculos financeiros em reais decimais com ponto flutuante.

## IA, finanças e autorização

O modelo poderá interpretar linguagem natural e sugerir ações. O core deve validar toda proposta antes de executá-la. O modelo de IA **não deve calcular o rateio financeiro nem autorizar a compra final**.

As futuras regras de rateio, arredondamento e distribuição de centavos deverão ser funções determinísticas, verificadas por testes. O fechamento dependerá de uma autorização explícita da pessoa responsável, validada pelo core para a sessão e o pedido em questão. Texto gerado pelo modelo ou conteúdo recebido de ferramentas não constitui autorização. Os mecanismos concretos ainda serão implementados no MVP.

## Integrações e configuração

O endpoint informado é `https://consumer-mcp.ifood.com.br/marketplace`. Nenhuma chamada foi necessária para construir o bootstrap. O mecanismo de autenticação e as capacidades aceitas pelo servidor devem ser confirmados antes da integração; não há variável de autenticação iFood inventada.

grammY e o SDK MCP estão instalados, mas não instanciados. O pacote solicitado `@modelcontextprotocol/sdk` é a linha v1 em manutenção; a [documentação oficial](https://ts.sdk.modelcontextprotocol.io/) descreve a existência da linha v2 em pacotes separados. A compatibilidade de protocolo com o endpoint do iFood ainda não foi validada. Andrei deverá confirmá-la e avaliar eventual migração quando houver evidências da integração. Zod está instalado por ser peer obrigatório do SDK v1.

Provedor, modelo e credenciais de IA continuam em aberto. Nenhum SDK de IA foi adicionado antes dessa escolha.

## Sequência recomendada após o bootstrap

1. Andrei confirma autenticação, protocolo e ferramentas MCP e compartilha suas descobertas com o core.
2. Desenvolvedor 2 define o fluxo conversacional e o mapeamento entre identificadores Telegram e contratos internos.
3. Desenvolvedor 3 refina os contratos com a equipe e implementa regras determinísticas antes da integração do modelo.
4. As APIs públicas são integradas por `src/index.ts`, em pull requests pequenos para `main` e com verificações locais passando.

Essa sequência não faz parte da implementação desta entrega.
