import type { AddressRegistrationIntent, DeliveryAddress, DiscoveryItem, DiscoveryStore, ParticipantId, PreliminaryProposal } from './contracts.js';
import type { DiscoveryCatalogPort, LlmPort } from './ports.js';
import type { CoreSession } from './sessao.js';
import { NaoAutorizadoError } from './sessao.js';
import { buscarDescoberta, limitarCandidatos, discoveryLimits, type DiscoveryLimits } from './discovery-search.js';
import type { DiscoveryCoverage } from './contracts.js';
import { termosDeBusca } from './catalogo.js';
import { normalizar } from './regras/elegibilidade.js';
import { desejosDe } from './proposta.js';
import type { LlmCallRecord } from './llm.js';
import { gerarEstruturado } from './llm.js';
import { SISTEMA_CLASSIFICACAO, montarPromptClassificacao } from './prompts/proposta.js';
import type { ClassificacaoOutput } from './schemas.js';
import { criarClassificacaoSchema } from './schemas.js';
import { enumerarCombinacoes, escolherNaCombinacao } from './regras/combinacoes.js';
import { contemTermo, palavras, evitado, violaRestricao } from './regras/elegibilidade.js';
import { compatibilidadeComprovada } from './regras/compatibilidade.js';
import { quantidadeDoDesejo } from './regras/quantidades.js';

/** Escolha salva é proposta ao Core, não confirmação nem cadastro silencioso. */
export async function selecionarEnderecoSalvo(inputSession: CoreSession, actorId: ParticipantId, port: DiscoveryCatalogPort, addressId: string) {
  const session = structuredClone(inputSession);
  if (actorId !== session.organizerId) throw new NaoAutorizadoError(actorId, 'selecionar endereço');
  if (session.status === 'closed' || session.status === 'cancelled') throw new Error('Sessão encerrada.');
  const addresses = await port.listSavedAddresses();
  const matches = addresses.filter(a => a.id === addressId);
  if (matches.length !== 1) throw new Error('Endereço salvo não identificado.');
  const address = { ...matches[0]! };
  return { session: { ...session, address: { status: 'pending_confirmation' as const, candidate: address, origin: 'default' as const,
    ...(session.address?.confirmed ? { confirmed: session.address.confirmed } : {}) } },
    actions: [{ type: 'confirm_address' as const, visibility: 'group' as const, sessionId: session.id, participantId: actorId, address, kind: 'default' as const,
      text: `Confirme a entrega em ${address.formatted}.` }] };
}

/** Exploração real: reusa classificação e combinações; não promete orçamento. */
export async function proporDescoberta(inputSession: CoreSession, deps: {
  port: DiscoveryCatalogPort; llm?: LlmPort; mode?: 'model' | 'literal'; address: DeliveryAddress; proposalId: string; registrar?: (record: LlmCallRecord) => void; limits?: Partial<DiscoveryLimits>;
}): Promise<{ classificationMode: 'model' | 'literal'; proposal?: PreliminaryProposal; reason?: 'no_candidates' | 'store_closed'; coverage?: DiscoveryCoverage; alternatives?: PreliminaryProposal[]; stores: DiscoveryStore[]; items: DiscoveryItem[] }> {
  const session = structuredClone(inputSession);
  const address = structuredClone(deps.address);
  const port = deps.port;
  const llm = deps.llm;
  const classificationMode = deps.mode ?? 'model';
  if (classificationMode === 'model' && !llm) throw new Error('Modelo real não configurado.');
  if (!['collecting', 'reviewing'].includes(session.status)) throw new Error('Sessão não está em exploração.');
  if (session.address?.status !== 'confirmed' || session.address.confirmed?.id !== address.id
    || session.address.confirmed?.formatted !== address.formatted) throw new Error('Endereço não confirmado.');
  const found = await buscarDescoberta(port, session.participants, address, deps.limits);
  const selected = found.stores; const items = found.items; const stores = new Map(selected.map(s => [s.id, s]));
  const maxClassification = discoveryLimits(deps.limits).maxClassificationItems;
  const people = session.participants.map(participant => {
    const allowed = items.filter(item => {
      const store = stores.get(item.storeId);
      return !participant.preferences.dietaryRestrictions?.some(r => violaRestricao(item, r))
        && !participant.preferences.avoids?.some(a => evitado(item, store, a));
    });
    const matching = termosDeBusca([participant]).map(term => found.matchesByTerm.get(normalizar(term)) ?? []);
    const itensPermitidos = classificationMode === 'model' ? limitarCandidatos(allowed, matching, maxClassification) : allowed;
    if (itensPermitidos.length < allowed.length) { found.coverage.classificationLimited = true; found.coverage.limited = true;
      const reasons = found.coverage.reasons ??= []; if (!reasons.includes('classification_limit')) reasons.push('classification_limit'); }
    return { participant, desejos: desejosDe(participant), itensPermitidos };
  }).filter(p => p.itensPermitidos.length);
  const catalogIncomplete = found.coverage.limited;
  if (!people.length) return { classificationMode, reason: found.sawClosed && !found.stores.length ? 'store_closed' as const : 'no_candidates' as const, stores: selected, items, coverage: found.coverage };
  const classified: ClassificacaoOutput = { pessoas: [] };
  for (const person of people) {
    if (classificationMode === 'literal') {
      classified.pessoas.push({ participantId: person.participant.id, desejos: person.desejos.map(d => ({
        atende: person.itensPermitidos.filter(i => palavras(d).some(t => contemTermo(palavras(`${i.name} ${i.description ?? ''}`), t))).map(i => i.id), substitutos: [],
      })) });
      continue;
    }
    // Isola a saída de cada pessoa: o provedor retornou entradas heterogêneas
    // em lotes válidos de entrada. Cada resposta mantém schema e retry do Core.
    const result = await gerarEstruturado({ llm: llm!, phase: 'proposta_classificacao', tier: 'capable',
      system: SISTEMA_CLASSIFICACAO, prompt: montarPromptClassificacao([person], selected), outputName: 'proposta_classificacao',
      ...(deps.registrar ? { registrar: deps.registrar } : {}),
      schema: criarClassificacaoSchema(new Map([[person.participant.id, person.desejos.length]])),
    });
    classified.pessoas.push(...result.pessoas);
  }
  const byId = new Map(items.map(i => [i.id, i]));
  if (byId.size !== items.length) throw new Error('IDs de produtos ambíguos.');
  const safe = classified.pessoas.map(p => {
    const person = people.find(x => x.participant.id === p.participantId);
    return { participantId: p.participantId, desejos: p.desejos.map((d, index) => {
      const filter = (ids: readonly string[]) => ids.filter(id => {
        const item = byId.get(id);
        return item && person?.itensPermitidos.some(i => i.id === id)
          && compatibilidadeComprovada(person.desejos[index] ?? '', item);
      });
      return { atende: filter(d.atende), substitutos: filter(d.substitutos) };
    }) };
  });
  const owners = new Map(items.map(i => [i.id, i.storeId]));
  const candidates = enumerarCombinacoes(selected.map(s => s.id)).flatMap(stores => {
    const picks = escolherNaCombinacao(stores, safe, owners);
    const remaining = safe.map(p => ({ ...p, desejos: p.desejos.map(d => ({
      atende: d.atende.filter(id => !picks.some(pick => pick.participantId === p.participantId && pick.menuItemId === id)),
      substitutos: d.substitutos.filter(id => !picks.some(pick => pick.participantId === p.participantId && pick.menuItemId === id)),
    })) }));
    return [{ stores, picks }, { stores, picks: escolherNaCombinacao(stores, remaining, owners) }];
  });
  const seen = new Set<string>();
  const options = candidates.filter(o => {
    const key = o.picks.map(p => `${p.participantId}:${p.menuItemId}`).sort().join('|');
    if (!o.picks.length || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => new Set(b.picks.map(p => p.participantId)).size - new Set(a.picks.map(p => p.participantId)).size
    || b.picks.length - a.picks.length
    || a.picks.filter(i => i.isSubstitute).length - b.picks.filter(i => i.isSubstitute).length || a.stores.length - b.stores.length);
  const best = options[0];
  const equivalent = options.filter(o => !best || new Set(o.picks.map(p => p.participantId)).size === new Set(best.picks.map(p => p.participantId)).size && o.picks.length === best.picks.length);
  const proposals = equivalent.map((o, index): PreliminaryProposal => ({
    coverage: found.coverage,
    id: index ? `${deps.proposalId}-alt-${index}` : deps.proposalId, sessionId: session.id, organizerId: session.organizerId,
    address: { ...address }, participants: structuredClone(session.participants), status: 'preliminary', pending: catalogIncomplete ? ['commercial_validation', 'catalog_incomplete'] : ['commercial_validation'],
    items: o.picks.map(i => ({ participantId: i.participantId, storeId: i.storeId, menuItemId: i.menuItemId,
      quantity: quantidadeDoDesejo(session.participants.find(p => p.id === i.participantId)!.preferences, i.desejo), ...(i.isSubstitute ? { isSubstitute: true } : {}) })),
  }));
  return { classificationMode, ...(proposals[0] ? { proposal: proposals[0] } : { reason: 'no_candidates' as const }), alternatives: proposals.slice(1), stores: selected, items, coverage: found.coverage };
}

/** Não valida/geocodifica/cadastra. O consentimento para escrita é um passo futuro explícito. */
export function coletarEnderecoDigitado(session: CoreSession, actorId: string, text: string): AddressRegistrationIntent {
  if (actorId !== session.organizerId) throw new NaoAutorizadoError(actorId, 'informar endereço');
  if (session.status === 'closed' || session.status === 'cancelled' || !text.trim() || text.length > 500) throw new Error('Texto de endereço inválido.');
  return { sessionId: session.id, organizerId: session.organizerId, rawText: text.trim(), status: 'requires_registration_consent' };
}
