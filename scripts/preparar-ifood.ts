import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { PreliminaryProposalSchema } from '../src/core/schemas.js';
import { createPreparationAuthority, prepareCommercialProposal } from '../src/core/index.js';
import { createIfoodMcpClient, createIfoodCommercialPreparation, createPrivateCartJournal, readIfoodMcpConfig } from '../src/ifood/index.js';
import { catalogDocument } from '../src/ifood/catalog-data.js';
import { openPrivateCatalogReport } from '../src/ifood/catalog-check-cli.js';

/** Importar não autentica, não habilita mutações nem prepara carrinhos. */
export const preparationInputSchema = z.object({ proposal: PreliminaryProposalSchema,
  accountScope: z.string().regex(/^[a-f0-9]{64}$/), moneyUnit: z.enum(['BRL', 'cents']),
  discountPolicy: z.enum(['block_unattributed', 'proportional_items', 'proportional_unattributed_adjustment']),
}).strict();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    const args = process.argv.slice(2);
    if (args.length !== 8 || args[0] !== '--proposal' || args[2] !== '--journal' || args[4] !== '--report' || args[6] !== '--env') throw new Error('Argumentos inválidos.');
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Autorização presencial no terminal necessária.');
    const input = preparationInputSchema.parse(JSON.parse(await readFile(resolve(args[1]!), 'utf8')));
    const journal = await createPrivateCartJournal(resolve(args[3]!));
    loadEnv({ path: resolve(args[7]!), quiet: true });
    const config = readIfoodMcpConfig();
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const challenge = `PREPARAR ${digest.slice(0, 16)}`;
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try {
      console.info(`Preparação de ${new Set(input.proposal.items.map(i => i.storeId)).size} carrinho(s). Isso altera a conta; não compra nem configura pagamento. Totais serão revisados depois.`);
      answer = await terminal.question(`O operador local representa o organizador desta demonstração. Para autorizar esta composição exata, digite ${challenge}: `);
    } finally { terminal.close(); }
    if (answer !== challenge) throw new Error('Preparação não autorizada.');
    // A capacidade de mutação só é habilitada após a confirmação presencial vinculada ao artefato.
    const client = createIfoodMcpClient(config, { allowCartMutations: true, allowPaymentConfiguration: false });
    const output = await openPrivateCatalogReport(resolve(args[5]!));
    let result: unknown; let failed = false;
    try {
      await client.connect(); await client.listTools();
      const user = z.object({ success: z.literal(true), data: z.object({ email: z.string().min(1) }) }).parse(catalogDocument(await client.callReadTool('getUser', {})));
      const scope = createHash('sha256').update(user.data.email).digest('hex');
      if (scope !== input.accountScope) throw new Error('Conta divergiu da proposta.');
      const authority = createPreparationAuthority();
      const port = createIfoodCommercialPreparation(client, { authority, journal, authenticatedUserId: scope, moneyUnit: input.moneyUnit });
      const review = await prepareCommercialProposal(input.proposal, input.proposal.organizerId, scope, authority, port, input.discountPolicy);
      result = review;
      if (review.status !== 'review_required') failed = true;
    } catch { failed = true; }
    finally {
      await client.close().catch(() => { failed = true; });
      try { await output.writeFile(JSON.stringify({ failed, preparationFingerprint: digest, result, purchaseSubmitted: false }, null, 2)); }
      finally { await output.close(); }
    }
    console.info(failed ? 'Preparação não concluída. Não repetir criação ambígua; consultar registro privado.' : 'Resultado comercial privado preparado. Conferir bloqueios e revisão antes de qualquer confirmação.');
    process.exitCode = failed ? 1 : 0;
  })().catch(() => { console.error('Preparação não iniciada ou autorização ausente. Dados omitidos.'); process.exitCode = 1; });
}
