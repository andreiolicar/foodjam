import { describe, expect, it } from 'vitest';

import {
  CatalogoFake,
  ENDERECO_FAKE,
  FakeLlm,
  TEXTOS_ENDERECO,
  criarAgente,
  responderHeuristico,
  type AuthorizedOrder,
} from '../../src/core/index.js';
import { textoAvisoPrivado } from '../../src/telegram/services/apresentacao.js';
import { GRUPO, criarHarness, type Pessoa } from './harness.js';

const ANA: Pessoa = { id: 1, first_name: 'Ana' };
const BIA: Pessoa = { id: 2, first_name: 'Bia' };
const CAIO: Pessoa = { id: 3, first_name: 'Caio' };
const SESSAO = String(GRUPO);

function bot(opcoes: { semPrivado?: number[]; enderecoPadrao?: string } = {}) {
  const iris = criarAgente({
    catalog: new CatalogoFake(),
    llm: new FakeLlm(responderHeuristico),
    ...(opcoes.enderecoPadrao && { enderecoPadrao: opcoes.enderecoPadrao }),
  });
  const executados: AuthorizedOrder[] = [];
  const h = criarHarness(iris, {
    ...(opcoes.semPrivado && { semPrivado: opcoes.semPrivado }),
    aoAutorizar: (order) => void executados.push(order),
  });
  return { iris, h, executados };
}

const ultima = (h: ReturnType<typeof criarHarness>, chatId: number) => h.enviadas(chatId).at(-1);
const cardAtual = (h: ReturnType<typeof criarHarness>) => h.enviadas(GRUPO).findLast((m) => m.text.includes('Sugestão da Íris'));

describe('fluxo completo pelo bot', () => {
  it('menção → endereço no privado → coleta → proposta → outra opção → ajuste → confirmar → clique repetido', async () => {
    const { iris, h, executados } = bot();

    // 1. Ana menciona o bot: vira organizadora e o resto da mensagem já entra na coleta.
    await h.texto(ANA, '@iris_bot bora de hambúrguer');
    expect(ultima(h, GRUPO)?.text).toMatch(/Pedido iniciado por Ana/);
    expect(ultima(h, ANA.id)?.text).toBe(TEXTOS_ENDERECO.pedir);
    expect((await iris.obter(SESSAO))?.organizerId).toBe(String(ANA.id));

    // 2. Endereço digitado no privado vai para a sessão do grupo; ela confirma.
    await h.texto(ANA, ENDERECO_FAKE, ANA.id);
    expect(ultima(h, ANA.id)?.botoes.map((b) => b.text)).toEqual(['Confirmar', 'Corrigir']);
    await h.clicarBotao(ANA, ANA.id, 'Confirmar');
    expect((await iris.obter(SESSAO))?.address?.status).toBe('confirmed');

    // 3. O grupo fala (a mensagem da menção já contou); /montar esvazia o lote e propõe.
    await h.texto(CAIO, 'algo leve, sou vegetariano');
    await h.texto(BIA, 'quero um lanche e um bolo de cenoura');
    await h.texto(ANA, '/montar');
    const primeiro = cardAtual(h);
    expect(primeiro?.text).toContain('Caio');
    expect(primeiro?.botoes.map((b) => b.text)).toContain('🔄 Outra opção');

    // 4. Outra opção troca na hora; o card anterior perde os botões.
    await h.clicarBotao(ANA, GRUPO, '🔄 Outra opção');
    const segundo = cardAtual(h);
    expect(segundo?.messageId).not.toBe(primeiro?.messageId);
    expect(h.chamadasDe('editMessageReplyMarkup').some((c) => c.payload.message_id === primeiro?.messageId)).toBe(true);

    // 5. Ajuste por texto no grupo. A Bia tem dois itens: o core pergunta qual, no privado, sem card novo.
    await h.texto(BIA, 'troca o meu por um café');
    await h.agrupador.esvaziar(SESSAO);
    expect(ultima(h, BIA.id)?.text).toMatch(/Qual item você quer trocar/);
    expect(cardAtual(h)?.messageId).toBe(segundo?.messageId);

    // A Ana tem um item só: proposta nova, sem "Outra opção".
    await h.texto(ANA, 'troca o meu por um café');
    await h.agrupador.esvaziar(SESSAO);
    const ajustado = cardAtual(h);
    expect(ajustado?.messageId).not.toBe(segundo?.messageId);
    expect(ajustado?.botoes.map((b) => b.text)).not.toContain('🔄 Outra opção');

    // 6. Confirmar fecha e entrega o pedido ao executor; o clique repetido não executa de novo.
    const confirmar = ajustado?.botoes.find((b) => b.text === '✅ Confirmar pedido')?.callback_data ?? '';
    await h.clicar(ANA, confirmar, { chatId: GRUPO, messageId: ajustado?.messageId ?? 0 });
    expect(ultima(h, GRUPO)?.text).toContain('Pedido confirmado!');
    await h.clicar(ANA, confirmar, { chatId: GRUPO, messageId: ajustado?.messageId ?? 0 });
    expect(ultima(h, GRUPO)?.text).toContain('já estava confirmado');
    expect(executados).toHaveLength(1);

    // 7. Um pedido novo pode começar no mesmo grupo, com outra chave.
    await h.texto(BIA, '/iniciar');
    expect(ultima(h, GRUPO)?.text).toMatch(/Pedido iniciado por Bia/);
  });
});

describe('início', () => {
  it('menção com pedido ativo não abre outro: vira mensagem da coleta', async () => {
    const { iris, h } = bot();
    await h.texto(ANA, '/iniciar');
    const antes = h.enviadas(GRUPO).length;

    await h.texto(BIA, '@iris_bot quero pizza');
    await h.agrupador.esvaziar(SESSAO);

    expect(h.enviadas(GRUPO).length).toBe(antes);
    expect((await iris.obter(SESSAO))?.organizerId).toBe(String(ANA.id));
    expect((await iris.obter(SESSAO))?.participants.map((p) => p.displayName)).toContain('Bia');
  });

  it('/iniciar com pedido ativo avisa que já existe', async () => {
    const { h } = bot();
    await h.texto(ANA, '/iniciar');
    await h.texto(BIA, '/iniciar');
    expect(ultima(h, GRUPO)?.text).toMatch(/Já existe um pedido em andamento/);
  });

  it('/iniciar no privado explica que é no grupo', async () => {
    const { h } = bot();
    await h.texto(ANA, '/iniciar', ANA.id);
    expect(ultima(h, ANA.id)?.text).toMatch(/Me adicione a um grupo/);
  });

  it('mensagens sem pedido ativo não vão para o core', async () => {
    const { iris, h } = bot();
    await h.texto(BIA, 'quero um lanche');
    expect(h.agrupador.pendentes(SESSAO)).toBe(0);
    expect(await iris.obter(SESSAO)).toBeUndefined();
  });
});

describe('endereço no privado', () => {
  it('endereço inválido: o motivo vai no privado e dá para digitar de novo', async () => {
    const { h } = bot();
    await h.texto(ANA, '/iniciar');

    await h.texto(ANA, 'Rua sem número', ANA.id);
    expect(ultima(h, ANA.id)?.text).toBe(`${TEXTOS_ENDERECO.erros.incomplete} ${TEXTOS_ENDERECO.tenteDeNovo}`);

    await h.texto(ANA, ENDERECO_FAKE, ANA.id);
    expect(ultima(h, ANA.id)?.botoes.map((b) => b.text)).toEqual(['Confirmar', 'Corrigir']);
  });

  it('[Corrigir] pede o endereço de novo', async () => {
    const { h } = bot();
    await h.texto(ANA, '/iniciar');
    await h.texto(ANA, ENDERECO_FAKE, ANA.id);

    await h.clicarBotao(ANA, ANA.id, 'Corrigir');
    expect(ultima(h, ANA.id)?.text).toBe(TEXTOS_ENDERECO.pedir);
  });

  it('endereço padrão: [Sim] confirma sem digitar', async () => {
    const { iris, h } = bot({ enderecoPadrao: ENDERECO_FAKE });
    await h.texto(ANA, '/iniciar');
    expect(ultima(h, ANA.id)?.botoes.map((b) => b.text)).toEqual(['Sim', 'Outro endereço']);

    await h.clicarBotao(ANA, ANA.id, 'Sim');
    expect((await iris.obter(SESSAO))?.address?.status).toBe('confirmed');
  });

  it('texto no privado de quem não está sendo esperado não vira endereço nem coleta', async () => {
    const { iris, h } = bot();
    await h.texto(ANA, '/iniciar');

    await h.texto(BIA, 'quero um lanche', BIA.id);
    expect(ultima(h, BIA.id)?.text).toMatch(/só recebo o endereço/);
    expect((await iris.obter(SESSAO))?.participants.map((p) => p.id)).not.toContain(String(BIA.id));
  });

  it('/montar sem endereço confirmado: lembrete no privado e dica no grupo', async () => {
    const { h } = bot();
    await h.texto(ANA, '/iniciar');
    await h.texto(ANA, 'quero um lanche');

    await h.texto(ANA, '/montar');
    expect(ultima(h, GRUPO)?.text).toMatch(/precisa confirmar o endereço/);
    expect(h.enviadas(ANA.id).some((m) => m.text === TEXTOS_ENDERECO.exigido)).toBe(true);
  });
});

describe('privado bloqueado', () => {
  it('quem nunca falou com o bot: aviso no grupo sem conteúdo; /start entrega a mensagem guardada', async () => {
    const { h } = bot({ semPrivado: [ANA.id] });

    await h.texto(ANA, '/iniciar');
    const aviso = ultima(h, GRUPO);
    expect(aviso?.text).toBe(textoAvisoPrivado('Ana'));
    expect(aviso?.botoes[0]?.url).toBe('https://t.me/iris_bot?start=pendentes');
    expect(h.enviadas(GRUPO).some((m) => m.text === TEXTOS_ENDERECO.pedir)).toBe(false);

    // Ela abre a conversa: a API passa a aceitar e o /start entrega o pedido de endereço.
    h.liberarPrivado();
    await h.texto(ANA, '/start', ANA.id);
    expect(ultima(h, ANA.id)?.text).toBe(TEXTOS_ENDERECO.pedir);
  });
});

describe('comandos fora de hora', () => {
  it('/montar e /cancelar sem pedido avisam no grupo', async () => {
    const { h } = bot();
    await h.texto(ANA, '/montar');
    expect(ultima(h, GRUPO)?.text).toMatch(/Não existe pedido ativo/);
    await h.texto(ANA, '/cancelar');
    expect(ultima(h, GRUPO)?.text).toBe('Não há pedido em andamento.');
  });

  it('/cancelar de quem não organizou não cancela; da organizadora cancela', async () => {
    const { iris, h } = bot();
    await h.texto(ANA, '/iniciar');

    await h.texto(BIA, '/cancelar');
    expect((await iris.obter(SESSAO))?.status).toBe('collecting');

    await h.texto(ANA, '/cancelar');
    expect((await iris.obter(SESSAO))?.status).toBe('cancelled');
    expect(ultima(h, GRUPO)?.text).toMatch(/Pedido cancelado/);
  });
});

