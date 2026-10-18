import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';
import type { LlmPort } from '../src/core/ports.js';
import { criarLlmDoAmbiente, temProvedorReal } from '../src/core/llm-ambiente.js';
import { rateEvidence } from '../src/core/llm-http-evidence.js';
export { rateEvidence } from '../src/core/llm-http-evidence.js';
import { createIfoodDiscoveryCatalog } from '../src/ifood/discovery.js';
import { catalogDocument, catalogMerchantIdentity } from '../src/ifood/catalog-data.js';
import { savedAddressLocation } from '../src/ifood/catalog-address.js';
import { openPrivateCatalogReport } from '../src/ifood/catalog-check-cli.js';
import { inputSchema, runIntegrationRead } from './integracao-ifood.js';
import { preparationInputSchema } from './preparar-ifood.js';

const callSchema = z.object({ name: z.string(), args: z.record(z.string(), z.unknown()), result: z.object({
  content: z.array(z.object({ type: z.string() }).passthrough()),
  structuredContent: z.record(z.string(), z.unknown()).exactOptional(), isError: z.boolean().exactOptional(),
}).passthrough() });
const snapshotSchema = z.object({ calls: z.array(callSchema).min(1) });
export const demoPlanSchema = z.object({ input: inputSchema, catalogReport: z.string().min(1), searchReport: z.string().min(1),
  catalogSha256: z.string().regex(/^[a-f0-9]{64}$/), searchSha256: z.string().regex(/^[a-f0-9]{64}$/),
  notBefore: z.iso.datetime({ offset: true }), previousReport: z.string().min(1).exactOptional(),
}).strict();

/** Fatal para a execução da demo; não altera a classificação de erros do Core. */
export class DemoStop extends Error { readonly fatal = true; constructor() { super('Tentativa controlada encerrada; consulte diagnóstico sanitizado.'); } }

export function observedDemoFetch(http: typeof fetch, events: (ReturnType<typeof rateEvidence> & { at: string; durationMs: number })[], now = Date.now): typeof fetch {
  let count = 0; let stopped = false;
  return async (url, init) => {
    // Até três formatos do adaptador existente, nunca repetir 429/5xx nesta execução.
    if (stopped || ++count > 3) throw new DemoStop();
    const started = now();
    const response = await http(url, init);
    const limited = response.status === 429 || response.status >= 500;
    if (limited) stopped = true;
    // O corpo pode falhar depois de termos recebido status e Retry-After.
    const body = response.ok ? '' : await response.clone().text().catch(() => '');
    events.push({ ...rateEvidence(response.status, response.headers, body), at: new Date(now()).toISOString(), durationMs: now() - started });
    if (limited) throw new DemoStop();
    return response;
  };
}

/** Snapshot de MCP real, explicitamente histórico; sem transporte ou catálogo de exemplo. */
export async function runDemoSnapshot(input: z.infer<typeof inputSchema>, searchData: unknown, catalogData: unknown, llm: LlmPort) {
  if (input.mode !== 'model' || input.knownCart || !input.moneyUnit || input.participants.length !== 2) throw new Error('Demo exige dois participantes, IA, perfil monetário explícito e nenhum carrinho histórico.');
  const search = snapshotSchema.parse(searchData); const snapshot = snapshotSchema.parse(catalogData);
  const user = (calls: typeof snapshot.calls) => z.object({ success: z.literal(true), data: z.object({ email: z.string().min(1) }) }).parse(catalogDocument(calls.find(c => c.name === 'getUser')!.result)).data.email;
  const email = user(snapshot.calls);
  if (email !== user(search.calls)) throw new Error('Conta dos snapshots divergiu.');
  const addresses = snapshot.calls.filter(c => c.name === 'listAddresses');
  if (!addresses.length) throw new Error('Endereço ausente.');
  const location = savedAddressLocation(catalogDocument(addresses[0]!.result), input.confirmedAddress);
  if (addresses.some(c => !isDeepStrictEqual(savedAddressLocation(catalogDocument(c.result), input.confirmedAddress), location))) throw new Error('Localização divergente.');
  const details = snapshot.calls.filter(c => c.name === 'getMerchant');
  if (details.length !== 1 || !isDeepStrictEqual(details[0]!.args.userLocation, location)) throw new Error('Loja não identificada para o endereço.');
  const merchant = catalogMerchantIdentity(catalogDocument(details[0]!.result));
  if (!merchant.isOpen) throw new Error('Loja fechada no retrato.');
  const source = search.calls.find(c => {
    if (c.name !== 'searchOffers' || c.args.resultKind !== 'MERCHANT' || !isDeepStrictEqual(c.args.userLocation, location)) return false;
    const page = catalogDocument(c.result) as { results?: unknown[] };
    return page.results?.some(row => catalogMerchantIdentity(row).merchantId === merchant.merchantId);
  });
  if (!source) throw new Error('Loja fora da busca comprovada.');
  const pages = snapshot.calls.filter(c => c.name === 'browseOffers').length;
  if (pages < 1 || pages > 3) throw new Error('Cobertura fora do limite.');
  const pending = structuredClone(snapshot.calls);
  const replay = { async callReadTool(name: string, args: Record<string, unknown>) {
    const expected = pending.shift();
    if (!expected || name !== expected.name || !isDeepStrictEqual(args, expected.args)) throw new Error('Consulta difere da evidência.');
    return expected.result;
  }, async callCartTool(): Promise<never> { throw new Error('Carrinho não permitido nesta demo.'); } };
  const catalog = createIfoodDiscoveryCatalog(replay, { maxPages: pages, ...(input.moneyUnit ? { moneyUnit: input.moneyUnit } : {}) });
  const classifiedPeople = new Set<string>();
  const read = await runIntegrationRead(input, { client: replay, catalog: {
    listSavedAddresses: () => catalog.listSavedAddresses(),
    // Snapshot histórico: getMerchant já foi verificado acima; não inventar uma leitura ausente.
    async getStore(id, address) {
      if (id !== merchant.merchantId || !isDeepStrictEqual(address, input.confirmedAddress)) throw new Error('Loja difere da evidência.');
      return { id, name: merchant.merchantName, isOpen: merchant.isOpen };
    },
    async searchStores(query, address) {
      if (query !== source.args.query || !isDeepStrictEqual(address, input.confirmedAddress)) throw new Error('Busca difere da evidência.');
      return [{ id: merchant.merchantId, name: merchant.merchantName, isOpen: merchant.isOpen }];
    },
    async getMenu(id, address) { const menu = await catalog.getMenu(id, address); return { ...menu, items: menu.items.slice(0, 6), truncated: true }; },
  }, llm: { generate(request) { const shape = z.object({ properties: z.object({ pessoas: z.object({ items: z.object({ properties: z.object({ participantId: z.object({ enum: z.array(z.string()).length(1) }) }) }) }) }) }).parse(request.outputSchema);
    const id = shape.properties.pessoas.items.properties.participantId.enum[0]!;
    if (!input.participants.some(p => p.id === id) || classifiedPeople.has(id)) throw new DemoStop();
    classifiedPeople.add(id); return llm.generate(request); } } });
  const proposal = read.preliminary.proposal;
  if (pending.length || !proposal || new Set(proposal.items.map(i => i.storeId)).size !== 1
    || input.participants.some(p => !proposal.items.some(i => i.participantId === p.id))) throw new Error('Proposta não cobre as duas pessoas em uma loja.');
  return { read, preparation: preparationInputSchema.parse({ proposal, accountScope: createHash('sha256').update(email).digest('hex'),
    moneyUnit: input.moneyUnit, discountPolicy: 'block_unattributed' }), source: 'mcp_snapshot_from_explicit_plan' as const,
    currentAvailabilityConfirmed: false, remoteMcpCalls: 0, remoteWritesExecuted: false, purchaseSubmitted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    const args = process.argv.slice(2);
    if (args.length !== 8 || args[0] !== '--input' || args[2] !== '--report' || args[4] !== '--proposal' || args[6] !== '--env') throw new DemoStop();
    const plan = demoPlanSchema.parse(JSON.parse(await readFile(resolve(args[1]!), 'utf8')));
    if (Date.now() < Date.parse(plan.notBefore)) throw new DemoStop();
    if (plan.previousReport) {
      const previous = JSON.parse(await readFile(resolve(plan.previousReport), 'utf8')) as { nextAttemptAt?: string; providerWaitUnspecified?: boolean };
      if (previous.providerWaitUnspecified || previous.nextAttemptAt && (!Number.isFinite(Date.parse(previous.nextAttemptAt)) || Date.now() < Date.parse(previous.nextAttemptAt))) throw new DemoStop();
    }
    config({ path: resolve(args[7]!), quiet: true });
    if (!temProvedorReal(process.env)) throw new DemoStop();
    const searchBytes = await readFile(resolve(plan.searchReport), 'utf8');
    const catalogBytes = await readFile(resolve(plan.catalogReport), 'utf8');
    if (createHash('sha256').update(searchBytes).digest('hex') !== plan.searchSha256
      || createHash('sha256').update(catalogBytes).digest('hex') !== plan.catalogSha256) throw new DemoStop();
    const search = JSON.parse(searchBytes) as unknown;
    const snapshot = JSON.parse(catalogBytes) as unknown;
    const output = await openPrivateCatalogReport(resolve(args[3]!));
    const http: Parameters<typeof observedDemoFetch>[1] = [];
    let result: Awaited<ReturnType<typeof runDemoSnapshot>> | undefined; let failed = false;
    try {
      result = await runDemoSnapshot(plan.input, search, snapshot, criarLlmDoAmbiente(process.env, { fetch: observedDemoFetch(fetch, http) }));
      const artifact = await openPrivateCatalogReport(resolve(args[5]!));
      try { await artifact.writeFile(JSON.stringify(result.preparation, null, 2)); } finally { await artifact.close(); }
    } catch { failed = true; }
    finally {
      const limited = http.find(e => e.status === 429 || e.status >= 500);
      const nextAttemptAt = limited?.retryAfterMs === undefined ? undefined : new Date(Date.parse(limited.at) + limited.retryAfterMs).toISOString();
      try { await output.writeFile(JSON.stringify({ failed, http, nextAttemptAt, providerWaitUnspecified: Boolean(limited && !nextAttemptAt),
        sourceCatalogSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), result, remoteMcpCalls: 0, remoteWritesExecuted: false, purchaseSubmitted: false }, null, 2)); }
      finally { await output.close(); }
    }
    console.info(failed ? 'Demo não concluída; diagnóstico privado preservado. Sem criação de carrinho.' : 'Demo com IA real preparada para duas pessoas e uma loja. Proposta privada; sem carrinho.');
    process.exitCode = failed ? 1 : 0;
  })().catch(() => { console.error('Demo não iniciada: conferir plano, período de espera e arquivos privados.'); process.exitCode = 1; });
}
