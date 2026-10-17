# Integração MCP do iFood — Desenvolvedor 1 / Andrei

Branch: `feat/ifood-mcp`.

Responsável pela autenticação/autorização junto ao serviço, descoberta de ferramentas disponíveis, execução de operações MCP, tratamento de erros/resultados e exposição das capacidades necessárias ao core.

Endpoint informado: `https://consumer-mcp.ifood.com.br/marketplace`.

## Fronteira

- Confirmar o mecanismo de autenticação antes de criar configuração de credenciais.
- Descobrir ferramentas e esquemas reais antes de definir nomes, parâmetros e interfaces de operações.
- Encapsular os detalhes do SDK e do transporte, sem expor esses detalhes ao Telegram.
- Não interpretar conversas, calcular rateios ou autorizar a compra em nome do core.
- Distinguir a autorização de acesso ao serviço da autorização explícita de compra, que pertence ao core.

O pacote `@modelcontextprotocol/sdk` e seu peer obrigatório Zod estão disponíveis. Foi verificada a compatibilidade de requisitos de Node e a instalação local; a compatibilidade com o protocolo, a autenticação e as ferramentas do endpoint ainda depende da integração. A [linha v1 do SDK](https://ts.sdk.modelcontextprotocol.io/) está em manutenção; avaliar a linha v2 se a descoberta do servidor exigir.

`index.ts` é um módulo vazio reservado à API pública futura. Importá-lo não abre conexões. Não existem chamadas MCP, clientes simulados, ferramentas oficiais presumidas ou fluxos de checkout nesta entrega. A inicialização futura deve ser explícita pelo ponto de composição em `src/index.ts`.
