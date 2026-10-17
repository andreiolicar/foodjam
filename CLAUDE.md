# Regras do projeto foodjam

- TypeScript estrito, ESM. Imports locais com extensão `.js`; tipos com `import type`.
- Dinheiro sempre em centavos inteiros (MoneyCents). Validar inteiro seguro não negativo.
- O modelo de IA nunca calcula valores nem autoriza compra. Cálculos e autorização ficam em código.
- src/core não importa grammY, nem src/telegram, nem src/ifood, nem configura transporte MCP.
- Não presumir nomes de ferramentas do MCP do iFood; o core usa portas próprias no vocabulário do domínio.
- Alterações em src/core/contracts.ts devem ser mínimas e sinalizadas no resumo (são compartilhadas).
- Toda regra de negócio tem teste Vitest. Rodar `npm run check` antes de concluir uma tarefa.
- Nunca colocar chaves ou tokens no código.
