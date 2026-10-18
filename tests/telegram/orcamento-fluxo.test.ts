import { describe, expect, it } from 'vitest';

import { CatalogoFake, ENDERECO_FAKE, FakeLlm, TEXTOS_ORCAMENTO, criarAgente } from '../../src/core/index.js';
import { responderHeuristico } from '../../src/core/index.js';
import { TEXTO_VALORES_CONFIRMADOS } from '../../src/telegram/handlers/conversa-privada.js';
import { GRUPO, criarHarness, type Pessoa } from './harness.js';

const ANA: Pessoa = { id: 1, first_name: 'Ana' };
const BIA: Pessoa = { id: 2, first_name: 'Bia' };

/**
 * Ana organiza e confirma o endereço padrão; Ana quer lanche e Bia quer bolo
 * "até 10 reais" (cabe sozinho, mas com entrega e taxa passa): a proposta sai
 * com pergunta de valor para a Bia no privado.
 */
async function biaAcimaDoOrcamento() {
  const iris = criarAgente({ catalog: new CatalogoFake(), llm: new FakeLlm(responderHeuristico), enderecoPadrao: ENDERECO_FAKE });
  const h = criarHarness(iris);

  await h.texto(ANA, '/iniciar');
  await h.clicarBotao(ANA, ANA.id, 'Sim');
  await h.texto(ANA, 'quero um lanche');
  await h.texto(BIA, 'bolo de cenoura, até 10 reais');
  await h.texto(ANA, '/montar');

  return { iris, h };
}

const card = (h: ReturnType<typeof criarHarness>) => h.enviadas(GRUPO).findLast((m) => m.text.includes('Sugestão da Íris'));

describe('orçamento no privado, pelo bot', () => {
  it('a proposta vai para o grupo sem valores de orçamento e a pergunta vai para o privado da Bia', async () => {
    const { h } = await biaAcimaDoOrcamento();

    expect(card(h)?.text).toContain('⏳ Aguardando confirmação de valor no privado: Bia');

    const pergunta = h.enviadas(BIA.id).at(-1);
    expect(pergunta?.text).toMatch(/acima do seu orçamento/);
    expect(pergunta?.botoes.map((b) => b.text)).toEqual(['Aceito', 'Quero outro']);

    // Nenhuma mensagem do grupo repete o texto da pergunta (que tem o valor).
    expect(h.enviadas(GRUPO).some((m) => m.text === pergunta?.text)).toBe(false);
  });

  it('confirmar antes da resposta fica bloqueado e o grupo vê só o nome', async () => {
    const { h } = await biaAcimaDoOrcamento();

    await h.clicarBotao(ANA, GRUPO, '✅ Confirmar pedido');

    expect(h.enviadas(GRUPO).at(-1)?.text).toBe(TEXTOS_ORCAMENTO.aguardando(['Bia']));
    // O card continua com os botões (nenhuma edição tirou o teclado dele).
    const idCard = card(h)?.messageId;
    expect(h.chamadasDe('editMessageReplyMarkup').some((c) => c.payload.message_id === idCard)).toBe(false);
  });

  it('[Aceito]: o card é atualizado no lugar, o grupo é avisado e o pedido fecha', async () => {
    const { h } = await biaAcimaDoOrcamento();
    const idCard = card(h)?.messageId;

    await h.clicarBotao(BIA, BIA.id, 'Aceito');

    expect(h.enviadas(BIA.id).at(-1)?.text).toBe(TEXTOS_ORCAMENTO.aceito);
    const edicao = h.chamadasDe('editMessageText').at(-1);
    expect(edicao?.payload.message_id).toBe(idCard);
    expect(String(edicao?.payload.text)).not.toContain('Aguardando');
    expect(h.enviadas(GRUPO).at(-1)?.text).toBe(TEXTO_VALORES_CONFIRMADOS);

    await h.clicarBotao(ANA, GRUPO, '✅ Confirmar pedido');
    expect(h.enviadas(GRUPO).at(-1)?.text).toMatch(/Pedido confirmado/);
  });

  it('[Quero outro] → sugestão com botões; a pergunta anterior perde os botões', async () => {
    const { h } = await biaAcimaDoOrcamento();
    const idPergunta = h.enviadas(BIA.id).at(-1)?.messageId;

    await h.clicarBotao(BIA, BIA.id, 'Quero outro');

    expect(h.chamadasDe('editMessageReplyMarkup').some((c) => c.payload.message_id === idPergunta)).toBe(true);
    const sugestao = h.enviadas(BIA.id).at(-1);
    expect(sugestao?.botoes.map((b) => b.text)).toContain('Fico sem');
  });

  it('[Fico sem]: a Bia sai do pedido, o card novo vai para o grupo e o antigo perde os botões', async () => {
    const { h } = await biaAcimaDoOrcamento();
    const idCardAntigo = card(h)?.messageId;

    await h.clicarBotao(BIA, BIA.id, 'Quero outro');
    await h.clicarBotao(BIA, BIA.id, 'Fico sem');

    expect(h.enviadas(BIA.id).at(-1)?.text).toBe(TEXTOS_ORCAMENTO.semItem);
    const novo = card(h);
    expect(novo?.messageId).not.toBe(idCardAntigo);
    expect(novo?.text).toContain('🙋 Sem item nesta sugestão: Bia');
    expect(novo?.text).not.toContain('Aguardando');
    expect(h.chamadasDe('editMessageReplyMarkup').some((c) => c.payload.message_id === idCardAntigo)).toBe(true);
  });

  it('outra pessoa clicando no botão do privado da Bia não responde por ela', async () => {
    const { iris, h } = await biaAcimaDoOrcamento();
    const pergunta = h.enviadas(BIA.id).at(-1);
    const aceito = pergunta?.botoes.find((b) => b.text === 'Aceito')?.callback_data ?? '';

    await h.clicar(ANA, aceito, { chatId: ANA.id, messageId: 1 });

    expect(h.enviadas(ANA.id).at(-1)?.text).toBe(TEXTOS_ORCAMENTO.nadaPendente);
    expect((await iris.fechar(String(GRUPO), String(ANA.id))).outcome).toBe('budget_pending');
  });
});
