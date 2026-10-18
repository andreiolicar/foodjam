import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { createIfoodMcpClient, createIfoodDiscoveryCatalog, readIfoodMcpConfig, readIfoodCart } from '../src/ifood/index.js';
import { openPrivateCatalogReport } from '../src/ifood/catalog-check-cli.js';
import { catalogDocument } from '../src/ifood/catalog-data.js';
import { selecionarEnderecoSalvo, proporDescoberta, criarLlmDoAmbiente, temProvedorReal } from '../src/core/index.js';
import { criarSessao } from '../src/core/sessao.js';
import { confirmarEndereco } from '../src/core/endereco.js';
import type { IfoodMcpClient } from '../src/ifood/index.js';
import type { LlmPort, DiscoveryCatalogPort } from '../src/core/ports.js';
import type { PreparationContext } from '../src/core/contracts.js';

const participant = z.object({ id: z.string().min(1), displayName: z.string().min(1), preferences: z.object({
  wishes: z.array(z.string()).exactOptional(), foodPreferences: z.array(z.string()).exactOptional(),
  avoids: z.array(z.string()).exactOptional(), dietaryRestrictions: z.array(z.string()).exactOptional(), budgetCents: z.number().int().nonnegative().safe().exactOptional(),
}) });
export const inputSchema = z.object({ sessionId: z.string().min(1), organizerId: z.string().min(1), participants: z.array(participant).min(1).max(20),
  confirmedAddress: z.object({ id: z.string().min(1), formatted: z.string().min(1) }),
  mode: z.enum(['literal', 'model']), moneyUnit: z.enum(['BRL', 'cents']).exactOptional(),
  knownCart: z.object({ cartId: z.string().min(1), storeId: z.string().min(1), items: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().positive() })).min(1) }).exactOptional(),
}).strict();

/** Composição de leitura testável: nenhum fake de catálogo no caminho de produção. */
export async function runIntegrationRead(input: z.infer<typeof inputSchema>, deps: {
  client: Pick<IfoodMcpClient, 'callReadTool' | 'callCartTool'>; catalog: DiscoveryCatalogPort; llm?: LlmPort;
}) {
  if (input.mode === 'model' && !deps.llm) throw new Error('Modelo real não configurado.');
  if (!input.participants.some(p => p.id === input.organizerId) || new Set(input.participants.map(p => p.id)).size !== input.participants.length) throw new Error('Participantes inválidos.');
  const user = catalogDocument(await deps.client.callReadTool('getUser', {}));
  const identity = z.object({ success: z.literal(true), data: z.object({ email: z.string().min(1) }) }).safeParse(user);
  if (!identity.success) throw new Error('Conta autenticada não identificada.');
  // Chave local pseudônima de escopo; não representa um ID devolvido pelo iFood.
  const authenticatedUserId = createHash('sha256').update(identity.data.data.email).digest('hex');
  const initial = criarSessao({ id: input.sessionId, organizerId: input.organizerId, participants: structuredClone(input.participants) });
  const selected = await selecionarEnderecoSalvo(initial, input.organizerId, deps.catalog, input.confirmedAddress.id);
  if (selected.session.address.candidate.formatted !== input.confirmedAddress.formatted) throw new Error('Endereço confirmado divergiu da conta.');
  const confirmed = confirmarEndereco(selected.session, input.organizerId).session;
  const preliminary = await proporDescoberta(confirmed, { port: deps.catalog, address: input.confirmedAddress,
    proposalId: `${input.sessionId}-preliminary`, mode: input.mode, ...(deps.llm ? { llm: deps.llm } : {}) });
  let knownCart;
  if (input.knownCart) {
    const context: PreparationContext = { authenticatedUserId, sessionId: input.sessionId, proposalId: 'known-cart-inspection',
      storeId: input.knownCart.storeId, address: input.confirmedAddress, items: input.knownCart.items };
    knownCart = await readIfoodCart(deps.client, context, input.knownCart.cartId, input.moneyUnit);
  }
  return { preliminary, ...(knownCart ? { knownCart, knownCartPurpose: 'inspection_only_not_bound_to_proposal' as const } : {}),
    remoteWritesExecuted: false, purchaseSubmitted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    const args = process.argv.slice(2);
    if (args.length !== 6 || args[0] !== '--input' || args[2] !== '--report' || args[4] !== '--env') throw new Error('Argumentos inválidos.');
    const input = inputSchema.parse(JSON.parse(await readFile(resolve(args[1]!), 'utf8')));
    loadEnv({ path: resolve(args[5]!), quiet: true });
    if (input.mode === 'model' && !temProvedorReal(process.env)) throw new Error('Modelo real ausente.');
    const client = createIfoodMcpClient(readIfoodMcpConfig(), { allowCartMutations: false, allowPaymentConfiguration: false });
    const output = await openPrivateCatalogReport(resolve(args[3]!));
    let count = 0;
    const charge = () => { if (++count > 14) throw new Error('Limite de leituras atingido.'); };
    const calls: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
    const reads = {
      async callReadTool(name: string, args: Record<string, unknown>) { charge(); const result = await client.callReadTool(name, args); calls.push({ name, args, result }); return result; },
      async callCartTool(name: string, args: Record<string, unknown>) { if (name !== 'getCart') throw new Error('Somente leitura.'); charge(); const result = await client.callCartTool(name, args); calls.push({ name, args, result }); return result; },
    };
    let result: unknown; let tools: unknown; let failed = false;
    try {
      console.info('Integração real somente leitura; OAuth pode abrir o navegador.');
      await client.connect(); charge(); tools = await client.listTools();
      result = await runIntegrationRead(input, { client: reads, catalog: createIfoodDiscoveryCatalog(reads, { ...(input.moneyUnit ? { moneyUnit: input.moneyUnit } : {}) }),
        ...(input.mode === 'model' ? { llm: criarLlmDoAmbiente(process.env) } : {}) });
    } catch { failed = true; }
    finally {
      await client.close().catch(() => { failed = true; });
      try { await output.writeFile(JSON.stringify({ failed, readCount: Math.min(count, 14), tools, calls, result }, null, 2)); }
      finally { await output.close(); }
    }
    console.info(failed ? 'Integração não concluída; evidências privadas preservadas.' : 'Leitura integrada concluída; revise proposta preliminar e pendências no relatório privado.');
    process.exitCode = failed ? 1 : 0;
  })().catch(() => { console.error('Integração não iniciada: configuração privada ou destino inválido. Dados omitidos.'); process.exitCode = 1; });
}
