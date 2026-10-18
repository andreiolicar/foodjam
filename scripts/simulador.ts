/**
 * Simula um grupo pelo terminal usando o core com o catálogo fake.
 * Com AI_PROVIDER e AI_API_KEY no .env, usa o modelo real; sem chave, o fake
 * heurístico (sem rede). Uso: npm run simular -- [NomeDoOrganizador]
 *
 * Digite "Nome: mensagem" para falar como alguém do grupo, ou /ajuda.
 */
import { config } from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { interpretarAjuste, proximaRevisao } from '../src/core/ajuste.js';
import { atualizarCatalogo } from '../src/core/catalogo.js';
import { coletar } from '../src/core/coleta.js';
import type { CoreAction, DeliveryAddress, MoneyCents, Proposal } from '../src/core/contracts.js';
import { CatalogoFake, ENDERECO_FAKE } from '../src/core/fakes/catalogo-fake.js';
import { FakeLlm, responderHeuristico } from '../src/core/fakes/llm-fake.js';
import { fechar } from '../src/core/fechamento.js';
import type { RespostaOrcamento } from '../src/core/orcamento.js';
import { atualizarTaxasEOrcamento, avaliarOrcamentos, pendenciasOrcamento, responderOrcamento } from '../src/core/orcamento.js';
import type { PessoaClassificada } from '../src/core/regras/combinacoes.js';
import { comTaxas, cotarTaxas, diferencasDeTaxa, taxasDa } from '../src/core/taxas.js';
import type { LlmCallRecord } from '../src/core/llm.js';
import { criarLlmDoAmbiente, temProvedorReal } from '../src/core/llm-ambiente.js';
import { LlmEmCascata } from '../src/core/llm-cascata.js';
import { OpenAiCompatLlm } from '../src/core/llm-openai.js';
import { propor } from '../src/core/proposta.js';
import type { TimedCatalogSnapshot } from '../src/core/regras/validar-escolhas.js';
import type { CoreSession } from '../src/core/sessao.js';
import { apresentarProposta, cancelar, criarSessao, pedirConfirmacao, trocarPorAlternativa, voltarParaColeta } from '../src/core/sessao.js';

config({ quiet: true });

const AJUDA = `Comandos:
  Nome: mensagem      fala como "Nome" (na coleta, preferência; na proposta, pedido de ajuste)
  /propor             monta a proposta com o catálogo fake
  /ajustar Nome: msg  pede ajuste em texto (ex.: /ajustar Caio: troca o meu por um café)
  /fechar [Nome]      organizador autoriza e fecha (informe outro nome para testar a recusa)
  /endereco texto     valida e troca o endereço de entrega (descarta a proposta)
  /outra              troca pela outra opção (e de volta)
  /orcamento Nome: r  responde à pergunta de valor (r: aceito | outro | sugestao | semitem)
  /voltar             volta da proposta para a coleta
  /sessao             mostra a sessão
  /buscar termo       busca lojas no catálogo fake
  /cardapio lojaId    mostra o cardápio de uma loja
  /log                chamadas ao modelo (e tokens, com modelo real)
  /tokens             tokens gastos por nível (modelo real)
  /cancelar           organizador cancela a sessão
  /ajuda              esta ajuda
  /sair               encerra`;

const brl = (cents: MoneyCents) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
const idDe = (nome: string) =>
  nome
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
const agora = () => new Date().toISOString();

const organizador = process.argv[2] ?? 'Ana';
const catalogo = new CatalogoFake();
const usaModeloReal = temProvedorReal(process.env);
const llm = usaModeloReal ? criarLlmDoAmbiente(process.env) : new FakeLlm(responderHeuristico);
const chamadas: LlmCallRecord[] = [];
const registrar = (r: LlmCallRecord) => chamadas.push(r);
let sessao: CoreSession = criarSessao({
  id: 'sim',
  organizerId: idDe(organizador),
  participants: [{ id: idDe(organizador), displayName: organizador, preferences: {} }],
});
// Endereço de entrega: começa com o endereço aceito pelo fake.
const validacaoInicial = await catalogo.validateAddress(ENDERECO_FAKE);
if (!validacaoInicial.ok) throw new Error('endereço padrão do fake inválido');
let endereco: DeliveryAddress = validacaoInicial.address;
// No bot o organizador confirma por botão; aqui o endereço já entra confirmado.
sessao = { ...sessao, address: { status: 'confirmed', confirmed: endereco } };
let catalogoProposta: TimedCatalogSnapshot | undefined;
let numeroProposta = 0;
let classificacao: PessoaClassificada[] = [];

const nomeDe = (id: string) => sessao.participants.find((p) => p.id === id)?.displayName ?? id;
const nomeItem = (id: string) => catalogoProposta?.menuItems.find((i) => i.id === id)?.name ?? id;
const nomeLoja = (id: string) => catalogoProposta?.stores.find((s) => s.id === id)?.name ?? id;

/** Uso de tokens informado pelo provedor (só com o adaptador real). */
const usos = () => (llm instanceof OpenAiCompatLlm || llm instanceof LlmEmCascata ? llm.usos : []);

function mostrarTokens(desde: number): void {
  const lista = usos().slice(desde);
  if (lista.length === 0) return;
  for (const tier of ['fast', 'capable'] as const) {
    const doNivel = lista.filter((u) => u.tier === tier);
    if (doNivel.length === 0) continue;
    const soma = (f: (u: (typeof doNivel)[number]) => number) => doNivel.reduce((t, u) => t + f(u), 0);
    console.log(
      `  tokens ${tier} (${doNivel[0]?.model}): ${doNivel.length} chamada(s) · entrada ${soma((u) => u.promptTokens)}` +
        ` · saída ${soma((u) => u.completionTokens)} (raciocínio ${soma((u) => u.reasoningTokens)}) · total ${soma((u) => u.totalTokens)}`,
    );
  }
  if (llm instanceof OpenAiCompatLlm) console.log(`  modo de saída estruturada: ${llm.mode}`);
  if (llm instanceof LlmEmCascata) for (const t of llm.trocas.splice(0)) console.log(`  IA: ${t.de} falhou (${t.motivo}) → ${t.para ?? 'nenhum restante'}`);
}

function mostrarSessao(): void {
  console.log(`\nSessão ${sessao.id} · fase: ${sessao.status} · organizador: ${sessao.organizerId}`);
  for (const p of sessao.participants) {
    const { foodPreferences = [], dietaryRestrictions = [], avoids = [], budgetCents } = p.preferences;
    console.log(`  • ${p.displayName} (${p.id})`);
    console.log(`      quer: ${foodPreferences.join(', ') || '—'}`);
    console.log(`      restrições: ${dietaryRestrictions.join(', ') || '—'}`);
    console.log(`      evita: ${avoids.join(', ') || '—'}`);
    console.log(`      itens a receber: ${(p.preferences.wishes ?? []).join(', ') || '—'}`);
    console.log(`      orçamento (privado): ${budgetCents === undefined ? '—' : brl(budgetCents)}`);
  }
  for (const q of sessao.pendingQuestions ?? []) {
    console.log(`  ? ${nomeDe(q.participantId)}: ${q.text}`);
  }
  console.log();
}

function mostrarProposta(proposal: Proposal): void {
  console.log(`\nProposta ${proposal.id}: "${proposal.justification}"`);
  for (const order of proposal.orders) {
    const servico = order.serviceFeeCents === undefined ? 'serviço não cotado' : `serviço ${brl(order.serviceFeeCents)}`;
    console.log(`  🏪 ${nomeLoja(order.storeId)} · entrega ${brl(order.deliveryFeeCents)} · ${servico} · total ${brl(order.totalCents)}`);
    for (const item of order.items) {
      const sub = item.isSubstitute ? ' (substituto)' : '';
      console.log(`      ${nomeDe(item.participantId)}: ${item.quantity}× ${nomeItem(item.menuItemId)} ${brl(item.unitPriceCents)}${sub}`);
    }
  }
  console.log('  Rateio:');
  for (const share of proposal.split.shares) {
    console.log(
      `      ${nomeDe(share.participantId)}: ${brl(share.itemsCents)} + entrega ${brl(share.deliveryCents)}` +
        ` + serviço ${brl(share.serviceCents)} = ${brl(share.totalCents)}`,
    );
  }
  console.log(`      Total: ${brl(proposal.split.totalCents)}`);
  if (proposal.uncoveredParticipantIds.length > 0) {
    console.log(`  Sem item: ${proposal.uncoveredParticipantIds.map(nomeDe).join(', ')}`);
  }
  console.log();
}

function mostrarAcoes(actions: CoreAction[]): void {
  for (const action of actions) {
    if (action.type === 'send_message') {
      console.log(`  [Íris → ${action.participantId ? nomeDe(action.participantId) : 'grupo'}] ${action.text}`);
    } else if (action.type === 'request_address' || action.type === 'confirm_address') {
      console.log(`  [Íris → ${nomeDe(action.participantId)}, privado] ${action.text}`);
    } else if (action.type === 'budget_question') {
      console.log(`  [Íris → ${nomeDe(action.participantId)}, privado] ${action.text} [Aceito] [Quero outro]`);
    } else if (action.type === 'item_suggestion') {
      const botoes = action.menuItemId ? '[Aceito a sugestão] [Fico sem]' : '[Fico sem]';
      console.log(`  [Íris → ${nomeDe(action.participantId)}, privado] ${action.text} ${botoes}`);
    } else {
      console.log('  [sessão atualizada]');
    }
  }
}

function separarFala(texto: string): { nome: string; fala: string } | undefined {
  const separador = texto.indexOf(':');
  if (separador <= 0) return undefined;
  return { nome: texto.slice(0, separador).trim(), fala: texto.slice(separador + 1) };
}

async function ajustarPorTexto(nome: string, fala: string): Promise<void> {
  if (!catalogoProposta) {
    console.log('  não há proposta; use /propor');
    return;
  }
  const result = await interpretarAjuste(sessao, { sessionId: sessao.id, participantId: idDe(nome), text: fala }, catalogoProposta, {
    llm,
    registrar,
  });
  sessao = result.session;
  console.log(`  → ${result.outcome}`);
  mostrarAcoes(result.actions);
  if (result.outcome === 'adjusted') {
    // Ajuste do grupo: zera as respostas de orçamento, recota a taxa e pergunta de novo.
    const semRespostas: CoreSession = { ...sessao };
    delete semRespostas.budget;
    const reavaliada = await atualizarTaxasEOrcamento(semRespostas, catalogo, endereco, catalogoProposta);
    sessao = reavaliada.session;
    mostrarAcoes(reavaliada.actions);
    if (sessao.proposal) mostrarProposta(sessao.proposal);
    mostrarPendencias();
  }
}

const RESPOSTAS: Record<string, RespostaOrcamento> = {
  aceito: 'aceito',
  outro: 'quero_outro',
  sugestao: 'aceito_sugestao',
  semitem: 'fico_sem',
};

async function responderValor(nome: string, texto: string): Promise<void> {
  const resposta = RESPOSTAS[texto.trim().toLowerCase()];
  if (!resposta) {
    console.log('  use /orcamento Nome: aceito | outro | sugestao | semitem');
    return;
  }
  if (!catalogoProposta) {
    console.log('  não há proposta; use /propor');
    return;
  }
  const r = responderOrcamento(sessao, idDe(nome), resposta, { catalog: catalogoProposta, classificacao });
  sessao = r.session;
  console.log(`  → ${r.outcome}`);
  mostrarAcoes(r.actions);
  if (r.itensMudaram) {
    // Mudança vinda de uma resposta: mantém as outras respostas e pergunta a quem passou a estourar.
    const reavaliada = await atualizarTaxasEOrcamento(sessao, catalogo, endereco, catalogoProposta);
    sessao = reavaliada.session;
    mostrarAcoes(reavaliada.actions);
    if (sessao.proposal) mostrarProposta(sessao.proposal);
  }
  mostrarPendencias();
}

function mostrarPendencias(): void {
  const pendentes = pendenciasOrcamento(sessao);
  if (pendentes.length > 0) console.log(`  aguardando resposta de valor: ${pendentes.map(nomeDe).join(', ')}`);
}

async function executar(linha: string): Promise<boolean> {
  const [comando = '', ...resto] = linha.split(' ');
  const argumento = resto.join(' ').trim();

  switch (comando) {
    case '/sair':
      return false;
    case '/ajuda':
      console.log(AJUDA);
      return true;
    case '/sessao':
      mostrarSessao();
      if (sessao.proposal) mostrarProposta(sessao.proposal);
      return true;
    case '/log':
      console.table(chamadas.map((c) => ({ ...c, durationMs: Math.round(c.durationMs) })));
      mostrarTokens(0);
      return true;
    case '/tokens':
      mostrarTokens(0);
      return true;
    case '/buscar':
      for (const loja of await catalogo.searchStores(argumento)) {
        console.log(`  ${loja.id} · ${loja.name} · ${loja.isOpen ? 'aberta' : 'FECHADA'} · entrega ${brl(loja.deliveryFeeCents)}`);
      }
      return true;
    case '/cardapio':
      for (const item of await catalogo.getMenu(argumento)) {
        console.log(`  ${item.id} · ${item.name} · ${brl(item.priceCents)}${item.available ? '' : ' (indisponível)'}`);
      }
      return true;
    case '/cancelar':
      sessao = cancelar(sessao, sessao.organizerId);
      console.log('  sessão cancelada');
      return true;
    case '/endereco': {
      // Valida pela porta (fake) e já considera confirmado; no bot, o organizador confirma por botão.
      const validacao = await catalogo.validateAddress(argumento);
      if (!validacao.ok) {
        console.log(`  endereço recusado: ${validacao.reason}`);
        return true;
      }
      endereco = validacao.address;
      sessao = { ...sessao, address: { status: 'confirmed', confirmed: endereco } };
      console.log(`  endereço: ${endereco.formatted}${sessao.proposal ? ' (proposta atual descartada; use /propor)' : ''}`);
      if (sessao.proposal && (sessao.status === 'reviewing' || sessao.status === 'awaiting_confirmation')) sessao = voltarParaColeta(sessao);
      return true;
    }
    case '/outra':
      if (!sessao.alternative) {
        console.log('  não há outra opção');
        return true;
      }
      {
        const avaliada = avaliarOrcamentos(trocarPorAlternativa(sessao));
        sessao = avaliada.session;
        if (sessao.proposal) mostrarProposta(sessao.proposal);
        mostrarAcoes(avaliada.actions);
        mostrarPendencias();
      }
      return true;
    case '/orcamento': {
      const fala = separarFala(argumento);
      if (!fala) console.log('  use /orcamento Nome: aceito | outro | sugestao | semitem');
      else await responderValor(fala.nome, fala.fala);
      return true;
    }
    case '/voltar':
      sessao = voltarParaColeta(sessao);
      console.log('  de volta à coleta');
      return true;
    case '/propor': {
      const usosAntes = usos().length;
      const inicio = performance.now();
      const result = await propor(sessao, { catalog: catalogo, llm, now: agora(), address: endereco, proposalId: `p${++numeroProposta}`, registrar });
      console.log(`  (proposta em ${Math.round(performance.now() - inicio)} ms)`);
      mostrarTokens(usosAntes);
      if (result.catalog) catalogoProposta = result.catalog;
      if (!result.ok) {
        console.log(`  não foi possível propor: ${result.reason}`);
        for (const p of result.problems ?? []) console.log(`    - ${JSON.stringify(p)}`);
        return true;
      }
      classificacao = result.classificacao;
      const avaliada = avaliarOrcamentos(result.session);
      sessao = avaliada.session;
      mostrarProposta(result.proposal);
      if (result.taxaServicoIndisponivel) console.log('  ⚠ taxa de serviço não cotada nesta proposta');
      const m = result.metricas;
      console.log(
        `  ${result.combinacoesAvaliadas} combinações avaliadas · escolhida: ${m.atendidos} atendido(s) com o que pediram,` +
          ` ${m.faltando} desejo(s) sem item, ${m.substitutos} substituto(s), ${m.lojas} loja(s)`,
      );
      if (result.alternative) {
        console.log('  ── Outra opção (/outra) ──');
        mostrarProposta(result.alternative);
      }
      for (const d of result.discarded) console.log(`  descartado: ${nomeDe(d.participantId)} → ${d.menuItemId} (${d.reason})`);
      for (const u of result.uncertain) console.log(`  ⚠ confirmar ingredientes: ${nomeDe(u.participantId)} → ${nomeItem(u.menuItemId)}`);
      mostrarAcoes(avaliada.actions);
      mostrarPendencias();
      return true;
    }
    case '/ajustar': {
      const fala = separarFala(argumento);
      if (!fala) console.log('  use /ajustar Nome: mensagem');
      else await ajustarPorTexto(fala.nome, fala.fala);
      return true;
    }
    case '/fechar': {
      const proposta = sessao.proposal;
      if (!proposta || !catalogoProposta) {
        console.log('  não há proposta; use /propor');
        return true;
      }
      const ator = argumento ? idDe(argumento) : sessao.organizerId;
      if (sessao.status === 'reviewing') sessao = pedirConfirmacao(sessao);
      const now = agora();
      const storeIds = proposta.orders.map((o) => o.storeId);
      const atualizado = await atualizarCatalogo(catalogo, catalogoProposta, storeIds, now, endereco);
      if (sessao.status !== 'closed' && pendenciasOrcamento(sessao).length === 0) {
        // Taxa de serviço cotada de novo: se mudou, atualiza a proposta e não fecha.
        const cotada = await cotarTaxas(proposta, catalogo, endereco, atualizado);
        const problemas = diferencasDeTaxa(proposta, cotada);
        if (problemas.length > 0) {
          const taxas = new Map([...taxasDa(proposta), ...cotada.taxas]);
          const atualizada = { ...comTaxas(proposta, atualizado, taxas), id: proximaRevisao(proposta.id) };
          const avaliada = avaliarOrcamentos(apresentarProposta(sessao, atualizada));
          sessao = avaliada.session;
          catalogoProposta = atualizado;
          console.log('  taxa de serviço mudou; proposta atualizada:');
          for (const p of problemas) console.log(`    - ${JSON.stringify(p)}`);
          mostrarProposta(atualizada);
          mostrarAcoes(avaliada.actions);
          return true;
        }
      }
      const result = fechar(sessao, ator, now, atualizado);
      if (!result.ok) {
        console.log('  não foi possível fechar:');
        for (const p of result.problems) console.log(`    - ${JSON.stringify(p)}`);
        mostrarPendencias();
        return true;
      }
      sessao = result.session;
      console.log(`  ${result.alreadyClosed ? 'já estava fechado' : 'pedido autorizado'}; dados para o backend executar:`);
      console.log(JSON.stringify(result.order, null, 2));
      return true;
    }
  }

  if (comando.startsWith('/')) {
    console.log(`  comando desconhecido: ${comando} (veja /ajuda)`);
    return true;
  }

  const fala = separarFala(linha);
  if (!fala) {
    console.log('  use o formato "Nome: mensagem"');
    return true;
  }
  if (sessao.status === 'reviewing' || sessao.status === 'awaiting_confirmation') {
    await ajustarPorTexto(fala.nome, fala.fala);
    return true;
  }

  const result = await coletar(
    sessao,
    { sessionId: sessao.id, participantId: idDe(fala.nome), text: fala.fala },
    { llm, registrar },
    fala.nome,
  );
  sessao = result.session;
  console.log(`  → ${result.outcome}`);
  mostrarAcoes(result.actions);
  if (result.outcome === 'preference_updated') mostrarSessao();
  return true;
}

const modo = usaModeloReal ? `modelo real (${process.env.AI_MODEL ?? '?'})` : 'modelo fake heurístico (sem AI_API_KEY)';
console.log(`FoodJam · simulador · catálogo fake · ${modo}. Organizador: ${organizador}.
Endereço de entrega: ${endereco.formatted} (troque com /endereco).
${AJUDA}
`);
const rl = createInterface({ input: stdin, output: stdout, prompt: '> ' });
// Fila própria: as linhas são lidas assim que chegam (colar várias ou usar pipe
// funciona) e processadas em ordem, mesmo depois de a entrada fechar.
const fila: string[] = [];
let entradaFechada = false;
let acordar: (() => void) | undefined;
rl.on('line', (linha) => {
  fila.push(linha);
  acordar?.();
});
rl.on('close', () => {
  entradaFechada = true;
  acordar?.();
});

rl.prompt();
for (;;) {
  if (fila.length === 0) {
    if (entradaFechada) break;
    await new Promise<void>((resolve) => (acordar = resolve));
    acordar = undefined;
    continue;
  }
  const linha = (fila.shift() ?? '').trim();
  if (linha) {
    if (!stdin.isTTY) console.log(linha);
    try {
      if (!(await executar(linha))) break;
    } catch (error) {
      console.log(`  erro: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!entradaFechada) rl.prompt();
}
rl.close();
