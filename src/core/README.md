# Core / Agente IA — Desenvolvedor 3

Branch: `feat/core-agent`.

Responsável pelo agente de IA e pelas regras de negócio: integração com provedor/modelo, instruções, interpretação de linguagem natural, sessões, participantes, preferências, orquestração de ferramentas, validação de orçamentos, rateio determinístico e autorização de fechamento.

## Fronteira

- Receber dados da interface Telegram por contratos internos.
- Validar propostas do modelo e controlar transições de estado.
- Produzir ações para a interface conversacional.
- Controlar orçamento, rateio e autorização explícita de compra, sem delegá-los ao modelo.
- Não importar tipos grammY, configurar transporte MCP ou presumir ferramentas oficiais do iFood.

`index.ts` apenas reexporta os tipos de `contracts.ts`. Não há agente, gerenciamento de sessão ou execução de ferramentas nesta entrega. A interface para o adaptador iFood será definida em conjunto após a descoberta das ferramentas reais.

## Contratos compartilhados

- `SessionId` e `ParticipantId`: identificadores opacos representados por strings.
- `MoneyCents`: centavos inteiros de BRL; alias de `number`, sem validação em runtime.
- `ParticipantPreferences` e `Participant`: preferências, restrições e orçamento opcional por pessoa.
- `SessionStatus` e `SessionState`: estado inicial mínimo, sem máquina de estados implementada.
- `IncomingMessage`: texto de um participante dentro de uma sessão.
- `CoreAction`: mensagem para a interface ou notificação de atualização da sessão.

Os estados e ações são vocabulário interno provisório, não implementações de funcionalidades nem nomes de ferramentas MCP. Os contratos poderão evoluir com a integração. Combine alterações com os outros desenvolvedores e use `import type` para consumi-los.

Nas futuras entradas e operações financeiras, validar inteiros seguros não negativos. Exemplo de unidade: `2590` representa R$ 25,90. Regras de rateio e distribuição de centavos deverão ter testes próprios quando forem implementadas; o alias não garante integridade numérica.
