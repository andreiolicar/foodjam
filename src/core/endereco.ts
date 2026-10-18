import type { CoreAction, DeliveryAddress, ParticipantId } from './contracts.js';
import type { AddressError, CatalogPort } from './ports.js';
import type { CoreSession } from './sessao.js';
import { NaoAutorizadoError, voltarParaColeta } from './sessao.js';

// ---------------------------------------------------------------------------
// Endereço de entrega. Fluxo (o modelo não participa):
// 1. Ao iniciar: com endereço padrão válido, pergunta ao organizador
//    [Sim] [Outro endereço]; sem padrão (ou padrão inválido), pede para digitar.
// 2. "Outro endereço"/"Corrigir": o organizador digita no privado; enquanto
//    isso, as mensagens DELE vão para a validação de endereço, nunca para a coleta.
// 3. O texto vai para a porta do iFood (validateAddress), que devolve o
//    endereço normalizado ou o motivo do erro. Válido: [Confirmar] [Corrigir].
// 4. Só o organizador confirma. A coleta não espera; propor e fechar exigem
//    endereço confirmado; trocar o endereço descarta a proposta.
// ---------------------------------------------------------------------------

export const TEXTOS_ENDERECO = {
  pedir: 'Qual o endereço de entrega? Digite rua, número, bairro e cidade.',
  confirmarPadrao: (endereco: string) => `Entregar em ${endereco}?`,
  confirmarDigitado: (endereco: string) => `Encontrei este endereço: ${endereco}. Está certo?`,
  erros: {
    not_found: 'Não encontrei esse endereço.',
    out_of_area: 'Esse endereço fica fora da área de entrega.',
    incomplete: 'O endereço está incompleto: informe rua, número, bairro e cidade.',
  } satisfies Record<AddressError, string>,
  tenteDeNovo: 'Pode digitar de novo?',
  confirmado: (endereco: string) => `Endereço de entrega confirmado: ${endereco}.`,
  propostaDescartada: 'O endereço de entrega mudou; a proposta anterior foi descartada. Monte uma nova quando quiser.',
  semCandidato: 'Não há endereço esperando confirmação.',
  exigido: 'Antes de montar ou fechar o pedido, confirme o endereço de entrega.',
} as const;

export type EnderecoOutcome =
  | 'address_requested'
  | 'address_default_proposed'
  | 'address_typed_proposed'
  | 'address_invalid'
  | 'address_confirmed'
  | 'address_nothing_to_confirm';

export interface EnderecoResult {
  session: CoreSession;
  actions: CoreAction[];
  outcome: EnderecoOutcome;
  /** Em address_confirmed: a proposta foi descartada porque o endereço mudou. */
  proposalDiscarded?: boolean;
  /** Em address_invalid: o motivo que o iFood deu. */
  reason?: AddressError;
}

/** Endereço que vale para buscas, proposta e pedido; undefined se não houver confirmado. */
export function enderecoConfirmado(session: CoreSession): DeliveryAddress | undefined {
  return session.address?.status === 'confirmed' ? session.address.confirmed : undefined;
}

/** A mensagem desta pessoa deve ir para a validação de endereço (e não para a coleta)? */
export function esperandoEnderecoDe(session: CoreSession, participantId: ParticipantId): boolean {
  return session.address?.status === 'awaiting_text' && participantId === session.organizerId;
}

function exigirOrganizador(session: CoreSession, actorId: ParticipantId, acao: string): void {
  if (actorId !== session.organizerId) throw new NaoAutorizadoError(actorId, acao);
}

const pedir = (session: CoreSession): CoreAction => ({
  type: 'request_address',
  sessionId: session.id,
  participantId: session.organizerId,
  text: TEXTOS_ENDERECO.pedir,
});

const confirmar = (session: CoreSession, address: DeliveryAddress, kind: 'default' | 'typed'): CoreAction => ({
  type: 'confirm_address',
  sessionId: session.id,
  participantId: session.organizerId,
  address,
  kind,
  text: kind === 'default' ? TEXTOS_ENDERECO.confirmarPadrao(address.formatted) : TEXTOS_ENDERECO.confirmarDigitado(address.formatted),
});

/** Ações para lembrar o organizador do passo pendente (ex.: quando ele tenta propor antes). */
export function lembrarEndereco(session: CoreSession): CoreAction[] {
  const a = session.address;
  if (a?.status === 'pending_confirmation' && a.candidate) return [confirmar(session, a.candidate, a.origin ?? 'typed')];
  return [pedir(session)];
}

/** Passo 1: na abertura da sessão, propõe o endereço padrão (se válido) ou pede o endereço. */
export async function iniciarEndereco(
  session: CoreSession,
  port: CatalogPort,
  enderecoPadrao: string | undefined,
): Promise<EnderecoResult> {
  if (enderecoPadrao?.trim()) {
    const validacao = await port.validateAddress(enderecoPadrao);
    if (validacao.ok) {
      const next: CoreSession = {
        ...session,
        address: { status: 'pending_confirmation', candidate: validacao.address, origin: 'default' },
      };
      return { session: next, actions: [confirmar(next, validacao.address, 'default')], outcome: 'address_default_proposed' };
    }
  }
  const next: CoreSession = { ...session, address: { status: 'awaiting_text' } };
  return { session: next, actions: [pedir(next)], outcome: 'address_requested' };
}

/** [Outro endereço] / [Corrigir]: o organizador vai digitar. O confirmado anterior não vale até a nova confirmação. */
export function pedirOutroEndereco(session: CoreSession, actorId: ParticipantId): EnderecoResult {
  exigirOrganizador(session, actorId, 'trocar o endereço');
  const confirmed = session.address?.confirmed;
  const next: CoreSession = { ...session, address: { status: 'awaiting_text', ...(confirmed && { confirmed }) } };
  return { session: next, actions: [pedir(next)], outcome: 'address_requested' };
}

/** Passo 3: texto digitado pelo organizador vai para a porta do iFood. */
export async function receberTextoEndereco(session: CoreSession, text: string, port: CatalogPort): Promise<EnderecoResult> {
  const validacao = await port.validateAddress(text);
  if (!validacao.ok) {
    const erro = `${TEXTOS_ENDERECO.erros[validacao.reason]} ${TEXTOS_ENDERECO.tenteDeNovo}`;
    return {
      session,
      actions: [{ type: 'send_message', sessionId: session.id, participantId: session.organizerId, text: erro }],
      outcome: 'address_invalid',
      reason: validacao.reason,
    };
  }
  const confirmed = session.address?.confirmed;
  const next: CoreSession = {
    ...session,
    address: { status: 'pending_confirmation', candidate: validacao.address, origin: 'typed', ...(confirmed && { confirmed }) },
  };
  return { session: next, actions: [confirmar(next, validacao.address, 'typed')], outcome: 'address_typed_proposed' };
}

/**
 * [Sim] / [Confirmar]: só o organizador. Se o endereço mudou e já havia
 * proposta, ela é descartada (volta para a coleta): preços, lojas e entrega
 * dependem do endereço.
 */
export function confirmarEndereco(session: CoreSession, actorId: ParticipantId): EnderecoResult {
  exigirOrganizador(session, actorId, 'confirmar o endereço');
  const candidato = session.address?.status === 'pending_confirmation' ? session.address.candidate : undefined;
  if (!candidato) {
    return {
      session,
      actions: [{ type: 'send_message', sessionId: session.id, participantId: actorId, text: TEXTOS_ENDERECO.semCandidato }],
      outcome: 'address_nothing_to_confirm',
    };
  }

  const anterior = session.address?.confirmed;
  const mudou = anterior !== undefined && (anterior.id ?? anterior.formatted) !== (candidato.id ?? candidato.formatted);
  const descartar = mudou && session.proposal !== undefined && (session.status === 'reviewing' || session.status === 'awaiting_confirmation');

  let next: CoreSession = { ...session, address: { status: 'confirmed', confirmed: candidato } };
  if (descartar) next = voltarParaColeta(next);

  const actions: CoreAction[] = [
    { type: 'send_message', sessionId: session.id, participantId: actorId, text: TEXTOS_ENDERECO.confirmado(candidato.formatted) },
  ];
  if (descartar) actions.push({ type: 'send_message', sessionId: session.id, text: TEXTOS_ENDERECO.propostaDescartada });
  actions.push({ type: 'session_updated', session: next });
  return { session: next, actions, outcome: 'address_confirmed', proposalDiscarded: descartar };
}
