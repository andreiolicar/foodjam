# Íris (foodjam) — Dossiê de Entregáveis do Hackathon iFood

**Desafio:** *Vendendo com Agentes* | **Hackathon:** SEMCOMP × iFood 2026  
**Equipe:** Ana Paula, Andrei Olicar, Allan  
**Repositório:** [github.com/andreiolicar/foodjam](https://github.com/andreiolicar/foodjam)  

---

## 🌟 Visão Rápida: O que é a Íris?

A **Íris** é uma agente inteligente para o **Telegram** conectada ao **Model Context Protocol (MCP) do iFood**, projetada para resolver de ponta a ponta o caos dos **pedidos de comida coletivos** (no trabalho, na faculdade ou entre amigos).

A Íris entra no grupo, compreende conversas informais e gírias, cruza cardápios reais de restaurantes no iFood, atende 100% das restrições alimentares duras (vegetarianismo, alergias), preserva a **privacidade de orçamentos individuais via DM**, otimiza a cesta para **no máximo 2 lojas** e calcula um **rateio exato ao centavo** com taxa de serviço e frete oficiais. Tudo sob uma **fronteira de autorização sagrada** (o humano tem sempre o controle do fechamento).

---

## 📂 Mapa dos Entregáveis Oficiais

Todos os 6 entregáveis solicitados pela banca avaliadora estão organizados e prontos para consulta nesta pasta:

| # | Entregável | Arquivo | O que contém |
|:---:|---|---|---|
| **01** | **Proposta de Negócio** | [`01-proposta-de-negocio.md`](01-proposta-de-negocio.md) | O problema da coordenação social e fricção financeira; proposta de valor para organizador e membros; tese de geração de GMV e conversão de carrinhos para o iFood. |
| **02** | **Desenho de Solução** | [`02-desenho-de-solucao.md`](02-desenho-de-solucao.md) | Arquitetura de ponta a ponta, máquina de estados finita (FSM), diagramas Mermaid de fluxo e sequência, debouncer em lote e motor combinatório. |
| **03** | **Racional da Experiência** | [`03-racional-da-experiencia.md`](03-racional-da-experiencia.md) | Decisões de UX e psicologia social: privacidade radical de orçamento em DMs, custo real "All-In", eliminação de formulários frios e autorização human-in-the-loop. |
| **04** | **Interface Visual** | [`04-interface-visual.md`](04-interface-visual.md)<br>👉 **[Protótipo HTML Interativo](04-prototipo-interativo.html)** | Wireframes textuais ricos das 5 telas no Telegram e aplicação standalone interativa para simulação ao vivo no navegador com telemetria do Core. |
| **05** | **Documento Técnico Resumido** | [`05-documento-tecnico-resumido.md`](05-documento-tecnico-resumido.md) | Arquitetura Hexagonal (Ports & Adapters), divisão estrita entre LLM probabilístico e código determinístico (`MoneyCents`), benchmarks (441ms, -70% tokens) e guardrails. |
| **06** | **Feedback sobre os MCPs** | [`06-feedback-sobre-os-mcps.md`](06-feedback-sobre-os-mcps.md) | Dores e evidências reais obtidas em testes com o endpoint oficial do iFood (`MCP-01` a `MCP-05`), divergência de R$ 30 em `getCart`, e propostas de RFC de schemas. |

---

## 🚀 Como Visualizar e Testar a Solução

### 1. Protótipo Visual Interativo (Navegador)
Dê um duplo clique ou abra no seu navegador favorito:
```text
entregaveis/04-prototipo-interativo.html
```
*Você poderá navegar passo a passo pelas 5 etapas do pedido, alternar entre a visão do Grupo e a Mensagem Privada da Bia, e acompanhar a telemetria do Core e do MCP em tempo real.*

### 2. Simulador de Conversa no Terminal
Para rodar o simulador completo de terminal com o catálogo do iFood:
```bash
npm run simular -- Ana
```
*(Permite interagir como qualquer participante no terminal: `Andrei: quero burger`, `/propor`, `/outra`, `/orcamento`, `/fechar`).*

### 3. Validação da Qualidade e Testes do Código
```bash
npm run lint         # Verificação estrita de estilo sem advertências
npm run typecheck    # Verificação estrita de tipos do TypeScript
```

---

## 🏆 Checklist de Alinhamento com a Banca do iFood

- [x] **Aderência ao Desafio "Vendendo com Agentes":** O agente atua ativamente vendendo refeições em grupo e aumentando a taxa de conversão do marketplace.
- [x] **Uso Genuíno do MCP:** Integração mapeada com `searchOffers`, `browseOffers`, `getItem`, `createCart`, `getCartDeliveryMethods` e `getCart`.
- [x] **Segurança e Integridade Financeira:** Nenhum valor monetário é confiado a cálculos de LLM; dinheiro é tratado em centavos inteiros (`MoneyCents`).
- [x] **Feedback Real para a Engenharia do iFood:** Relato minucioso baseado em testes reais com logs de payload e propostas de melhoria de APIs.

