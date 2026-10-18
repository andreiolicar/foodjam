# 04 — Interface Visual: Telas e Protótipo da Experiência

**Projeto:** Íris (foodjam)  
**Hackathon:** SEMCOMP × iFood 2026 — *Desafio: Vendendo com Agentes*  
**Módulo:** Interface Conversacional, Componentes Visuais e Protótipo Interativo  

---

## 1. Diretrizes de Interface e Design System

A interface da Íris foi concebida para viver nativamente no **Telegram**, aproveitando componentes de alta usabilidade:
- **Mensagens Formatadas em Markdown:** Uso de hierarquia tipográfica, emojis funcionais de status (🏪, 🛵, 🧾, 🔒) e clareza nos valores numéricos.
- **Inline Keyboards:** Botões de ação rápida acoplados às mensagens, eliminando a digitação desnecessária de comandos.
- **Identidade Visual Híbrida:** A fluidez do Telegram combinada à paleta oficial de confiabilidade do iFood (*Vermelho #EA1D2C, Cinza Escuro e Branco*).
- **Protótipo Standalone Navegável:** Arquivo interativo [`04-prototipo-interativo.html`](04-prototipo-interativo.html) anexo para demonstração ao vivo para a banca de jurados.

---

## 2. Jornada Visual das Telas no Telegram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FLUXO DE TELAS DA ÍRIS                           │
│                                                                             │
│  [Tela 1: Endereço]  ──▶  [Tela 2: Coleta Coletiva] ──▶ [Tela 3: DM Orçamento]│
│  Validação via MCP        Chat livre no grupo          Resolução sigilosa   │
│                                                                │            │
│  [Tela 5: Checkout Autorizado] ◀── [Tela 4: Card de Proposta & Rateio] ◀─────┘
│  Pix individual e status iFood     Lojas, itens e divisão exata centavo     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Tela 1: Início de Sessão e Validação de Endereço (Organizador)

O organizador aciona a Íris no grupo. Como a disponibilidade de restaurantes e o frete dependem do local de entrega, o agente valida o endereço em tempo real via MCP antes de abrir a coleta.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ [Ana]: /iniciar                                                        │
│                                                                        │
│ 🤖 [Íris]:                                                             │
│ Olá, equipe! Sessão de pedido coletivo iniciada por @Ana.              │
│                                                                        │
│ 📍 Endereço de entrega detectado:                                      │
│ Av. Paulista, 1000 - Bela Vista, São Paulo - SP                       │
│                                                                        │
│ 🔘 [Confirmar este Endereço]   🔘 [Informar Outro Endereço]           │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Tela 2: Coleta de Preferências em Linguagem Natural

Os participantes conversam livremente. O agrupador em lote da Íris processa mensagens simultâneas sem engasgar e sem exigir comandos rígidos.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ [Andrei]: Pra mim pode ser um hambúrguer caprichado!                   │
│ [Caio]: Quero nuggets ou algo crocante de frango, até 35 reais.        │
│ [Bia]: Sou vegetariana, quero um burger sem carne até uns 30 reais.    │
│                                                                        │
│ 🤖 [Íris]:                                                             │
│ Anotado! 📝                                                            │
│ • Andrei: Hambúrguer                                                   │
│ • Caio: Frango / Nuggets (limite privado registrado)                   │
│ • Bia: Opção vegetariana (restrição rígida registrada)                 │
│                                                                        │
│ Quando estiverem prontos, @Ana pode tocar no botão abaixo:             │
│ 🔘 [Buscar Melhores Opções no iFood]                                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Tela 3: Notificação Privada de Orçamento (DM no Telegram com Bia)

O prato vegetariano disponível no restaurante mais votado somado ao frete e taxa resultou em R$ 38,50 (superando o limite de R$ 30,00 da Bia). **A Íris protege a Bia e resolve no privado:**

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 🔒 CONVERSA PRIVADA: Íris ↔ Bia                                        │
├────────────────────────────────────────────────────────────────────────┤
│ 🤖 [Íris]:                                                             │
│ Oi Bia! 👋                                                             │
│                                                                        │
│ O restaurante selecionado para o grupo tem o "Vegetariano Burger",     │
│ mas com o frete e a taxa de serviço de conveniência, a sua parte       │
│ ficará em R$ 38,50 (seu limite informado era de R$ 30,00).             │
│                                                                        │
│ Como você gostaria de proceder?                                        │
│                                                                        │
│ 🔘 [Aceitar R$ 38,50]                                                  │
│ 🔘 [Quero outro item mais em conta]                                    │
│ 🔘 [Ficar sem item neste pedido]                                       │
└────────────────────────────────────────────────────────────────────────┘
```
*(No grupo público, a Íris apenas envia: "⏳ Aguardando confirmação individual de valores de @Bia...")*

---

### Tela 4: Card Consolidado da Proposta e Rateio Transparente

Com as lojas filtradas, taxas cotadas no iFood e orçamentos aprovados, o card final é postado no grupo:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ 🤖 [Íris]:                                                             │
│ 🎉 Encontrei a melhor combinação para vocês!                          │
│                                                                        │
│ 🏪 Corta Pra Mim Hamburgueria Artesanal                                │
│ • Andrei: 1× Tradicional One (R$ 35,90)                                │
│ • Bia: 1× Vegetariano Burger (R$ 39,90)                                │
│ • Caio: 1× Nuggets Frango 12 un (R$ 32,90)                             │
│ 🛵 Entrega Padrão: R$ 0,00 (Frete Grátis)                              │
│ 🧾 Taxa de Serviço iFood: R$ 2,17                                      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                      │
│ 💰 Rateio Final por Pessoa (Itens + Frete + Taxa iFood):              │
│ • Andrei: R$ 35,90 + R$ 0,72 = R$ 36,62                                │
│ • Bia:    R$ 39,90 + R$ 0,73 = R$ 40,63                                │
│ • Caio:   R$ 32,90 + R$ 0,72 = R$ 33,62                                │
│ ────────────────────────────────────────────────                      │
│ 💵 Total Geral do Carrinho: R$ 110,87                                  │
│                                                                        │
│ @Ana, podemos autorizar o envio do pedido ao iFood?                    │
│                                                                        │
│ 🔘 [✅ Autorizar e Fechar Pedido]   🔘 [🔄 Ver Outra Opção de Loja]     │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Tela 5: Pedido Fechado e Prestação de Contas Instantânea

Após o organizador autorizar, o pedido é submetido via MCP e o bot publica a confirmação com o link de rastreio e dados de pagamento.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ 🤖 [Íris]:                                                             │
│ 🚀 PEDIDO CONFIRMADO NO IFOOD COM SUCESSO!                             │
│                                                                        │
│ Pedido #84920 · Previsão de entrega: 39 a 49 minutos                   │
│                                                                        │
│ 📲 Acompanhe em tempo real:                                            │
│ https://ifood.com.br/pedidos/track/84920                               │
│                                                                        │
│ 💳 Acerto de Contas com @Ana (Chave Pix: ana@firma.com.br):            │
│ • Andrei: R$ 36,62 (copiar Pix)                                        │
│ • Bia:    R$ 40,63 (copiar Pix)                                        │
│ • Caio:   R$ 33,62 (copiar Pix)                                        │
│                                                                        │
│ Bom apetite a todos! 🍔🍟                                              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Protótipo Interativo em HTML

Para experimentar o fluxo dinamicamente, abra o arquivo anexo no navegador:
👉 [`04-prototipo-interativo.html`](04-prototipo-interativo.html)

### Recursos do Protótipo:
- **Simulador Interativo Passo a Passo:** Permite avançar pelas 5 etapas com animações e trocas de tela em tempo real.
- **Alternador de Visão de Chat:** Alterne entre a visão do Grupo e a visão da Mensagem Privada da Bia.
- **Painel de Telemetria ao Vivo:** Visualize em tempo real o estado da Máquina de Estados, tokens gastos e chamadas MCP geradas.

