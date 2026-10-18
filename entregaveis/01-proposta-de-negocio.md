# 01 — Proposta de Negócio: Íris

**Projeto:** Íris (foodjam)  
**Hackathon:** SEMCOMP × iFood 2026 — *Desafio: Vendendo com Agentes*  
**Equipe:** Ana Paula, Andrei Olicar, Allan  

---

## 1. O Problema: O Caos Invisível dos Pedidos Coletivos

Fazer um pedido de comida em grupo — seja no almoço da firma, no trabalho em equipe da faculdade ou na noite de jogos com amigos — deveria ser um momento de confraternização. Na prática, transforma-se em um **pesadelo logístico e social**.

Pesquisas comportamentais e testes exploratórios com grupos revelam quatro dores críticas:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       O FUNIL DA FRUSTRAÇÃO EM GRUPO                        │
├─────────────────┬───────────────────────────────────────────────────────────┤
│ 1. Paralisia de │ 20 minutos discutindo "o que pedir". Um quer sushi, outro │
│    Escolha      │ quer hambúrguer, outro quer salada.                       │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ 2. Restrições   │ Alguém é celíaco, outro vegetariano, outro tem alergia a  │
│    Conflitantes │ amendoim. Verificar cardápios loja por loja é exaustivo.  │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ 3. Tabu e Vergonha│ "Eu só tenho R$ 25". Alguém sugere um prato de R$ 60 e a │
│    Financeira   │ pessoa fica constrangida em admitir o limite no grupo.    │
├─────────────────┼───────────────────────────────────────────────────────────┤
│ 4. O Organizador│ Uma pessoa sobrecarregada recolhe os pedidos, monta o     │
│    "Mártir"     │ carrinho, faz malabarismo no Excel, paga e cobra Pix.     │
└─────────────────┴───────────────────────────────────────────────────────────┘
```

Hoje, funcionalidades existentes de "pedido em grupo" em apps tradicionais falham porque:
1. **Exigem app instalado e login individual:** Quem não tem o app instalado ou não tem conta é excluído do processo.
2. **Não há inteligência de conciliação:** Se João quer hambúrguer e Maria quer poke, o app não resolve a escolha de lojas nem otimiza taxas de entrega ou pedidos mínimos.
3. **Não resolvem o constrangimento de orçamento:** O grupo não tem como expressar limites financeiros de forma confidencial.

---

## 2. A Solução: Conheça a Íris

A **Íris** é uma agente inteligente de compras coletivas integrada nativamente ao Telegram e alimentada pelo **Model Context Protocol (MCP) do iFood**.

A Íris entra no grupo como um participante prestativo, ouve as mensagens informais de cada um, consulta a disponibilidade real de restaurantes e cardápios no iFood, concilia restrições alimentares e limites de preço, e propõe uma **cesta otimizada de no máximo duas lojas parceiras**, acompanhada de um **rateio financeiro exato ao centavo**.

### Proposta de Valor para os Usuários

#### Para o Organizador do Pedido:
* **Fim do "trabalho de secretária":** A Íris coleta os desejos, calcula a divisão proporcional das taxas e monta a proposta pronta para autorização.
* **Controle absoluto:** A agente nunca passa o cartão nem fecha a compra sem autorização explícita do organizador.
* **Tranquilidade contábil:** Sem divergências de centavos ou disputas sobre quem paga o frete e a taxa de serviço.

#### Para os Participantes:
* **Inclusão sem atrito:** Não precisa baixar app, criar conta ou abrir links externos. Basta mandar uma mensagem no chat com suas próprias palavras ("quero um lanche vegetariano até 35 conto").
* **Privacidade financeira radical:** Se o prato ultrapassar o orçamento informado, a Íris conversa no privado. Ninguém é exposto publicamente no grupo.
* **Segurança alimentar:** Restrições rígidas (ex: vegetarianismo, alergias) são tratadas com prioridade absoluta por código determinístico, eliminando alucinações.

---

## 3. A Proposta de Valor para o Ecossistema iFood

Para o iFood, a Íris transforma conversas sociais cotidianas em **conversões de alto valor**:

| Alavanca de Negócio | Impacto Direto no iFood |
|---|---|
| **Aumento de GMV e Ticket Médio** | Reúne múltiplos consumidores em um único fluxo de pedido qualificado, gerando carrinhos maiores e com maior densidade de entrega por viagem. |
| **Destravamento de Carrinhos Abandonados** | Reduz a paralisia de escolha que frequentemente leva grupos a desistir de pedir comida ou optar por alternativas fora do app. |
| **Bate de Pedido Mínimo em Restaurantes Parceiros** | O motor combinatório da Íris seleciona lojas cujos pedidos somados atingem o valor mínimo de entrega, aumentando as vendas de estabelecimentos de médio porte. |
| **Canal Conversacional como Vanguarda de Aquisição** | Pessoas que não utilizam o app iFood com frequência participam do consumo por meio de grupos de trabalho ou estudo no Telegram. |
| **Validação Prática do MCP iFood no Mundo Real** | Consolida o iFood como a infraestrutura pioneira de comércio para agentes de inteligência artificial no Brasil. |

---

## 4. Métricas e KPIs de Sucesso

1. **Taxa de Conversão de Sessões Coletivas:** % de sessões iniciadas no grupo que resultam em pedido autorizado (`AuthorizedOrder`).
2. **Tempo Médio até a Decisão:** Redução do tempo de debate do grupo de ~25 minutos para menos de 3 minutos.
3. **Acurácia no Respeito a Restrições e Orçamentos:** 100% de conformidade garantida por guardrails em código determinístico.
4. **Índice de Conforto Financeiro:** Taxa de resolução de estouro de orçamento no privado sem abandono do participante.

