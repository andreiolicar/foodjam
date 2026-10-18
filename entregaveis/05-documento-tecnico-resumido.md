# 05 — Documento Técnico Resumido: Arquitetura, MCP e Decisões Técnicas

**Projeto:** Íris (foodjam)  
**Hackathon:** SEMCOMP × iFood 2026 — *Desafio: Vendendo com Agentes*  
**Módulo:** Engenharia de Software, Arquitetura e Integração Técnica  

---

## 1. Stack Tecnológica e Engenharia de Software

O projeto foi construído do zero com foco em robustez, tipagem estrita e manutenibilidade empresarial:

* **Runtime:** Node.js 24 LTS, TypeScript estrito (`strict: true`), arquitetura de módulos ESM pura (`"type": "module"`).
* **Validação de Contratos em Runtime:** [Zod](https://zod.dev) para validação integral de esquemas internos e de saída do modelo de IA.
* **Comunicação Conversacional:** [grammY](https://grammy.dev) (Telegram Bot Framework).
* **Integração com iFood:** `@modelcontextprotocol/sdk` (SDK oficial do Model Context Protocol).
* **Provedor de Inteligência Artificial:** Cliente HTTP enxuto (`fetch` nativo) sobre a API da Groq / OpenAI-compatible, sem SDKs inflados de terceiros.
* **Testes Automatizados:** [Vitest](https://vitest.dev) cobrindo 100% das regras de negócio financeiras e combinatórias (`regras/dinheiro`, `rateio`, `combinacoes`, `elegibilidade`).

---

## 2. Padrão Arquitetural: Arquitetura Hexagonal (Ports & Adapters)

Para garantir que a lógica de negócio permaneça desacoplada de fornecedores externos (Telegram, iFood ou provedores de IA), o sistema foi organizado em **Portas e Adaptadores**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ARQUITETURA HEXAGONAL DA ÍRIS                         │
│                                                                             │
│  [ Telegram Bot ] ──▶  Fachada: criarAgente()                                │
│                               │                                             │
│                     ┌─────────▼────────┐                                    │
│                     │   CORE / FSM     │                                    │
│                     │  (Regras Puras)  │                                    │
│                     └────┬────────┬────┘                                    │
│                          │        │                                         │
│            ┌─────────────┘        └──────────────┐                          │
│            ▼                                     ▼                          │
│     [ CatalogPort ]                        [ LlmPort ]                      │
│            │                                     │                          │
│            ▼                                     ▼                          │
│    Adaptador iFood MCP                  Adaptador Groq / LLM                │
│    (consumer-mcp.ifood)                 (Qwen 27B / GPT-OSS 120B)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Limites Rígidos entre Módulos:
1. `src/core`: Não importa `grammY`, não importa `src/telegram`, não importa `src/ifood` e não lida com conexões de rede ou tokens.
2. `ports.ts`: Define os contratos abstratos de leitura de catálogo (`CatalogPort`) e geração de texto estruturado (`LlmPort`).
3. `src/index.ts`: Ponto único de composição onde os adaptadores reais são injetados na criação do agente.

---

## 3. A Grande Decisão: IA Probabilística vs. Código Determinístico

Um dos maiores erros em aplicações financeiras com LLMs é permitir que a IA calcule preços, some contas ou autorize transações. **Na Íris, essa divisão é intransponível:**

| Responsabilidade | Quem Executa? | Como é Garantido? |
|---|---|---|
| **Compreensão de Linguagem Natural** | LLM (`fast`) | Extrai desejos, rejeições e orçamentos via JSON Schema estrito. |
| **Matching Semântico de Produtos** | LLM (`capable`) | Apenas opina se o item *"atende"*, é *"substituto"* ou *"não serve"*. |
| **Justificativa da Escolha** | LLM (`fast`) | Gera texto conciso explicando a combinação escolhida. |
| **Validação de Dinheiro** | **Código Puro** | `assertMoneyCents`: inteiros seguros não negativos (`MoneyCents`). Proibido ponto flutuante. |
| **Filtro de Restrições Alimentares** | **Código Puro** | Regex conservador em palavras inteiras. Itens com carne são barrados para vegetarianos antes do LLM. |
| **Otimização Combinatória de Lojas** | **Código Puro** | Enumeração exata de 1 e 2 lojas, validação de pedido mínimo e ordenação multi-critério. |
| **Cálculo de Rateio e Taxas** | **Código Puro** | Algoritmo determinístico dos maiores resíduos. A soma dos centavos bate exatamente com o total. |
| **Autorização de Checkout** | **Humano + Código**| Exige clique explícito do organizador; gera contrato assinado `AuthorizedOrder`. |

---

## 4. Uso e Integração com o MCP do iFood

A Íris conecta-se ao endpoint oficial `https://consumer-mcp.ifood.com.br/marketplace` via cliente MCP remoto com autenticação OAuth.

```text
CatalogPort (Interface do Domínio)         Ferramenta Real MCP iFood
├── validateAddress(text)           ──▶     ifood_validateAddress / ifood_listAddresses
├── searchStores(query, address)    ──▶     ifood_searchOffers / ifood_browseOffers
├── getMenu(storeId, address)       ──▶     ifood_browseOffers / ifood_getItem
└── quoteOrder(storeId, items)      ──▶     ifood_createCart (efêmero) + ifood_getCartDeliveryMethods
```

### Cotação Segura de Taxa de Serviço (`quoteOrder`)
A taxa de serviço e de conveniência do iFood é calculada dinamicamente pelo ecossistema do iFood. Para não inventar regras financeiras:
1. O Core monta uma chamada de cotação com a lista de itens e endereço.
2. O adaptador iFood consulta o endpoint do MCP sem finalizar pedido.
3. A taxa de serviço retornada é incorporada ao cálculo de rateio.
4. Caso a cotação falhe por indisponibilidade momentânea, a proposta é apresentada com aviso transparente de pendência da taxa.

---

## 5. Estratégia de LLM, Otimização em Lote e Benchmarks

### Por que Groq como Provedor Principal?
* O **Gemini AI Studio gratuito** possui limite de 20 requisições/dia por modelo (inviabilizando testes contínuos e demos de hackathon).
* A **Groq** oferece camada com **1.000 requisições/dia e 8.000 tokens/minuto por modelo**, com cotas independentes entre os modelos rápido e avançado.

### Configuração por Níveis:
* **Nível Rápido (`fast`):** `qwen/qwen3.8-27b` (Latência média: **441 ms**, p95: **615 ms**). Modelo reserva em caso de erro 429: `openai/gpt-oss-20b`.
* **Nível Capaz (`capable`):** `openai/gpt-oss-120b` para o casamento semântico de produtos.

### Otimizador de Lote com Debounce (`agrupador.ts`)
Em grupos de chat, os membros costumam responder em rajadas de mensagens quase simultâneas. O `criarAgrupador` acumula mensagens em uma janela de tempo e dispara uma única requisição em lote para até 10 pessoas:

| Métrica | Chamadas Individuais | Processamento em Lote (Íris) | Ganho de Eficiência |
|---|:---:|:---:|:---:|
| **Chamadas ao Modelo** | 10 requisições | **1 requisição** | **-90% de conexões** |
| **Tokens Consumidos** | ~5.000 tokens | **1.530 tokens** | **-70% de tokens** |
| **Tempo Total** | ~7,5 segundos | **2,1 segundos** | **3,5× mais rápido** |

---

## 6. Blindagem de Segurança e Guardrails

1. **Proteção contra Prompt Injection:** Toda mensagem de usuário entra isolada em tags XML sanitizadas (`<mensagem_usuario>`, `<catalogo>`). O prompt de sistema orienta a IA a tratar o conteúdo exclusivamente como dado textual inerte.
2. **Confidencialidade de Limites Financeiros:** O orçamento (`budgetCents`) é extraído diretamente pelo código e armazenado na sessão. **Ele nunca é enviado de volta ao prompt da IA**, eliminando riscos de vazamento por ataque de extração de contexto.
3. **Revalidação Relâmpago (< 60 segundos):** No fechamento do pedido, o catálogo é revalidado. Se algum item esgotou ou mudou de preço entre a proposta e o clique de confirmação, o fechamento é suspenso e o grupo é alertado com a proposta recalculada.
4. **Idempotência de Autorização:** A confirmação do organizador gera uma assinatura única baseada em `${proposalId}:${authorizedAt}`. Cliques acidentais ou repetidos devolvem o mesmo `AuthorizedOrder` sem duplicar cobrança.

