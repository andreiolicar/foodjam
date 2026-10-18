import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agente, Resposta } from '../../src/core/agente.js';
import { criarAgente } from '../../src/core/agente.js';
import { criarAgrupador } from '../../src/core/agrupador.js';
import type { ItemLote } from '../../src/core/coleta.js';
import { CatalogoFake, ENDERECO_FAKE } from '../../src/core/fakes/catalogo-fake.js';
import { FakeLlm, responderHeuristico } from '../../src/core/fakes/llm-fake.js';
import { AGORA } from './fixtures.js';

/** Agente falso que só registra os lotes recebidos. */
function agenteEspiao() {
  const lotes: { sessionId: string; itens: readonly ItemLote[] }[] = [];
  const agente = {
    mensagens: async (sessionId: string, itens: readonly ItemLote[]) => {
      lotes.push({ sessionId, itens });
      return { outcome: 'batch', actions: [] } satisfies Resposta;
    },
  } as unknown as Agente;
  return { agente, lotes };
}

const msg = (sessionId: string, participantId: string, text = 'pizza') => ({ sessionId, participantId, text });

describe('criarAgrupador', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounce: mensagens próximas viram um lote só, enviado após a pausa', async () => {
    const { agente, lotes } = agenteEspiao();
    const respostas: string[] = [];
    const g = criarAgrupador(agente, { esperaMs: 2000, aoResponder: (id) => void respostas.push(id) });

    g.adicionar(msg('chat', 'a'), 'A');
    await vi.advanceTimersByTimeAsync(1500);
    g.adicionar(msg('chat', 'b'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(lotes).toHaveLength(0);
    expect(g.pendentes('chat')).toBe(2);

    await vi.advanceTimersByTimeAsync(600);
    expect(lotes).toEqual([
      {
        sessionId: 'chat',
        itens: [
          { participantId: 'a', text: 'pizza', displayName: 'A' },
          { participantId: 'b', text: 'pizza' },
        ],
      },
    ]);
    expect(respostas).toEqual(['chat']);
    expect(g.pendentes('chat')).toBe(0);
  });

  it('espera máxima: mensagens sem parar não seguram o lote para sempre', async () => {
    const { agente, lotes } = agenteEspiao();
    const g = criarAgrupador(agente, { esperaMs: 2000, esperaMaxMs: 5000, aoResponder: () => {} });

    for (let i = 0; i < 6; i++) {
      g.adicionar(msg('chat', `p${i}`));
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(lotes[0]?.itens).toHaveLength(5);
  });

  it('lote cheio é enviado na hora', async () => {
    const { agente, lotes } = agenteEspiao();
    const g = criarAgrupador(agente, { maxLote: 3, aoResponder: () => {} });
    g.adicionar(msg('chat', 'a'));
    g.adicionar(msg('chat', 'b'));
    g.adicionar(msg('chat', 'c'));
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes[0]?.itens).toHaveLength(3);
  });

  it('chats diferentes têm lotes separados', async () => {
    const { agente, lotes } = agenteEspiao();
    const g = criarAgrupador(agente, { aoResponder: () => {} });
    g.adicionar(msg('chat-1', 'a'));
    g.adicionar(msg('chat-2', 'b'));
    await vi.advanceTimersByTimeAsync(2500);
    expect(lotes.map((l) => l.sessionId).sort()).toEqual(['chat-1', 'chat-2']);
  });

  it('esvaziar envia já (ex.: antes de propor); sem pendentes não faz nada', async () => {
    const { agente, lotes } = agenteEspiao();
    const g = criarAgrupador(agente, { aoResponder: () => {} });
    g.adicionar(msg('chat', 'a'));
    await g.esvaziar('chat');
    expect(lotes).toHaveLength(1);
    await g.esvaziar('chat');
    expect(lotes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(lotes).toHaveLength(1);
  });

  it('erro no aoResponder vai para onError e não derruba o agrupador', async () => {
    const { agente } = agenteEspiao();
    const erros: unknown[] = [];
    const g = criarAgrupador(agente, {
      aoResponder: () => {
        throw new Error('telegram fora');
      },
      onError: (e) => erros.push(e),
    });
    g.adicionar(msg('chat', 'a'));
    await g.esvaziar('chat');
    expect(String(erros[0])).toContain('telegram fora');
  });
});

describe('agente.mensagens (lote)', () => {
  it('na coleta, 10 pessoas = 1 chamada ao modelo; na proposta, cada mensagem é um ajuste', async () => {
    const llm = new FakeLlm(responderHeuristico);
    const agente = criarAgente({ catalog: new CatalogoFake(), llm, now: () => AGORA, enderecoPadrao: ENDERECO_FAKE });
    await agente.iniciar('chat', { id: 'ana', displayName: 'Ana' });
    await agente.confirmarEndereco('chat', 'ana');

    const itens = Array.from({ length: 10 }, (_, i) => ({ participantId: `p${i}`, text: i % 2 ? 'quero um lanche' : 'bolo de cenoura' }));
    const lote = await agente.mensagens('chat', itens);
    expect(llm.requests).toHaveLength(1);
    expect(lote.outcome).toBe('batch');
    expect(lote.resultados).toHaveLength(10);
    expect(lote.session?.participants).toHaveLength(11);

    const proposta = await agente.propor('chat', 'ana');
    expect(proposta.outcome).toBe('proposed');

    const ajustes = await agente.mensagens('chat', [
      { participantId: 'p0', text: 'troca o meu por um café' },
      { participantId: 'p1', text: 'valeu!' },
    ]);
    expect(ajustes.resultados).toEqual([
      { participantId: 'p0', outcome: 'adjusted' },
      { participantId: 'p1', outcome: 'not_adjustment' },
    ]);
  });

  it('lote vazio e sessão inexistente não chamam o modelo', async () => {
    const llm = new FakeLlm([]);
    const agente = criarAgente({ catalog: new CatalogoFake(), llm, now: () => AGORA, enderecoPadrao: ENDERECO_FAKE });
    expect((await agente.mensagens('chat', [])).outcome).toBe('empty');
    expect((await agente.mensagens('chat', [{ participantId: 'a', text: 'pizza' }])).outcome).toBe('no_session');
    expect(llm.requests).toHaveLength(0);
  });
});
