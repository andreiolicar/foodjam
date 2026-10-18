import { describe, expect, it } from 'vitest';

import {
  CatalogoFake,
  ENDERECO_FAKE,
  FakeLlm,
  TEXTOS_ORCAMENTO,
  criarAgente,
  responderHeuristico,
  type AuthorizedOrder,
  type CatalogPort,
} from '../../src/core/index.js';
import { TEXTO_CATALOGO_MUDOU } from '../../src/telegram/handlers/proposta.js';
import { GRUPO, criarHarness, type Pessoa } from './harness.js';

const ANA: Pessoa = { id: 1, first_name: 'Ana' };
const BIA: Pessoa = { id: 2, first_name: 'Bia' };

/** Catálogo fake com dois interruptores: lojas fechadas e acréscimo na taxa de serviço. */
function catalogoControlado() {
  const fake = new CatalogoFake();
  const estado = { lojasFechadas: false, acrescimoTaxa: 0 };
  const catalog: CatalogPort = {
    validateAddress: (t) => fake.validateAddress(t),
    searchStores: async (q, a) => (await fake.searchStores(q, a)).map((s) => ({ ...s, isOpen: s.isOpen && !estado.lojasFechadas })),
    getMenu: (id, a) => fake.getMenu(id, a),
    quoteOrder: async (id, itens, a) => {
      const { serviceFeeCents } = await fake.quoteOrder(id, itens, a);
      return { serviceFeeCents: serviceFeeCents + estado.acrescimoTaxa };
    },
  };
  return { catalog, estado };
}

/** Ana organiza; Ana quer lanche e Bia bolo (sem orçamento): proposta pronta para confirmar. */
async function comProposta(opcoes: { bolo?: string } = {}) {
  const { catalog, estado } = catalogoControlado();
  const iris = criarAgente({ catalog, llm: new FakeLlm(responderHeuristico), enderecoPadrao: ENDERECO_FAKE });
  const executados: AuthorizedOrder[] = [];
  const h = criarHarness(iris, { aoAutorizar: (order) => void executados.push(order) });

  await h.texto(ANA, '/iniciar');
  await h.clicarBotao(ANA, ANA.id, 'Sim');
  await h.texto(ANA, 'quero um lanche');
  await h.texto(BIA, opcoes.bolo ?? 'bolo de cenoura');
  await h.texto(ANA, '/montar');
  return { iris, h, estado, executados };
}

const ultimaDoGrupo = (h: ReturnType<typeof criarHarness>) => h.enviadas(GRUPO).at(-1)?.text ?? '';

describe('fechamento pelo bot', () => {
  it('confirmar: resumo com endereço e chave do pedido, card sem botões e executor chamado uma vez', async () => {
    const { iris, h, executados } = await comProposta();
    const card = h.enviadas(GRUPO).findLast((m) => m.text.includes('Sugestão da Íris'));

    await h.clicarBotao(ANA, GRUPO, '✅ Confirmar pedido');

    const resumo = ultimaDoGrupo(h);
    expect(resumo).toContain('✅ <b>Pedido confirmado!</b>');
    expect(resumo).toContain('📍 Entrega em:');
    expect(resumo).toContain('Autorizado por Ana');
    expect(h.chamadasDe('editMessageReplyMarkup').some((c) => c.payload.message_id === card?.messageId)).toBe(true);

    expect(executados).toHaveLength(1);
    expect(resumo).toContain(executados[0]?.proposalId);
    const nomes = await iris.nomes(String(GRUPO));
    expect(resumo).toContain(nomes?.lojas[executados[0]?.orders[0]?.storeId ?? '']);
  });

  it('clique repetido em Confirmar: mesmo resumo, sem executar de novo', async () => {
    const { h, executados } = await comProposta();
    const card = h.enviadas(GRUPO).findLast((m) => m.text.includes('Sugestão da Íris'));
    const confirmar = card?.botoes.find((b) => b.text === '✅ Confirmar pedido')?.callback_data ?? '';

    await h.clicar(ANA, confirmar, { chatId: GRUPO, messageId: card?.messageId ?? 0 });
    await h.clicar(ANA, confirmar, { chatId: GRUPO, messageId: card?.messageId ?? 0 });

    expect(ultimaDoGrupo(h)).toContain('Este pedido já estava confirmado');
    expect(executados).toHaveLength(1);
  });

  it('quem não organizou recebe aviso no próprio botão e o pedido não fecha', async () => {
    const { iris, h, executados } = await comProposta();

    await h.clicarBotao(BIA, GRUPO, '✅ Confirmar pedido');

    const aviso = h.chamadasDe('answerCallbackQuery').at(-1);
    expect(aviso?.payload.show_alert).toBe(true);
    expect(executados).toHaveLength(0);
    expect((await iris.obter(String(GRUPO)))?.status).toBe('reviewing');
  });

  it('orçamento pendente: confirmar bloqueia e "Voltar para a coleta" continua funcionando', async () => {
    const { h, executados } = await comProposta({ bolo: 'bolo de cenoura, até 10 reais' });

    await h.clicarBotao(ANA, GRUPO, '✅ Confirmar pedido');
    expect(ultimaDoGrupo(h)).toBe(TEXTOS_ORCAMENTO.aguardando(['Bia']));

    await h.clicarBotao(ANA, GRUPO, '↩️ Voltar para a coleta');
    expect(ultimaDoGrupo(h)).toMatch(/Coleta reaberta/);
    expect(executados).toHaveLength(0);
  });

  it('catálogo mudou (lojas fecharam): avisa o grupo e dá para montar de novo depois', async () => {
    const { h, estado, executados } = await comProposta();

    estado.lojasFechadas = true;
    await h.clicarBotao(ANA, GRUPO, '✅ Confirmar pedido');
    expect(ultimaDoGrupo(h)).toBe(TEXTO_CATALOGO_MUDOU);
    expect(executados).toHaveLength(0);

    estado.lojasFechadas = false;
    await h.texto(ANA, '/montar');
    expect(ultimaDoGrupo(h)).toContain('Sugestão da Íris');
  });

  it('taxa de serviço mudou: a proposta atualizada volta para o grupo e fecha na segunda vez', async () => {
    const { h, estado, executados } = await comProposta();

    estado.acrescimoTaxa = 50;
    await h.clicarBotao(ANA, GRUPO, '✅ Confirmar pedido');
    expect(h.enviadas(GRUPO).findLast((m) => m.text.includes('Sugestão da Íris'))?.botoes.length).toBeGreaterThan(0);
    expect(executados).toHaveLength(0);

    await h.clicarBotao(ANA, GRUPO, '✅ Confirmar pedido');
    expect(ultimaDoGrupo(h)).toContain('Pedido confirmado!');
    expect(executados).toHaveLength(1);
  });
});
