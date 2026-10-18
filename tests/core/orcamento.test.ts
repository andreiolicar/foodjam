import { describe, expect, it } from 'vitest';
import type { CoreAction, Proposal } from '../../src/core/contracts.js';
import { CatalogoFake } from '../../src/core/fakes/catalogo-fake.js';
import {
  TEXTOS_ORCAMENTO,
  atualizarTaxasEOrcamento,
  avaliarOrcamentos,
  baseDaProposta,
  pendenciasOrcamento,
  responderOrcamento,
} from '../../src/core/orcamento.js';
import type { PessoaClassificada } from '../../src/core/regras/combinacoes.js';
import type { CoreSession } from '../../src/core/sessao.js';
import { apresentarProposta } from '../../src/core/sessao.js';
import { comTaxas, cotarTaxas, diferencasDeTaxa, taxasDa } from '../../src/core/taxas.js';
import { ENDERECO, LOJAS, cenarioPadaria, item, proposta } from './fixtures.js';

// Padaria: Misto R$ 11,90 (Ana), Lanche Natural R$ 13,90 (Bia), Bolo R$ 8,90 (Caio).
// Entrega R$ 4,90 dividida em 164/163/163: o Caio fica em R$ 10,53 sem taxa de serviço.

const classificacao = (participantId: string, atende: string[], substitutos: string[] = []): PessoaClassificada[] => [
  { participantId, desejos: [{ atende, substitutos }] },
];

const tipos = (actions: CoreAction[]) => actions.map((a) => a.type);
const itensDe = (session: CoreSession, participantId: string) =>
  session.proposal?.orders.flatMap((o) => o.items).filter((i) => i.participantId === participantId).map((i) => i.menuItemId);

/** Caio com orçamento de R$ 10 e a pergunta já feita. */
async function caioPerguntado() {
  const { catalog, revisao } = await cenarioPadaria(1000);
  const { session, actions } = avaliarOrcamentos(revisao);
  return { catalog, session, actions };
}

function comOrcamento(session: CoreSession, budgets: Record<string, number>): CoreSession {
  return {
    ...session,
    participants: session.participants.map((p) => {
      const budgetCents = budgets[p.id];
      return budgetCents === undefined ? p : { ...p, preferences: { ...p.preferences, budgetCents } };
    }),
  };
}

describe('baseDaProposta', () => {
  it.each([
    ['p1', 'p1'],
    ['p1-r1', 'p1'],
    ['chat-p2-r3', 'chat-p2'],
    ['p1-b', 'p1-b'],
    ['p1-b-r2', 'p1-b'],
  ])('%s → %s', (id, base) => {
    expect(baseDaProposta(id)).toBe(base);
  });
});

describe('avaliarOrcamentos', () => {
  it('pergunta no privado a quem passou do orçamento com entrega, com o valor total', async () => {
    const { session, actions } = await caioPerguntado();
    expect(actions).toEqual([
      {
        type: 'budget_question',
        sessionId: 's1',
        participantId: 'caio',
        proposalId: 'p1',
        totalCents: 1053,
        text: TEXTOS_ORCAMENTO.pergunta(1053),
      },
    ]);
    expect(actions[0]?.type === 'budget_question' && actions[0].text).toContain('R$ 10,53');
    expect(pendenciasOrcamento(session)).toEqual(['caio']);
  });

  it('quem cabe no orçamento, ou não tem orçamento, não é perguntado', async () => {
    const { revisao } = await cenarioPadaria(1053);
    const { session, actions } = avaliarOrcamentos(revisao);
    expect(actions).toEqual([]);
    expect(pendenciasOrcamento(session)).toEqual([]);
  });

  it('não repete a pergunta pendente para o mesmo valor', async () => {
    const { session } = await caioPerguntado();
    expect(avaliarOrcamentos(session).actions).toEqual([]);
    expect(pendenciasOrcamento(avaliarOrcamentos(session).session)).toEqual(['caio']);
  });

  it('pendência sem estado salvo também bloqueia (quem passou e nunca foi perguntado)', async () => {
    const { revisao } = await cenarioPadaria(1000);
    expect(pendenciasOrcamento(revisao)).toEqual(['caio']);
  });

  it('a resposta vale para as revisões da mesma proposta, mas não para outra proposta', async () => {
    const { catalog, session } = await caioPerguntado();
    const aceito = responderOrcamento(session, 'caio', 'aceito', { catalog, classificacao: [] }).session;

    const revisao = apresentarProposta(aceito, { ...aceito.proposal!, id: 'p1-r1' });
    expect(avaliarOrcamentos(revisao).actions).toEqual([]);

    const outra = apresentarProposta(aceito, { ...aceito.proposal!, id: 'p2' });
    expect(tipos(avaliarOrcamentos(outra).actions)).toEqual(['budget_question']);
  });

  it('se o valor sobe depois do aceite, pergunta de novo', async () => {
    const { catalog, session } = await caioPerguntado();
    const aceito = responderOrcamento(session, 'caio', 'aceito', { catalog, classificacao: [] }).session;
    const comTaxa = apresentarProposta(aceito, {
      ...comTaxas(aceito.proposal!, catalog, new Map([[LOJAS.padaria, 174]])),
      id: 'p1-r1',
    });
    const { actions } = avaliarOrcamentos(comTaxa);
    expect(actions).toMatchObject([{ type: 'budget_question', participantId: 'caio', totalCents: 1053 + 58 }]);
  });

  it('se o valor desce para dentro do orçamento, a pendência some', async () => {
    const { session } = await caioPerguntado();
    const folgado = comOrcamento(session, { caio: 2000 });
    const avaliada = avaliarOrcamentos(folgado);
    expect(avaliada.actions).toEqual([]);
    expect(pendenciasOrcamento(avaliada.session)).toEqual([]);
  });

  it('sem proposta, limpa o estado', async () => {
    const { session } = await caioPerguntado();
    const semProposta: CoreSession = { ...session };
    delete semProposta.proposal;
    expect(avaliarOrcamentos(semProposta).session.budget).toBeUndefined();
  });
});

describe('responderOrcamento', () => {
  it('"aceito" registra o valor e libera o fechamento', async () => {
    const { catalog, session } = await caioPerguntado();
    const r = responderOrcamento(session, 'caio', 'aceito', { catalog, classificacao: [] });
    expect(r.outcome).toBe('budget_accepted');
    expect(r.itensMudaram).toBe(false);
    expect(r.actions).toEqual([{ type: 'send_message', sessionId: 's1', participantId: 'caio', text: TEXTOS_ORCAMENTO.aceito }]);
    expect(pendenciasOrcamento(r.session)).toEqual([]);
  });

  it('"quero outro" sugere o item da classificação que cabe no orçamento', async () => {
    const { catalog, session } = await caioPerguntado();
    const r = responderOrcamento(session, 'caio', 'quero_outro', { catalog, classificacao: classificacao('caio', ['pad-cafe']) });
    expect(r.outcome).toBe('budget_suggested');
    // Café R$ 6,90 + entrega R$ 1,63 = R$ 8,53.
    expect(r.actions).toEqual([
      {
        type: 'item_suggestion',
        sessionId: 's1',
        participantId: 'caio',
        proposalId: 'p1',
        menuItemId: 'pad-cafe',
        totalCents: 853,
        text: TEXTOS_ORCAMENTO.sugestao('Café com Leite', 853),
      },
    ]);
    expect(r.session.proposal).toBe(session.proposal);
    expect(pendenciasOrcamento(r.session)).toEqual(['caio']);
  });

  it('a sugestão pula itens que não cabem, de lojas fora do pedido ou que a pessoa já tem', async () => {
    const { catalog, session } = await caioPerguntado();
    const r = responderOrcamento(session, 'caio', 'quero_outro', {
      catalog,
      classificacao: classificacao('caio', ['pad-bolo-cenoura', 'pad-lanche-natural', 'burger-x-salada'], ['pad-cafe']),
    });
    expect(r.actions[0]).toMatchObject({ type: 'item_suggestion', menuItemId: 'pad-cafe' });
  });

  it('sem item que caiba, avisa e espera "fico sem"', async () => {
    const { catalog, session } = await caioPerguntado();
    const r = responderOrcamento(session, 'caio', 'quero_outro', { catalog, classificacao: classificacao('caio', ['pad-lanche-natural']) });
    expect(r.outcome).toBe('budget_no_suggestion');
    expect(r.actions).toEqual([
      { type: 'item_suggestion', sessionId: 's1', participantId: 'caio', proposalId: 'p1', text: TEXTOS_ORCAMENTO.semSugestao },
    ]);
    expect(responderOrcamento(r.session, 'caio', 'aceito_sugestao', { catalog, classificacao: [] }).outcome).toBe('budget_invalid_answer');
    expect(responderOrcamento(r.session, 'caio', 'fico_sem', { catalog, classificacao: [] }).outcome).toBe('budget_left_out');
  });

  it('"aceito a sugestão" troca o item, cria uma revisão e tira a pendência', async () => {
    const { catalog, session } = await caioPerguntado();
    const ctx = { catalog, classificacao: classificacao('caio', ['pad-cafe']) };
    const sugerida = responderOrcamento(session, 'caio', 'quero_outro', ctx).session;
    const r = responderOrcamento(sugerida, 'caio', 'aceito_sugestao', ctx);

    expect(r.outcome).toBe('budget_item_swapped');
    expect(r.itensMudaram).toBe(true);
    expect(r.session.proposal?.id).toBe('p1-r1');
    expect(itensDe(r.session, 'caio')).toEqual(['pad-cafe']);
    expect(r.session.proposal?.split.shares.find((s) => s.participantId === 'caio')?.totalCents).toBe(853);
    expect(r.session.proposal?.split.totalCents).toBe(1190 + 1390 + 690 + 490);
    expect(pendenciasOrcamento(r.session)).toEqual([]);
    expect(r.actions).toEqual([{ type: 'send_message', sessionId: 's1', participantId: 'caio', text: TEXTOS_ORCAMENTO.trocado }]);
  });

  it('"fico sem" tira a pessoa do pedido e refaz o rateio entre quem ficou', async () => {
    const { catalog, session } = await caioPerguntado();
    const r = responderOrcamento(session, 'caio', 'quero_outro', { catalog, classificacao: [] });
    const fora = responderOrcamento(r.session, 'caio', 'fico_sem', { catalog, classificacao: [] });

    expect(fora.outcome).toBe('budget_left_out');
    expect(fora.itensMudaram).toBe(true);
    expect(itensDe(fora.session, 'caio')).toEqual([]);
    expect(fora.session.proposal?.uncoveredParticipantIds).toEqual(['caio']);
    expect(fora.session.proposal?.split.shares.map((s) => s.deliveryCents)).toEqual([245, 245]);
    expect(pendenciasOrcamento(fora.session)).toEqual([]);
  });

  it('"fico sem" direto na pergunta de valor também vale', async () => {
    const { catalog, session } = await caioPerguntado();
    expect(responderOrcamento(session, 'caio', 'fico_sem', { catalog, classificacao: [] }).outcome).toBe('budget_left_out');
  });

  it('se ninguém sobra com item, a sessão volta para a coleta e o grupo é avisado', async () => {
    const { catalog, revisao } = await cenarioPadaria(500);
    const sozinho = apresentarProposta(revisao, proposta(catalog, [item(catalog, 'caio', 'pad-bolo-cenoura')]));
    const perguntada = avaliarOrcamentos(sozinho).session;
    const r = responderOrcamento(perguntada, 'caio', 'fico_sem', { catalog, classificacao: [] });
    expect(r.session.status).toBe('collecting');
    expect(r.session.proposal).toBeUndefined();
    expect(r.actions).toContainEqual({ type: 'send_message', sessionId: 's1', text: TEXTOS_ORCAMENTO.pedidoVazio });
  });

  it('efeito em cascata: quem sai encarece a entrega dos outros, que passam a ser perguntados', async () => {
    const { catalog, session } = await caioPerguntado();
    // Bia cabe com a entrega dividida por 3 (13,90 + 1,63 = 15,53), mas não por 2 (13,90 + 2,45 = 16,35).
    const comBia = avaliarOrcamentos(comOrcamento(session, { bia: 1600 })).session;
    expect(pendenciasOrcamento(comBia)).toEqual(['caio']);

    const fora = responderOrcamento(comBia, 'caio', 'fico_sem', { catalog, classificacao: [] });
    const reavaliada = avaliarOrcamentos(fora.session);
    expect(reavaliada.actions).toMatchObject([{ type: 'budget_question', participantId: 'bia', totalCents: 1635, proposalId: 'p1-r1' }]);
    expect(pendenciasOrcamento(reavaliada.session)).toEqual(['bia']);
  });

  it('só quem tem pergunta pendente responde', async () => {
    const { catalog, session } = await caioPerguntado();
    const r = responderOrcamento(session, 'bia', 'aceito', { catalog, classificacao: [] });
    expect(r.outcome).toBe('budget_nothing_pending');
    expect(r.session).toBe(session);
    expect(r.actions).toEqual([{ type: 'send_message', sessionId: 's1', participantId: 'bia', text: TEXTOS_ORCAMENTO.nadaPendente }]);
  });

  it('"aceito a sugestão" sem sugestão feita é inválido', async () => {
    const { catalog, session } = await caioPerguntado();
    const r = responderOrcamento(session, 'caio', 'aceito_sugestao', { catalog, classificacao: [] });
    expect(r.outcome).toBe('budget_invalid_answer');
    expect(r.session).toBe(session);
  });

  it('as mensagens privadas e a pergunta nunca expõem o orçamento da pessoa', async () => {
    const { catalog, session, actions } = await caioPerguntado();
    const r = responderOrcamento(session, 'caio', 'quero_outro', { catalog, classificacao: classificacao('caio', ['pad-cafe']) });
    expect(JSON.stringify([...actions, ...r.actions])).not.toMatch(/R\$ 10,00|1000/);
  });
});

describe('cotação da taxa de serviço', () => {
  it('cotarTaxas cota cada loja e refaz pedidos e rateio com a taxa', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const port = new CatalogoFake();
    const r = await cotarTaxas(revisao.proposal!, port, ENDERECO, catalog);
    // 5% de R$ 34,70 = R$ 1,74 (arredondado), dividido em 58/58/58.
    expect(r.falhas).toEqual([]);
    expect(r.taxas).toEqual(new Map([[LOJAS.padaria, 174]]));
    expect(r.proposal.orders[0]).toMatchObject({ serviceFeeCents: 174, totalCents: 3470 + 490 + 174 });
    expect(r.proposal.split.shares.map((s) => s.serviceCents)).toEqual([58, 58, 58]);
    expect(port.calls).toEqual([{ operation: 'quoteOrder', input: LOJAS.padaria, address: ENDERECO.formatted }]);
  });

  it('falha de cotação deixa a loja sem taxa e em "falhas"', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const port = Object.assign(Object.create(new CatalogoFake()) as CatalogoFake, {
      quoteOrder: async () => {
        throw new Error('timeout');
      },
    });
    const r = await cotarTaxas(revisao.proposal!, port, ENDERECO, catalog);
    expect(r.falhas).toEqual([LOJAS.padaria]);
    expect(r.proposal.orders[0]?.serviceFeeCents).toBeUndefined();
  });

  it('taxasDa e diferencasDeTaxa comparam a proposta com uma nova cotação', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const comTaxa: Proposal = comTaxas(revisao.proposal!, catalog, new Map([[LOJAS.padaria, 174]]));
    expect(taxasDa(comTaxa)).toEqual(new Map([[LOJAS.padaria, 174]]));
    expect(taxasDa(revisao.proposal!)).toEqual(new Map());

    const igual = { proposal: comTaxa, taxas: new Map([[LOJAS.padaria, 174]]), falhas: [] };
    expect(diferencasDeTaxa(comTaxa, igual)).toEqual([]);

    const mudou = { ...igual, taxas: new Map([[LOJAS.padaria, 199]]) };
    expect(diferencasDeTaxa(comTaxa, mudou)).toEqual([
      { code: 'service_fee_changed', storeId: LOJAS.padaria, proposedCents: 174, currentCents: 199 },
    ]);
    expect(diferencasDeTaxa(revisao.proposal!, mudou)).toEqual([
      { code: 'service_fee_changed', storeId: LOJAS.padaria, proposedCents: null, currentCents: 199 },
    ]);

    const falhou = { ...igual, taxas: new Map(), falhas: [LOJAS.padaria] };
    expect(diferencasDeTaxa(comTaxa, falhou)).toEqual([{ code: 'service_fee_unavailable', storeId: LOJAS.padaria }]);
  });

  it('atualizarTaxasEOrcamento recota e pergunta com o valor já com a taxa', async () => {
    const { catalog, revisao } = await cenarioPadaria(1000);
    const r = await atualizarTaxasEOrcamento(revisao, new CatalogoFake(), ENDERECO, catalog);
    expect(r.session.proposal?.orders[0]?.serviceFeeCents).toBe(174);
    expect(r.actions).toMatchObject([{ type: 'budget_question', participantId: 'caio', totalCents: 1053 + 58 }]);
  });

  it('atualizarTaxasEOrcamento mantém a taxa anterior se a cotação falhar e avisa o grupo', async () => {
    const { catalog, revisao } = await cenarioPadaria();
    const comTaxa = apresentarProposta(revisao, comTaxas(revisao.proposal!, catalog, new Map([[LOJAS.padaria, 150]])));
    const port = Object.assign(Object.create(new CatalogoFake()) as CatalogoFake, {
      quoteOrder: async () => {
        throw new Error('timeout');
      },
    });
    const r = await atualizarTaxasEOrcamento(comTaxa, port, ENDERECO, catalog);
    expect(r.session.proposal?.orders[0]?.serviceFeeCents).toBe(150);
    expect(r.actions).toEqual([{ type: 'send_message', sessionId: 's1', text: TEXTOS_ORCAMENTO.taxaIndisponivel }]);
  });

  it('a taxa de serviço do fake fica entre o mínimo e o máximo', async () => {
    const fake = new CatalogoFake();
    expect((await fake.quoteOrder(LOJAS.padaria, [{ menuItemId: 'pad-cafe', quantity: 1 }], ENDERECO)).serviceFeeCents).toBe(99);
    expect((await fake.quoteOrder(LOJAS.padaria, [{ menuItemId: 'pad-misto', quantity: 100 }], ENDERECO)).serviceFeeCents).toBe(299);
    await expect(fake.quoteOrder('loja-inexistente', [], ENDERECO)).rejects.toThrow('loja não encontrada');
    await expect(fake.quoteOrder(LOJAS.padaria, [{ menuItemId: 'burger-x-salada', quantity: 1 }], ENDERECO)).rejects.toThrow();
  });
});

