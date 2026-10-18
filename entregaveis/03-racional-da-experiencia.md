# 03 — Racional da Experiência: Decisões de UX e Interação Humano-Agente (HAI)

**Projeto:** Íris (foodjam)  
**Hackathon:** SEMCOMP × iFood 2026 — *Desafio: Vendendo com Agentes*  
**Módulo:** Experiência do Usuário (UX), Psicologia Social e Design Conversacional  

---

## 1. O Desafio Psicológico do Pedido em Grupo

A interação em grupo não é apenas um problema de engenharia de software; é, antes de tudo, um **ambiente de vulnerabilidade social**:
- As pessoas têm vergonha de dizer que estão com pouco dinheiro.
- Participantes com restrições alimentares temem ser vistos como "os chatos que complicam o pedido".
- O organizador acumula o fardo mental e social de cobrar os colegas e arcar com centavos faltantes.

A Íris foi concebida sob a ótica de **Human-Agent Interaction (HAI)** para atuar não como um robô autoritário, mas como uma **mediadora social neutra, discreta e hiper-eficiente**.

---

## 2. As 5 Decisões Estratégicas de UX

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OS 5 PILARES DA EXPERIÊNCIA DA ÍRIS                      │
│                                                                             │
│  [1] Conversação Natural       ──▶  Zero formulários frios, acolhe gírias   │
│  [2] Privacidade Radical       ──▶  DMs sigilosas para limite de gastos     │
│  [3] Preço Real "All-In"       ──▶  Item + frete + serviço cotados antes    │
│  [4] Simplicidade Cognitiva    ──▶  No máx. 2 lojas + botão "Outra Opção"   │
│  [5] Autorização Sagrada       ──▶  O humano sempre tem a palavra final     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Decisão 1: O Fim dos Formulários Frios em Prol da Linguagem Orgânica

* **A dor:** Ninguém em um intervalo de almoço ou reunião de trabalho quer parar para preencher formulários com dezenas de campos, checkboxes e selects.
* **A decisão:** A Íris escuta a conversa natural do grupo. Aceita gírias regionais brasileiras (*"podrão"*, *"tô liso"*, *"sem verde"*, *"uma coquinha zero gelada"*) e interpreta múltiplos desejos em uma só mensagem (*"pra mim um x-salada e uma porção de batata"*).
* **Impacto em UX:** A barreira de entrada cai a zero. Qualquer pessoa no grupo participa com a mesma facilidade com que fala com um amigo.

---

### Decisão 2: Privacidade Radical de Orçamento (Zero Exposição Pública)

* **A dor:** Dizer no grupo aberto do trabalho *"meu limite é R$ 20"* gera constrangimento e exclusão social quando o restante do grupo sugere restaurantes caros.
* **A decisão:**
  1. O orçamento coletado em texto é **estritamente confidencial**: ele é mascarado antes de qualquer prompt e nunca é impresso no chat público.
  2. Se a proposta da loja fizer o total da pessoa ultrapassar seu limite, a Íris **chama o participante em mensagem privada (DM)**:
     ```text
     [Íris no Privado]: 
     "Oi Bia! A opção escolhida pelo grupo ficou em R$ 38,50 com frete e taxa 
     (acima do seu limite de R$ 30,00). O que prefere fazer?"
     [Aceitar valor de R$ 38,50]   [Quero outro item mais em conta]
     ```
  3. No grupo público, a Íris apenas sinaliza de forma neutra e respeitosa:
     *"Aguardando confirmação de valores de: @Bia"*.
* **Impacto em UX:** Segurança psicológica total. Ninguém precisa se justificar perante os colegas.

---

### Decisão 3: Custo Real "All-In" sem Taxas Surpresa

* **A dor:** É comum em aplicativos de delivery o usuário escolher um prato de R$ 30,00 e, no momento do checkout, ser surpreendido com R$ 12,00 de entrega e R$ 3,00 de taxa de serviço, gerando atrito e cancelamentos.
* **A decisão:** O conceito de orçamento na Íris é **All-In**:
  $$\text{Custo Individual} = \text{Itens} + \left(\frac{\text{Taxa de Entrega}}{\text{Pessoas na Loja}}\right) + \left(\frac{\text{Taxa de Serviço iFood}}{\text{Pessoas na Loja}}\right)$$
  A Íris aciona o endpoint oficial `quoteOrder` do MCP antes de apresentar a proposta. Quando o participante visualiza seu total, ele tem a certeza absoluta de que aquele é o valor líquido que sairá do seu bolso.
* **Impacto em UX:** Transparência radical e confiança imediata na autorização.

---

### Decisão 4: Redução de Fadiga Cognitiva (Máximo 2 Lojas e "Outra Opção")

* **A dor:** Se 6 pessoas pedirem em 5 restaurantes distintos, haverá 5 fretes separados, motoboys chegando em horários descompassados e comida esfriando. Por outro lado, forçar 1 única loja pode impedir que vegetarianos e carnívoros comam juntos.
* **A decisão:**
  - O algoritmo combinatório otimiza para **1 loja ideal** ou, no máximo, **2 lojas complementares** (ex.: uma hamburgueria artesanal e uma confeitaria/padaria).
  - Em vez de forçar o grupo a debater dezenas de alternativas, a Íris já calcula nos bastidores a 1ª colocada (`proposal`) e a 2ª colocada (`alternative`), disponibilizando um botão instantâneo de **`[Outra Opção]`**.
* **Impacto em UX:** Se a maioria não gostar da primeira opção, basta um clique para alternar para o plano B sem ter que recomeçar a coleta.

---

### Decisão 5: A Fronteira de Autorização Sagrada (Human-in-the-Loop)

* **A dor:** Usuários têm receio legítimo de agentes autônomos que manipulam dinheiro ou finalizam pedidos sem consentimento explícito.
* **A decisão:**
  - A Íris **nunca** executa a transação bancária ou finalização de pedido de forma autônoma.
  - A etapa de fechamento exige o clique explícito do organizador no botão `[Autorizar e Fechar Pedido]`.
  - A operação é **idempotente**: múltiplos cliques por instabilidade de rede ou ansiedade não geram pedidos duplicados.
  - Revalidação relâmpago: se nos últimos 60 segundos algum item esgotou no iFood ou o preço sofreu alteração, a compra é pausada e o organizador é informado imediatamente.
* **Impacto em UX:** Sensação de controle, segurança jurídica e alinhamento com as melhores práticas de governança de IA.

---

## 3. Matriz de Empatia: Antes vs. Depois da Íris

| Momento do Pedido | Experiência Tradicional (Sem Íris) | Com a Agente Íris |
|---|---|---|
| **Definição do Restaurante** | 20 minutos de mensagens desencontradas e indecisão. | 30 segundos: o agente cruza gostos e apresenta a melhor loja. |
| **Tratamento de Alergias** | Leitura manual de cardápio com risco de falha humana. | Filtro determinístico no catálogo com descarte imediato. |
| **Limite de Dinheiro** | Constrangimento público de quem tem orçamento restrito. | Resolução 100% privada e respeitosa via DM. |
| **Cálculo do Rateio** | Planilha no Excel, discussão de frete e centavos sobrando. | Divisão matemática perfeita ao centavo exibida no card do chat. |
| **Cobrança dos Amigos** | Organizador precisando lembrar quem deve o quê. | Cada membro recebe seu extrato transparente pronto para Pix. |

