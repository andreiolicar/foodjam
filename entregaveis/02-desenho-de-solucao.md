# 02 — Desenho de Solução: Arquitetura e Fluxo Geral da Íris

**Projeto:** Íris (foodjam)  
**Hackathon:** SEMCOMP × iFood 2026 — *Desafio: Vendendo com Agentes*  
**Módulo:** Arquitetura do Sistema e Engenharia de Fluxo  

---

## 1. Visão Geral da Solução

A Íris foi projetada sob o princípio da **inteligência híbrida**: a flexibilidade da linguagem natural é combinada à confiabilidade matemática de uma máquina de estados estrita. A inteligência artificial interpreta o que as pessoas querem; o código garante que o dinheiro, as restrições alimentares e a autorização final sejam 100% determinísticos.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FLUXO DE INTEGRAÇÃO                              │
│                                                                             │
│  Telegram Chat ──▶  Agrupador (Debounce) ──▶  Core da Íris (State Machine)  │
│                                                       │                     │
│                             ┌─────────────────────────┴──────────────────┐  │
│                             ▼                                            ▼  │
│                    LLM Gateway (Groq)                          MCP do iFood  │
│               - Classificação de desejos                   - Validação endereço│
│               - Matching semântico de itens                - Busca de lojas │
│               - Justificativas contextuais                 - Cardápios reais│
│                                                            - Cotação taxas  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Máquina de Estados da Sessão

Diferente de agentes ReAct autônomos que podem entrar em loops infinitos ou tomar decisões imprevisíveis, a Íris opera como uma **Máquina de Estados Finita (FSM)**:

```mermaid
stateDiagram-v2
    [*] --> collecting: /iniciar (Organizador)
    
    state collecting {
        [*] --> aguardando_endereco
        aguardando_endereco --> coletando_desejos: Endereço Validado & Confirmado
        coletando_desejos --> coletando_desejos: Mensagens dos Participantes (Lote/Debounce)
    }

    collecting --> reviewing: /propor (Organizador)
    
    state reviewing {
        [*] --> gerando_combinacoes
        gerando_combinacoes --> cotando_taxas: Melhores 1 e 2 Lojas Selecionadas
        cotando_taxas --> resolvendo_orcamento: Taxas de Serviço do iFood Cotadas
        resolvendo_orcamento --> proposta_pronta: Perguntas Privadas Respondidas
        proposta_pronta --> gerando_combinacoes: Ajuste de Item Solicitado (/ajustar)
        proposta_pronta --> gerando_combinacoes: Troca por Alternativa (/outra)
    }

    reviewing --> collecting: /voltar
    reviewing --> awaiting_confirmation: pedirConfirmacao()
    
    awaiting_confirmation --> closed: fechar() [Autorização Explícita do Organizador]
    
    collecting --> cancelled: /cancelar
    reviewing --> cancelled: /cancelar
    awaiting_confirmation --> cancelled: /cancelar

    closed --> [*]: Entrega do AuthorizedOrder ao MCP
    cancelled --> [*]
```

### Árvore Detalhada de Processos e Botões

```mermaid
flowchart TD
    %% Setup Inicial
    START([1. Iniciar no Grupo]):::setup --> INICIAR["iris.iniciar()"]:::action
    INICIAR --> CHECK_ADDR{Endereço Padrão?}:::decision

    %% Ramo de Endereço (Privado)
    CHECK_ADDR -- Sim, válido --> ADDR_DEF["DM Organizador:\n[Sim] [Outro endereço]"]:::dm
    CHECK_ADDR -- Não ou inválido --> ADDR_TYP["DM Organizador:\nDigite o endereço"]:::dm

    ADDR_DEF -- "[Sim]" --> ADDR_OK["Endereço Confirmado"]:::success
    ADDR_DEF -- "[Outro endereço]" --> ADDR_TYP
    ADDR_TYP -- "Organizador digita texto" --> ADDR_VAL["MCP: validateAddress()"]:::action
    ADDR_VAL -- Válido --> ADDR_CONF["DM Organizador:\n[Confirmar] [Corrigir]"]:::dm
    ADDR_VAL -- Inválido --> ADDR_TYP
    ADDR_CONF -- "[Confirmar]" --> ADDR_OK
    ADDR_CONF -- "[Corrigir]" --> ADDR_TYP

    %% Ramo de Coleta (Grupo)
    INICIAR --> COLETANDO["FASE: collecting (Coleta Livre)"]:::state
    COLETANDO --> MSG_GRUPO["Membros falam no chat livre:\ndesejos, restrições, limite R$"]:::chat
    MSG_GRUPO --> AGRLOTE["Agrupador (Debounce lote até 10 pessoas)"]:::action
    AGRLOTE --> COLETANDO

    %% Ação: Montar Pedido
    COLETANDO --> BTN_PROPOR{"Organizador clica:\n[Montar Pedido]"}:::decision
    BTN_PROPOR -- Endereço pendente --> ERR_ADDR["outcome: address_required\n(Pede confirmação do endereço)"]:::warning
    ERR_ADDR --> COLETANDO
    BTN_PROPOR -- Endereço OK --> EXEC_PROPOR["iris.propor()\n(Busca MCP + LLM + Combinações 1-2 lojas)"]:::action

    %% Ramo de Proposta / Revisão
    EXEC_PROPOR --> REVIEWING["FASE: reviewing (Proposta no Grupo)"]:::state
    REVIEWING --> CHECK_BUDGET{Alguém passou do limite?}:::decision

    %% Sub-ramo: Orçamento Privado
    CHECK_BUDGET -- Sim --> DM_BUDGET["DM do Participante:\n[Aceito] [Quero outro]"]:::dm
    DM_BUDGET -- "[Aceito]" --> BUD_ACC["Orçamento Liberado"]:::success
    DM_BUDGET -- "[Quero outro]" --> BUD_SUG["DM: Sugestão de Item\n[Aceito a sugestão] [Fico sem]"]:::dm
    BUD_SUG -- "[Aceito a sugestão]" --> BUD_SWAP["Troca pelo item sugerido mais barato\n+ Recota taxas no iFood"]:::action
    BUD_SUG -- "[Fico sem]" --> BUD_OUT["Pessoa removida do pedido (uncovered)\n+ Recota taxas no iFood"]:::action
    BUD_SWAP --> REVIEWING
    BUD_OUT --> REVIEWING
    CHECK_BUDGET -- Não ou Todos Respondidos --> PROPOSTA_LIBERADA["Proposta Pronta para Decisão"]:::state

    %% Ações e Botões no Card da Proposta
    PROPOSTA_LIBERADA --> BTN_OPCAO{"Ações no Card da Proposta"}:::decision

    %% Botão Outra Opção
    BTN_OPCAO -- "[🔄 Outra Opção]\n(Se alternative existir)" --> BTN_OUTRA["iris.outraOpcao()"]:::action
    BTN_OUTRA --> SWITCH_ALT["Inverte proposta atual com alternativa\n(Zero LLM, Instantâneo)"]:::action
    SWITCH_ALT --> REVIEWING

    %% Ajuste por Texto no Grupo
    BTN_OPCAO -- "Membro fala no chat:\n'troca o meu por...'" --> MSG_AJUSTE["iris.mensagem() -> interpretarAjuste()"]:::action
    MSG_AJUSTE --> APLICA_AJUSTE["Troca o item + Recota taxas\n+ Descarta alternativa"]:::action
    APLICA_AJUSTE --> REVIEWING

    %% Botão Voltar para a Coleta
    BTN_OPCAO -- "[↩️ Voltar para a Coleta]" --> BTN_VOLTAR["iris.reabrirColeta()"]:::action
    BTN_VOLTAR --> REABRE["Descarta proposta, alternativa e orçamentos\nVolta para collecting"]:::action
    REABRE --> COLETANDO

    %% Botão Cancelar
    BTN_OPCAO -- "[❌ Cancelar Pedido]" --> BTN_CANC["iris.cancelar()"]:::action
    BTN_CANC --> CANCELLED["FASE: cancelled (Encerrada)"]:::finish

    %% Botão Confirmar Pedido
    BTN_OPCAO -- "[✅ Confirmar Pedido]" --> BTN_FECHAR["iris.fechar()"]:::action
    BTN_FECHAR --> VAL_FECHAR{Validações de Fechamento}:::decision
    VAL_FECHAR -- Orçamento pendente na DM --> ERR_BUD["outcome: budget_pending\n(Avisa no grupo quem falta responder)"]:::warning
    ERR_BUD --> REVIEWING
    VAL_FECHAR -- Catálogo > 60s ou Taxa mudou --> ERR_TAXA["outcome: close_rejected\n(Recota e atualiza a proposta)"]:::warning
    ERR_TAXA --> REVIEWING
    VAL_FECHAR -- Tudo Íntegro & Aprovado --> CLOSED["FASE: closed\n(AuthorizedOrder emitido para o iFood MCP)"]:::finish

    classDef setup fill:#1e293b,stroke:#64748b,color:#f8fafc
    classDef state fill:#0f172a,stroke:#3b82f6,stroke-width:2px,color:#f8fafc
    classDef action fill:#1e1b4b,stroke:#818cf8,color:#f8fafc
    classDef decision fill:#312e81,stroke:#a5b4fc,color:#f8fafc
    classDef dm fill:#451a03,stroke:#f59e0b,color:#f8fafc
    classDef success fill:#064e3b,stroke:#10b981,color:#f8fafc
    classDef warning fill:#701a75,stroke:#f472b6,color:#f8fafc
    classDef finish fill:#7f1d1d,stroke:#ef4444,stroke-width:2px,color:#f8fafc
    classDef chat fill:#134e4a,stroke:#14b8a6,color:#f8fafc
```

---

## 3. O Fluxo de Solução Passo a Passo

### Etapa 1: Início e Confirmação de Endereço
1. O organizador adiciona a Íris ao grupo e digita `/iniciar`.
2. A Íris propõe o endereço padrão do organizador ou solicita um novo no privado.
3. O endereço textual é normalizado e verificado pelo endpoint `validateAddress` do adaptador MCP do iFood.
4. Somente após a confirmação do organizador a sessão de compras é liberada.

### Etapa 2: Coleta de Preferências em Linguagem Natural
1. Os membros do grupo mandam mensagens espontâneas no chat: *"quero um x-bacon"*, *"algo vegetariano até R$ 35"*, *"não gosto de cebola"*.
2. **Debounce Inteligente (`criarAgrupador`):** Mensagens enviadas quase simultâneas são acumuladas em uma janela de tempo e processadas em um único lote (reduzindo chamadas e tokens em mais de 70%).
3. O modelo rápido (`fast`: Qwen 27B) extrai estruturadamente: preferências gastronômicas, desejos específicos de itens (`wishes`), restrições alimentares duras (`dietaryRestrictions`), rejeições (`avoids`) e limites de orçamento (`budgetCents`).
4. **Isolamento de Segurança:** O orçamento informado nunca entra no prompt de terceiros e não é revelado no grupo.

### Etapa 3: Busca no iFood e Filtro Rígido de Elegibilidade
1. O Core consulta o catálogo do iFood (`searchStores` e `getMenu`) em estabelecimentos reais abertos que entregam no endereço.
2. O código de elegibilidade (`regras/elegibilidade.ts`) executa uma triagem estrita em memória:
   - Itens que violam restrições dietéticas (ex.: carne para quem é vegetariano) são **automaticamente eliminados**.
   - Itens cujo valor unitário supera o orçamento do participante são **descartados**.
   - Bebidas são impedidas de substituir pratos principais de comida.

### Etapa 4: Matching Semântico e Otimizador Combinatório
1. O modelo avançado (`capable`: GPT OSS 120B) apenas classifica a adequação semântica entre cada desejo e os itens disponíveis: *"atende"*, *"substituto"* ou *"não serve"*.
2. O algoritmo combinatório (`regras/combinacoes.ts`) enumera todas as combinações viáveis de **1 ou no máximo 2 lojas parceiras** (evitando dispersão de entrega).
3. Critério matemático de desempate da melhor proposta:
   $$\text{Mais pessoas atendidas} > \text{Menos desejos vazios} > \text{Menos substitutos} > \text{Menos lojas} > \text{Dentro do orçamento} > \text{Menor total}$$
4. O motor guarda a melhor proposta (`proposal`) e a segunda melhor (`alternative`), permitindo alternância instantânea pelo botão *"Outra Opção"*.

### Etapa 5: Cotação Oficial de Taxas e Rateio Justo
1. O Core aciona `CatalogPort.quoteOrder` para obter os valores reais de taxa de entrega e taxa de serviço do iFood.
2. O rateio é calculado em centavos inteiros (`MoneyCents`):
   - Cada participante assume o valor exato dos seus itens.
   - O frete e a taxa de serviço de cada loja são divididos igualmente entre quem pediu naquela loja.
   - Centavos residuais são atribuídos determinística e transparentemente via algoritmo dos maiores resíduos.

### Etapa 6: Resolução Privada de Orçamento
1. Se a soma (itens + frete rateado + taxa de serviço) exceder o limite privado do participante:
   - A Íris **chama a pessoa no privado** com botões inline: `[Aceitar]` ou `[Quero outro]`.
   - Se escolher `[Quero outro]`, o código sugere o item compatível mais próximo que caiba no orçamento (`[Aceito sugestão]` ou `[Fico sem]`).
   - O grupo é notificado apenas de quem falta responder, preservando total sigilo sobre valores.

### Etapa 7: Fechamento com Autorização Sagrada
1. O organizador clica em `[Autorizar e Fechar Pedido]`.
2. O sistema verifica se o catálogo foi consultado há menos de 60 segundos e recota a taxa de serviço no MCP.
3. Se qualquer preço ou item tiver mudado, a operação é interrompida com alerta e atualização da proposta.
4. Estando tudo válido, é gerado o contrato assinado `AuthorizedOrder` e despachado para a camada de submissão do iFood.

---

## 4. Diagrama de Sequência de Ponta a Ponta

```mermaid
sequenceDiagram
    autonumber
    actor Org as Organizador
    actor Grupo as Membros do Grupo
    participant Bot as Bot Telegram (Íris)
    participant Core as Core da Íris (FSM)
    participant LLM as Provedor de IA (Groq)
    participant MCP as Servidor MCP iFood

    Org->>Bot: /iniciar pedido no grupo
    Bot->>Core: iniciarSessao()
    Core->>MCP: validateAddress(endereco)
    MCP-->>Core: Endereço normalizado OK
    Core-->>Org: Confirmação de endereço (Botão)
    Org->>Bot: [Confirmar Endereço]

    loop Coleta de Desejos
        Grupo->>Bot: Mensagens informais ("quero burger", "vegetariano max 30")
        Bot->>Core: mensagensEmLote() (Debounce)
        Core->>LLM: Extração estruturada (JSON Schema)
        LLM-->>Core: Preferências, restrições e orçamentos
    end

    Org->>Bot: /propor
    Core->>MCP: searchStores() & getMenu()
    MCP-->>Core: Lojas e itens em tempo real
    Core->>Core: Filtros de elegibilidade & restrições
    Core->>LLM: Matching semântico (atende/substituto)
    Core->>Core: Otimização combinatória (1-2 lojas)
    Core->>MCP: quoteOrder() (Cotação de taxa de serviço e frete)
    MCP-->>Core: Taxas oficiais calculadas

    opt Participante ultrapassou orçamento
        Core-->>Bot: Enviar pergunta privada (DM)
        Bot-->>Grupo: Pergunta via botão privado ([Aceito] / [Quero outro])
        Grupo->>Bot: Resposta privada
        Core->>Core: Recálculo em cascata do rateio
    end

    Core-->>Bot: Apresentar Proposta no Grupo com Rateio
    Bot-->>Grupo: Card com restaurantes, itens e divisão exata

    Org->>Bot: [Autorizar e Fechar Pedido]
    Core->>MCP: Revalidação de catálogo (< 60s) e recotação
    MCP-->>Core: Valores íntegros confirmados
    Core-->>Bot: AuthorizedOrder emitido
    Bot->>MCP: ifood_createCart & ifood_submitOrder
    Bot-->>Grupo: Pedido confirmado! Link de rastreio e comprovante do rateio.
```

