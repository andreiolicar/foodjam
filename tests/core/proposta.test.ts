import { describe, expect, it } from 'vitest';
import type { Participant, ParticipantPreferences } from '../../src/core/contracts.js';
import { CatalogoFake, LOJAS } from '../../src/core/fakes/catalogo-fake.js';
import { FakeLlm, responderHeuristico } from '../../src/core/fakes/llm-fake.js';
import type { PropostaDeps } from '../../src/core/proposta.js';
import { compararPropostas, propor } from '../../src/core/proposta.js';
import { SISTEMA_PROPOSTA } from '../../src/core/prompts/proposta.js';
import type { ModelPick, ModelProposal } from '../../src/core/schemas.js';
import type { CoreSession } from '../../src/core/sessao.js';
import { TransicaoInvalidaError, cancelar, criarSessao } from '../../src/core/sessao.js';
import { AGORA } from './fixtures.js';

const pessoa = (id: string, preferences: ParticipantPreferences = {}): Participant => ({ id, displayName: id, preferences });
const sessao = (...participants: Participant[]): CoreSession =>
  criarSessao({ id: 's1', organizerId: participants[0]?.id ?? 'org', participants });

const LOJA_DO_ITEM: Record<string, string> = {
  'burger-x-salada': LOJAS.hamburgueria,
  'burger-x-bacon': LOJAS.hamburgueria,
  'burger-veggie': LOJAS.hamburgueria,
  'burger-refri': LOJAS.hamburgueria,
  'pad-misto': LOJAS.padaria,
  'pad-lanche-natural': LOJAS.padaria,
  'pad-bolo-cenoura': LOJAS.padaria,
  'pad-cafe': LOJAS.padaria,
  'doce-bolo-cenoura': LOJAS.doceria,
  'verde-wrap': LOJAS.vegetariano,
};

const pick = (participantId: string, menuItemId: string, extra: Partial<ModelPick> = {}): ModelPick => ({
  participantId,
  storeId: LOJA_DO_ITEM[menuItemId] ?? LOJAS.padaria,
  menuItemId,
  quantity: 1,
  ...extra,
});

const opcao = (...picks: ModelPick[]) => ({ picks, justification: 'Combina com todo mundo.' });
const saida = (...options: ReturnType<typeof opcao>[]): ModelProposal => ({ options });

function deps(llm: FakeLlm, extra: Partial<PropostaDeps> = {}): PropostaDeps {
  return { catalog: new CatalogoFake(), llm, now: AGORA, proposalId: 'p1', ...extra };
}

async function proporOk(session: CoreSession, llm: FakeLlm) {
  const result = await propor(session, deps(llm));
  if (!result.ok) throw new Error(`proposta falhou: ${result.reason} ${JSON.stringify(result.problems ?? [])}`);
  return result;
}

const itensDe = (result: Awaited<ReturnType<typeof proporOk>>) =>
  result.proposal.orders.flatMap((o) => o.items.map((i) => [i.participantId, i.menuItemId]));

describe('propor: lanche + bolo de cenoura', () => {
  it('em 2 lojas: hambúrguer na hamburgueria e bolo na padaria, entrega de cada loja só para quem pediu nela', async () => {
    const session = sessao(pessoa('pedro', { foodPreferences: ['hambúrguer'] }), pessoa('bia', { foodPreferences: ['bolo de cenoura'] }));
    const llm = new FakeLlm([saida(opcao(pick('pedro', 'burger-x-salada'), pick('bia', 'pad-bolo-cenoura')))]);
    const result = await proporOk(session, llm);

    expect(result.proposal.orders.map((o) => o.storeId)).toEqual([LOJAS.hamburgueria, LOJAS.padaria]);
    expect(result.proposal.split.shares).toEqual([
      { participantId: 'pedro', itemsCents: 2590, deliveryCents: 799, totalCents: 3389 },
      { participantId: 'bia', itemsCents: 890, deliveryCents: 490, totalCents: 1380 },
    ]);
    expect(result.proposal.uncoveredParticipantIds).toEqual([]);
    expect(result.session.status).toBe('reviewing');
    expect(result.session.proposal).toBe(result.proposal);
  });

  it('opção com o bolo da doceria esbarra no pedido mínimo; vence a opção só na padaria', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }), pessoa('bia', { foodPreferences: ['bolo de cenoura'] }));
    const llm = new FakeLlm([
      saida(
        opcao(pick('ana', 'pad-misto'), pick('bia', 'doce-bolo-cenoura')),
        opcao(pick('ana', 'pad-misto'), pick('bia', 'pad-bolo-cenoura')),
      ),
    ]);
    const result = await proporOk(session, llm);
    expect(result.proposal.orders.map((o) => o.storeId)).toEqual([LOJAS.padaria]);
    expect(itensDe(result)).toEqual([
      ['ana', 'pad-misto'],
      ['bia', 'pad-bolo-cenoura'],
    ]);
  });

  it('com todas as opções inválidas, não propõe e devolve os problemas', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }), pessoa('bia', { foodPreferences: ['bolo'] }));
    const llm = new FakeLlm([saida(opcao(pick('ana', 'pad-misto'), pick('bia', 'doce-bolo-cenoura')))]);
    const result = await propor(session, deps(llm));
    expect(result).toMatchObject({ ok: false, reason: 'no_valid_option', problems: [{ code: 'below_minimum', storeId: LOJAS.doceria }] });
  });
});

describe('propor: guardrails sobre a saída do modelo', () => {
  it('item inventado é descartado e a pessoa fica sem item', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }), pessoa('bia', { foodPreferences: ['pizza'] }));
    const llm = new FakeLlm([saida(opcao(pick('ana', 'pad-misto'), pick('bia', 'pad-pizza-fantasma')))]);
    const result = await proporOk(session, llm);

    expect(itensDe(result)).toEqual([['ana', 'pad-misto']]);
    expect(result.proposal.uncoveredParticipantIds).toEqual(['bia']);
    expect(result.discarded).toEqual([{ participantId: 'bia', menuItemId: 'pad-pizza-fantasma', reason: 'item_not_in_catalog' }]);
  });

  it('preço vindo do modelo reprova a saída; na nova tentativa o preço sai do catálogo', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }));
    const comPreco = { options: [{ picks: [{ ...pick('ana', 'pad-misto'), unitPriceCents: 1 }], justification: 'barato' }] };
    const llm = new FakeLlm([comPreco, saida(opcao(pick('ana', 'pad-misto')))]);
    const result = await proporOk(session, llm);

    expect(llm.requests).toHaveLength(2);
    expect(result.proposal.orders[0]?.items[0]?.unitPriceCents).toBe(1190);
  });

  it('orçamento estourado: item mais caro que o limite nem é permitido; vence a opção que cabe', async () => {
    const session = sessao(
      pessoa('ana', { foodPreferences: ['lanche'] }),
      pessoa('caio', { foodPreferences: ['lanche'], budgetCents: 1000 }),
    );
    const llm = new FakeLlm([
      saida(
        // Lanche Natural (R$ 13,90) passa do limite sozinho → não elegível; opção cobre só a Ana.
        opcao(pick('ana', 'pad-misto'), pick('caio', 'pad-lanche-natural')),
        // Café (R$ 6,90) + metade da entrega (R$ 2,45) = R$ 9,35 ≤ R$ 10.
        opcao(pick('ana', 'pad-misto'), pick('caio', 'pad-cafe')),
      ),
    ]);
    const result = await proporOk(session, llm);

    expect(itensDe(result)).toEqual([
      ['ana', 'pad-misto'],
      ['caio', 'pad-cafe'],
    ]);
    expect(result.proposal.split.shares[1]).toEqual({ participantId: 'caio', itemsCents: 690, deliveryCents: 245, totalCents: 935 });

    const permitidosCaio = JSON.parse(/<participantes>(.*)<\/participantes>/.exec(llm.requests[0]?.prompt ?? '')?.[1] ?? '[]')
      .find((p: { id: string }) => p.id === 'caio').itensPermitidos as string[];
    expect(permitidosCaio).not.toContain('pad-lanche-natural');
  });

  it('orçamento estourado só pela entrega: a pessoa sai e o rateio é refeito', async () => {
    const session = sessao(
      pessoa('ana', { foodPreferences: ['lanche'] }),
      pessoa('caio', { foodPreferences: ['lanche'], budgetCents: 1500 }),
    );
    const llm = new FakeLlm([saida(opcao(pick('ana', 'pad-misto'), pick('caio', 'pad-lanche-natural')))]);
    const result = await proporOk(session, llm);

    expect(result.discarded).toEqual([{ participantId: 'caio', menuItemId: 'pad-lanche-natural', reason: 'over_budget' }]);
    expect(result.proposal.split.shares).toEqual([{ participantId: 'ana', itemsCents: 1190, deliveryCents: 490, totalCents: 1680 }]);
  });

  it('orçamento nunca entra no prompt', async () => {
    const session = sessao(pessoa('caio', { foodPreferences: ['lanche'], budgetCents: 1234 }));
    const llm = new FakeLlm([saida(opcao(pick('caio', 'pad-misto')))]);
    await propor(session, deps(llm));
    expect(llm.requests[0]?.prompt).not.toMatch(/1234|budget|orcamento|orçamento/i);
  });

  it('restrição violada: X-Salada (bovino) para vegetariano é descartado', async () => {
    const session = sessao(
      pessoa('ana', { foodPreferences: ['hambúrguer'] }),
      pessoa('bia', { foodPreferences: ['hambúrguer'], dietaryRestrictions: ['vegetariano'] }),
    );
    const llm = new FakeLlm([saida(opcao(pick('ana', 'burger-x-salada'), pick('bia', 'burger-x-salada')))]);
    const result = await proporOk(session, llm);

    expect(result.discarded).toEqual([{ participantId: 'bia', menuItemId: 'burger-x-salada', reason: 'not_eligible' }]);
    expect(result.proposal.uncoveredParticipantIds).toEqual(['bia']);

    const permitidosBia = JSON.parse(/<participantes>(.*)<\/participantes>/.exec(llm.requests[0]?.prompt ?? '')?.[1] ?? '[]')
      .find((p: { id: string }) => p.id === 'bia').itensPermitidos as string[];
    expect(permitidosBia).toContain('burger-veggie');
    expect(permitidosBia).not.toContain('burger-x-salada');
  });

  it('avoids respeitado: quem evita hambúrguer não recebe nada da hamburgueria', async () => {
    const session = sessao(
      pessoa('ana', { foodPreferences: ['hambúrguer'] }),
      pessoa('bia', { foodPreferences: ['bolo'], avoids: ['hambúrguer'] }),
    );
    const llm = new FakeLlm([
      saida(
        opcao(pick('ana', 'burger-x-salada'), pick('bia', 'burger-veggie')),
        opcao(pick('ana', 'burger-x-salada'), pick('bia', 'pad-bolo-cenoura')),
      ),
    ]);
    const result = await proporOk(session, llm);
    expect(itensDe(result)).toEqual([
      ['ana', 'burger-x-salada'],
      ['bia', 'pad-bolo-cenoura'],
    ]);

    const prompt = llm.requests[0]?.prompt ?? '';
    const bia = JSON.parse(/<participantes>(.*)<\/participantes>/.exec(prompt)?.[1] ?? '[]').find((p: { id: string }) => p.id === 'bia');
    expect((bia.itensPermitidos as string[]).some((id) => id.startsWith('burger-'))).toBe(false);
  });

  it('escolha repetida para a mesma pessoa: vale a primeira', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }));
    const llm = new FakeLlm([saida(opcao(pick('ana', 'pad-misto'), pick('ana', 'pad-cafe')))]);
    const result = await proporOk(session, llm);
    expect(itensDe(result)).toEqual([['ana', 'pad-misto']]);
    expect(result.discarded).toEqual([{ participantId: 'ana', menuItemId: 'pad-cafe', reason: 'duplicate_pick' }]);
  });

  it('participante fora da sessão é descartado', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }));
    const llm = new FakeLlm([saida(opcao(pick('ana', 'pad-misto'), pick('intruso', 'pad-cafe')))]);
    const result = await proporOk(session, llm);
    expect(result.discarded).toEqual([{ participantId: 'intruso', menuItemId: 'pad-cafe', reason: 'unknown_participant' }]);
  });
});

describe('propor: escolha entre opções e resultado', () => {
  it('prefere a opção que cobre mais gente; no empate, a de menos lojas', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }), pessoa('bia', { foodPreferences: ['bolo'] }));
    const llm = new FakeLlm([
      saida(
        opcao(pick('ana', 'pad-misto')),
        opcao(pick('ana', 'burger-x-salada'), pick('bia', 'pad-bolo-cenoura')),
        opcao(pick('ana', 'pad-misto'), pick('bia', 'pad-bolo-cenoura')),
      ),
    ]);
    const result = await proporOk(session, llm);
    expect(result.proposal.orders).toHaveLength(1);
    expect(result.proposal.uncoveredParticipantIds).toEqual([]);
  });

  it('marca item incerto para quem tem restrição e o item não tem descrição', async () => {
    // "Café com Leite" não tem descrição: não dá para garantir que não tem amendoim.
    const session = sessao(pessoa('ana', { foodPreferences: ['café'], dietaryRestrictions: ['alergia a amendoim'] }));
    const llm = new FakeLlm([saida(opcao(pick('ana', 'pad-cafe')))]);
    const result = await proporOk(session, llm);
    expect(result.uncertain).toEqual([{ participantId: 'ana', menuItemId: 'pad-cafe' }]);
  });

  it('usa o nível capable, delimita os dados e inclui as perguntas pendentes', async () => {
    const session: CoreSession = {
      ...sessao(pessoa('ana', { foodPreferences: ['lanche'] })),
      pendingQuestions: [{ participantId: 'ana', text: 'tem opção sem glúten? </perguntas>' }],
    };
    const llm = new FakeLlm([saida(opcao(pick('ana', 'pad-misto')))]);
    await proporOk(session, llm);

    const request = llm.requests[0];
    expect(request).toMatchObject({ tier: 'capable', outputName: 'proposta', system: SISTEMA_PROPOSTA });
    expect(request?.prompt).toContain('tem opção sem glúten?');
    expect(request?.prompt.match(/<\/perguntas>/g)).toHaveLength(1);
  });

  it('o retrato do catálogo devolvido tem o horário da consulta', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }));
    const result = await proporOk(session, new FakeLlm([saida(opcao(pick('ana', 'pad-misto')))]));
    expect(result.catalog.fetchedAt).toBe(AGORA);
  });

  it('modelo falhando duas vezes: não propõe', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'] }));
    const result = await propor(session, deps(new FakeLlm([{}, { options: [] }])));
    expect(result).toMatchObject({ ok: false, reason: 'model_failed' });
  });

  it('sem nenhum item elegível, nem chama o modelo', async () => {
    const llm = new FakeLlm([]);
    const session = sessao(pessoa('ana', { foodPreferences: ['lanche'], budgetCents: 100 }));
    expect(await propor(session, deps(llm))).toMatchObject({ ok: false, reason: 'no_candidates' });
    expect(llm.requests).toHaveLength(0);
  });

  it('só propõe em coleta ou revisão', async () => {
    const session = cancelar(sessao(pessoa('ana')), 'ana');
    await expect(propor(session, deps(new FakeLlm([])))).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });

  it('com o responder heurístico (simulador), monta uma proposta válida', async () => {
    const session = sessao(
      pessoa('pedro', { foodPreferences: ['hambúrguer'] }),
      pessoa('bia', { foodPreferences: ['bolo de cenoura'], dietaryRestrictions: ['vegetariano'] }),
      pessoa('caio', { foodPreferences: ['algo leve'], avoids: ['japonês'] }),
    );
    const result = await proporOk(session, new FakeLlm(responderHeuristico));
    expect(result.proposal.orders.length).toBeLessThanOrEqual(2);
    expect(result.proposal.uncoveredParticipantIds).toEqual([]);
  });
});

describe('propor: preços, pedido mínimo e critério de escolha', () => {
  it('o prompt traz preço dos itens e pedido mínimo das lojas, mas nunca orçamento', async () => {
    const session = sessao(
      pessoa('ana', { foodPreferences: ['hambúrguer'], budgetCents: 4321 }),
      pessoa('bia', { foodPreferences: ['bolo de cenoura'] }),
    );
    const llm = new FakeLlm([saida(opcao(pick('ana', 'burger-x-salada'), pick('bia', 'pad-bolo-cenoura')))]);
    await proporOk(session, llm);

    const prompt = (llm.requests[0]?.prompt ?? '').replaceAll('&quot;', '"');
    const catalogo = JSON.parse(/<catalogo>(.*)<\/catalogo>/.exec(prompt)?.[1] ?? '[]') as {
      storeId: string;
      pedidoMinimo: string | null;
      itens: { id: string; preco: string }[];
    }[];
    const burger = catalogo.find((l) => l.storeId === LOJAS.hamburgueria);
    expect(burger?.pedidoMinimo).toBe('R$ 20,00');
    expect(burger?.itens.find((i) => i.id === 'burger-x-salada')?.preco).toBe('R$ 25,90');
    expect(catalogo.find((l) => l.storeId === LOJAS.padaria)?.pedidoMinimo).toBeNull();
    expect(prompt).not.toMatch(/4321|43,21|budget|orçamento/i);
  });

  it('o sistema pede comida (não só bebida) para quem pede comida', () => {
    expect(SISTEMA_PROPOSTA).toMatch(/recebe comida, não só bebida/);
  });

  it('critério: mais gente com o que pediu > menos substitutos > menos lojas > menor total', async () => {
    const session = sessao(pessoa('ana', { foodPreferences: ['hambúrguer'] }), pessoa('bia', { foodPreferences: ['bolo de cenoura'] }));
    const llm = new FakeLlm([
      saida(
        // 1 loja, mas a Ana recebe substituto.
        opcao(pick('ana', 'pad-misto', { isSubstitute: true }), pick('bia', 'pad-bolo-cenoura')),
        // 2 lojas, as duas com o que pediram: deve vencer.
        opcao(pick('ana', 'burger-x-salada'), pick('bia', 'pad-bolo-cenoura')),
      ),
    ]);
    const result = await proporOk(session, llm);
    expect(itensDe(result)).toEqual([
      ['ana', 'burger-x-salada'],
      ['bia', 'pad-bolo-cenoura'],
    ]);
  });

  it('empate em quem recebe o que pediu: menos substitutos vence; depois menos lojas', () => {
    /** Itens como [loja, substituto?]; um por pessoa, agrupados em pedidos por loja. */
    const p = (itens: [string, boolean][], total = 1000) => {
      const lojas = [...new Set(itens.map(([loja]) => loja))];
      return {
        proposal: {
          orders: lojas.map((storeId) => ({
            storeId,
            items: itens
              .map(([loja, sub], i) => ({ loja, participantId: `p${i}`, isSubstitute: sub }))
              .filter((it) => it.loja === storeId),
          })),
          split: { totalCents: total },
        },
      } as never;
    };

    // Mais gente com o que pediu vence, mesmo com mais lojas.
    expect(compararPropostas(p([['a', false], ['b', false]]), p([['a', false], ['a', true]]))).toBeLessThan(0);
    // Mesmo número com o que pediu: menos substitutos vence.
    expect(compararPropostas(p([['a', false], ['b', false]]), p([['a', false], ['b', false], ['a', true]]))).toBeLessThan(0);
    // Mesmo número de substitutos: menos lojas vence.
    expect(compararPropostas(p([['a', false], ['a', true]]), p([['a', false], ['b', true]]))).toBeLessThan(0);
    // Empate em tudo: menor total vence.
    expect(compararPropostas(p([['a', false]], 900), p([['a', false]], 1000))).toBeLessThan(0);
  });
});
