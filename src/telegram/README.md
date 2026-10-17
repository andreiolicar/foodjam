# Telegram — Desenvolvedor 2

Branch: `feat/telegram-bot`.

Responsável pela interface conversacional: grupos do Telegram, mensagens privadas, botões interativos, comandos de abertura/encerramento de sessão e atualização do painel coletivo. grammY já está disponível para a implementação futura.

## Fronteira

- Traduzir mensagens, participantes e cliques para os contratos públicos do core.
- Apresentar mensagens e mudanças de sessão retornadas pelo core.
- Manter tipos específicos de grammY dentro deste módulo.
- Encaminhar pedidos de abertura/encerramento ao core, que valida as transições.
- Não acessar o MCP diretamente, calcular rateio ou decidir autorização de compra.

`index.ts` é um módulo vazio reservado à futura API pública. Não inicializar bots, polling ou conexões durante imports. A composição e o início explícito dos serviços deverão ocorrer a partir de `src/index.ts` quando a equipe implementar o MVP.

Consuma os tipos de `../core/index.js` usando `import type`. Combine com o Desenvolvedor 3 qualquer alteração nos contratos antes de integrar o PR para `main`.
