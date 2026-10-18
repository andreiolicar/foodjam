# 04 — Interface Visual: Telas e Protótipo da Experiência

**Projeto:** Íris (foodjam)  
**Hackathon:** SEMCOMP × iFood 2026 — *Desafio: Vendendo com Agentes*  
**Módulo:** Interface Conversacional, Componentes Visuais e Protótipo Interativo  

---

## 1. Diretrizes de Interface e Design System

A interface da Íris foi concebida para viver nativamente no **Telegram**, aproveitando componentes de alta usabilidade:
- **Mensagens formatadas:** hierarquia tipográfica, emojis funcionais de status (🏪, 💰, ⏳, ✅, 📍) e clareza nos valores, sempre calculados pelo código em centavos.
- **Inline Keyboards:** botões de ação rápida acoplados às mensagens. Os únicos comandos digitados são `/iniciar` (ou mencionar a Íris), `/montar` e `/cancelar`.
- **Grupo para o coletivo, privado para o individual:** endereço e valores de cada pessoa vão no privado; no grupo aparecem só a proposta, o rateio e os nomes de quem falta responder.
- **Identidade Visual Híbrida:** a fluidez do Telegram combinada à paleta oficial de confiabilidade do iFood (*Vermelho #EA1D2C, Cinza Escuro e Branco*).
- **Protótipo Standalone Navegável:** arquivo interativo [`04-prototipo-interativo.html`](04-prototipo-interativo.html) anexo para demonstração ao vivo para a banca de jurados.

---

## 2. Jornada Visual das Telas no Telegram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FLUXO DE TELAS DA ÍRIS                           │
│                                                                             │
│  [Tela 1: Início e Endereço] ──▶ [Tela 2: Coleta] ──▶ [Tela 3: Proposta]    │
│  Grupo + privado do organizador   Chat livre no grupo   Card com rateio      │
│                                                                │            │
│  [Tela 5: Pedido Confirmado] ◀── [Tela 4: Valor no Privado] ◀───┘            │
│  Resumo e pedido autorizado       Resolução sigilosa por pessoa              │
└─────────────────────────────────────────────────────────────────────────────┘
```

O exemplo usa números coerentes com as regras do core: o item da Bia (R$ 27,90) cabe no limite dela (R$ 30,00); com a parte da entrega e da taxa de serviço, o total dela passa (R$ 31,40), e a Íris pergunta no privado.

---

### Tela 1: Início de Sessão e Endereço (Grupo + Privado da Ana)

A Ana menciona a Íris no grupo e vira a organizadora. A coleta começa na hora; o endereço é combinado em paralelo, **no privado dela**, e validado pela porta do catálogo do iFood.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ [Ana]: @iris_bot bora pedir o almoço?                                  │
│                                                                        │
│ 🤖 [Íris]:                                                             │
│ Pedido iniciado por Ana! Mandem aqui o que querem comer, restrições    │
│ e limite de valor.                                                     │
│ Ana, te chamei no privado para combinar o endereço de entrega. Quando  │
│ todos tiverem falado, use /montar.                                     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 🔒 PRIVADO: Íris ↔ Ana                                                 │
├────────────────────────────────────────────────────────────────────────┤
│ 🤖 Qual o endereço de entrega? Digite rua, número, bairro e cidade.    │
│ [Ana]: Av. Paulista, 1000 - Bela Vista, São Paulo - SP                 │
│ 🤖 Encontrei este endereço: Av. Paulista, 1000 - Bela Vista, São Paulo │
│    - SP. Está certo?                                                   │
│ 🔘 [Confirmar]   🔘 [Corrigir]                                          │
└────────────────────────────────────────────────────────────────────────┘
```

*(Com um endereço padrão configurado, a pergunta é "Entregar em …?" com [Sim] [Outro endereço].)*

---

### Tela 2: Coleta de Preferências em Linguagem Natural

Os participantes conversam livremente. O agrupador junta as mensagens quase simultâneas num lote só (uma chamada ao modelo), e a Íris reage com 👍 a quem teve a preferência registrada, sem poluir o grupo.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ [Andrei]: Pra mim pode ser um hambúrguer tradicional caprichado!   👍  │
│ [Caio]: Quero nuggets de frango crocante, até uns 35 conto!        👍  │
│ [Bia]: Sou vegetariana! Quero um burger sem carne, até 30 reais.   👍  │
│ [Ana]: /montar                                                         │
│                                                                        │
│ 🤖 [Íris]: Montando a sugestão com o que vocês mandaram...             │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Tela 3: Card da Proposta e Rateio Transparente

O código filtra itens que ferem restrições ou passam do limite, combina 1 ou 2 lojas, cota a taxa de serviço no iFood e calcula o rateio. O card vai para o grupo **sem nenhum orçamento**: só o nome de quem precisa confirmar o valor no privado.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ 🍽️ Sugestão da Íris                                                    │
│ Uma loja atende os três, com opção vegetariana para a Bia.             │
│                                                                        │
│ 🏪 Corta Pra Mim Hamburgueria                                           │
│ • Andrei: Tradicional One — R$ 35,90                                   │
│ • Caio: Nuggets Frango (10 un) — R$ 29,90                              │
│ • Bia: Vegetariano Burger — R$ 27,90                                   │
│ Entrega: R$ 7,50 · Taxa de serviço: R$ 2,99                            │
│ Total da loja: R$ 104,19                                               │
│                                                                        │
│ 💰 Quanto cada um paga                                                 │
│ • Andrei: R$ 39,40 (itens R$ 35,90 + entrega R$ 2,50 + taxa R$ 1,00)   │
│ • Caio:   R$ 33,39 (itens R$ 29,90 + entrega R$ 2,50 + taxa R$ 0,99)   │
│ • Bia:    R$ 31,40 (itens R$ 27,90 + entrega R$ 2,50 + taxa R$ 1,00)   │
│ Total do pedido: R$ 104,19                                             │
│                                                                        │
│ ⏳ Aguardando confirmação de valor no privado: Bia                     │
│                                                                        │
│ 🔘 [✅ Confirmar pedido]                                                │
│ 🔘 [🔄 Outra opção]          (só quando há uma segunda combinação)      │
│ 🔘 [↩️ Voltar para a coleta]                                            │
│ 🔘 [❌ Cancelar pedido]                                                 │
└────────────────────────────────────────────────────────────────────────┘
```

Quem quiser trocar o próprio item escreve no grupo (*"troca o meu por um café"*) e a Íris redesenha o card.

---

### Tela 4: Valor no Privado (Bia)

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 🔒 PRIVADO: Íris ↔ Bia                                                 │
├────────────────────────────────────────────────────────────────────────┤
│ 🤖 Seu pedido fica em R$ 31,40 com entrega e taxa de serviço, acima do │
│    seu orçamento. Pode ser?                                            │
│ 🔘 [Aceito]   🔘 [Quero outro]                                          │
│                                                                        │
│ [Bia toca em Aceito]                                                   │
│ 🤖 Combinado: valor confirmado.                                        │
└────────────────────────────────────────────────────────────────────────┘
```

- **[Quero outro]:** a Íris sugere o item mais parecido que caiba no limite, nas lojas do pedido: [Aceito a sugestão] [Fico sem].
- **No grupo:** o card é atualizado no lugar (a Bia sai da lista de espera) e a Íris avisa: *"✅ Todos confirmaram os valores. Quem organizou já pode confirmar o pedido."*
- Se outra pessoa sair do pedido e a entrega for redividida, quem passar a estourar recebe uma pergunta nova, e os botões da pergunta antiga somem.

---

### Tela 5: Pedido Confirmado

Só a Ana pode confirmar. A Íris reconsulta as lojas e a taxa de serviço no iFood; com tudo igual, emite o pedido autorizado (`AuthorizedOrder`) e publica o resumo.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 GRUPO: "Almoço da Firma - Squad Inovação"                           │
├────────────────────────────────────────────────────────────────────────┤
│ ✅ Pedido confirmado!                                                  │
│ 📍 Entrega em: Av. Paulista, 1000 - Bela Vista, São Paulo - SP         │
│                                                                        │
│ 🏪 Corta Pra Mim Hamburgueria                                           │
│ • Andrei: Tradicional One — R$ 35,90                                   │
│ • Caio: Nuggets Frango (10 un) — R$ 29,90                              │
│ • Bia: Vegetariano Burger — R$ 27,90                                   │
│ Entrega: R$ 7,50 · Taxa de serviço: R$ 2,99                            │
│ Total da loja: R$ 104,19                                               │
│                                                                        │
│ 💰 Quanto cada um paga                                                 │
│ • Andrei: R$ 39,40 · Caio: R$ 33,39 · Bia: R$ 31,40                    │
│ Total do pedido: R$ 104,19                                             │
│                                                                        │
│ Autorizado por Ana · pedido -1001234567890-p1                          │
│ Para um novo pedido, me mencione ou use /iniciar.                      │
└────────────────────────────────────────────────────────────────────────┘
```

- **Clique repetido** em Confirmar mostra *"Este pedido já estava confirmado"* com o mesmo resumo, sem gerar outro pedido.
- **Se algo mudou no iFood:** taxa nova → o card volta atualizado para confirmar de novo; item esgotado ou preço novo → a Íris avisa e a Ana volta para a coleta ou usa `/montar`.

**Próximos passos (fora do MVP):** o core entrega o `AuthorizedOrder` e não compra nada. Submeter o pedido no iFood, link de rastreio e cobrança individual por Pix ficam para o executor de pedidos, ainda não implementado.

---

## 3. Protótipo Interativo em HTML

Para experimentar o fluxo dinamicamente, abra o arquivo anexo no navegador:
👉 [`04-prototipo-interativo.html`](04-prototipo-interativo.html)

### Recursos do Protótipo:
- **Passo a passo:** as 5 telas acima, com os mesmos textos e botões do bot.
- **Grupo e privado:** alterne entre o grupo e o privado (da Ana no endereço, da Bia no valor).
- **Painel de telemetria:** estado da sessão, eventos do core, do catálogo e do modelo. As métricas da coleta vêm das medições em `docs/core-decisoes.md`; as demais são ilustrativas.
