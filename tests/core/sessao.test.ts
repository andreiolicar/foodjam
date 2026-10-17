import { describe, expect, it } from 'vitest';
import type { Proposal, SessionStatus } from '../../src/core/contracts.js';
import type { CoreSession } from '../../src/core/sessao.js';
import {
  NaoAutorizadoError,
  TransicaoInvalidaError,
  apresentarProposta,
  cancelar,
  confirmar,
  criarSessao,
  pedirConfirmacao,
  podeTransitar,
  voltarParaColeta,
} from '../../src/core/sessao.js';

const ORG = 'org';
const AGORA = '2026-10-18T12:00:00.000Z';

const proposta = (id = 'p1', sessionId = 's1'): Proposal => ({
  id,
  sessionId,
  orders: [],
  split: { shares: [], totalCents: 0 },
  uncoveredParticipantIds: [],
  justification: 'ok',
});

const emColeta = () =>
  criarSessao({
    id: 's1',
    organizerId: ORG,
    participants: [
      { id: ORG, displayName: 'Org', preferences: {} },
      { id: 'bia', displayName: 'Bia', preferences: {} },
    ],
  });
const emProposta = () => apresentarProposta(emColeta(), proposta());
const emConfirmacao = () => pedirConfirmacao(emProposta());
const fechada = () => confirmar(emConfirmacao(), ORG, AGORA).session;
const cancelada = () => cancelar(emColeta(), ORG);

const sessoesPorStatus: Record<SessionStatus, () => CoreSession> = {
  collecting: emColeta,
  reviewing: emProposta,
  awaiting_confirmation: emConfirmacao,
  closed: fechada,
  cancelled: cancelada,
};

describe('criarSessao', () => {
  it('começa em coleta, sem proposta nem fechamento', () => {
    const session = emColeta();
    expect(session.status).toBe('collecting');
    expect(session.proposal).toBeUndefined();
    expect(session.closure).toBeUndefined();
  });
});

describe('tabela de transições', () => {
  const validas: [SessionStatus, SessionStatus][] = [
    ['collecting', 'reviewing'],
    ['collecting', 'cancelled'],
    ['reviewing', 'reviewing'],
    ['reviewing', 'collecting'],
    ['reviewing', 'awaiting_confirmation'],
    ['reviewing', 'cancelled'],
    ['awaiting_confirmation', 'closed'],
    ['awaiting_confirmation', 'reviewing'],
    ['awaiting_confirmation', 'cancelled'],
  ];
  const todos = Object.keys(sessoesPorStatus) as SessionStatus[];

  it.each(todos.flatMap((from) => todos.map((to) => [from, to] as const)))('%s → %s', (from, to) => {
    const esperado = validas.some(([f, t]) => f === from && t === to);
    expect(podeTransitar(from, to)).toBe(esperado);
  });
});

describe('coleta → proposta', () => {
  it('apresenta a proposta', () => {
    const session = apresentarProposta(emColeta(), proposta());
    expect(session.status).toBe('reviewing');
    expect(session.proposal?.id).toBe('p1');
  });

  it('troca a proposta durante a revisão', () => {
    expect(apresentarProposta(emProposta(), proposta('p2')).proposal?.id).toBe('p2');
  });

  it('organizador pode pedir ajuste na confirmação, voltando à proposta', () => {
    const session = apresentarProposta(emConfirmacao(), proposta('p2'));
    expect(session.status).toBe('reviewing');
    expect(session.proposal?.id).toBe('p2');
  });

  it('rejeita proposta de outra sessão', () => {
    expect(() => apresentarProposta(emColeta(), proposta('p1', 'outra'))).toThrow(/outra sessão/);
  });

  it.each([['closed', fechada] as const, ['cancelled', cancelada] as const])('não apresenta proposta em %s', (_s, criar) => {
    expect(() => apresentarProposta(criar(), proposta())).toThrow(TransicaoInvalidaError);
  });
});

describe('proposta → coleta', () => {
  it('volta à coleta descartando a proposta', () => {
    const session = voltarParaColeta(emProposta());
    expect(session.status).toBe('collecting');
    expect(session).not.toHaveProperty('proposal');
  });

  it.each([
    ['collecting', emColeta] as const,
    ['awaiting_confirmation', emConfirmacao] as const,
    ['closed', fechada] as const,
    ['cancelled', cancelada] as const,
  ])('não volta à coleta a partir de %s', (_s, criar) => {
    expect(() => voltarParaColeta(criar())).toThrow(TransicaoInvalidaError);
  });
});

describe('proposta → confirmação', () => {
  it('pede confirmação ao organizador', () => {
    expect(pedirConfirmacao(emProposta()).status).toBe('awaiting_confirmation');
  });

  it.each([
    ['collecting', emColeta] as const,
    ['awaiting_confirmation', emConfirmacao] as const,
    ['closed', fechada] as const,
    ['cancelled', cancelada] as const,
  ])('não pede confirmação a partir de %s', (_s, criar) => {
    expect(() => pedirConfirmacao(criar())).toThrow(TransicaoInvalidaError);
  });

  it('exige proposta presente', () => {
    const semProposta: CoreSession = { ...emColeta(), status: 'reviewing' };
    expect(() => pedirConfirmacao(semProposta)).toThrow(/não há proposta/);
  });
});

describe('confirmação → fechada', () => {
  it('organizador fecha e o fechamento aponta para a proposta', () => {
    const result = confirmar(emConfirmacao(), ORG, AGORA);
    expect(result.alreadyClosed).toBe(false);
    expect(result.session.status).toBe('closed');
    expect(result.closure).toEqual({ proposalId: 'p1', authorizedBy: ORG, authorizedAt: AGORA });
    expect(result.session.closure).toEqual(result.closure);
  });

  it('participante que não é organizador não confirma', () => {
    expect(() => confirmar(emConfirmacao(), 'bia', AGORA)).toThrow(NaoAutorizadoError);
  });

  it('idempotente: confirmar de novo não gera outro fechamento', () => {
    const primeira = confirmar(emConfirmacao(), ORG, AGORA);
    const segunda = confirmar(primeira.session, ORG, '2026-10-18T12:05:00.000Z');
    expect(segunda.alreadyClosed).toBe(true);
    expect(segunda.closure).toBe(primeira.closure);
    expect(segunda.session).toBe(primeira.session);
  });

  it('não organizador continua barrado mesmo com a sessão já fechada', () => {
    expect(() => confirmar(fechada(), 'bia', AGORA)).toThrow(NaoAutorizadoError);
  });

  it.each([
    ['collecting', emColeta] as const,
    ['reviewing', emProposta] as const,
    ['cancelled', cancelada] as const,
  ])('não confirma a partir de %s', (_s, criar) => {
    expect(() => confirmar(criar(), ORG, AGORA)).toThrow(TransicaoInvalidaError);
  });
});

describe('cancelamento', () => {
  it.each([
    ['collecting', emColeta] as const,
    ['reviewing', emProposta] as const,
    ['awaiting_confirmation', emConfirmacao] as const,
  ])('organizador cancela a partir de %s', (_s, criar) => {
    expect(cancelar(criar(), ORG).status).toBe('cancelled');
  });

  it.each([['closed', fechada] as const, ['cancelled', cancelada] as const])('não cancela sessão %s', (_s, criar) => {
    expect(() => cancelar(criar(), ORG)).toThrow(TransicaoInvalidaError);
  });

  it('participante que não é organizador não cancela', () => {
    expect(() => cancelar(emProposta(), 'bia')).toThrow(NaoAutorizadoError);
  });
});

describe('imutabilidade', () => {
  it('transições devolvem sessão nova sem alterar a anterior', () => {
    const coleta = emColeta();
    const proposta1 = apresentarProposta(coleta, proposta());
    const confirmacao = pedirConfirmacao(proposta1);
    confirmar(confirmacao, ORG, AGORA);

    expect(coleta.status).toBe('collecting');
    expect(coleta.proposal).toBeUndefined();
    expect(proposta1.status).toBe('reviewing');
    expect(confirmacao.status).toBe('awaiting_confirmation');
    expect(confirmacao.closure).toBeUndefined();
  });
});
