import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('importa API e CLI sem ambiente, rede, listener, processo ou saída automática', () => {
  const api = fileURLToPath(new URL('../../src/ifood/index.ts', import.meta.url));
  const cli = fileURLToPath(new URL('../../src/ifood/cli.ts', import.meta.url));
  const readCli = fileURLToPath(new URL('../../src/ifood/read-cli.ts', import.meta.url));
  const cartCli = fileURLToPath(new URL('../../src/ifood/cart-cli.ts', import.meta.url));
  const smokeSetup = fileURLToPath(new URL('../../src/ifood/smoke-setup.ts', import.meta.url));
  const smokePreflight = fileURLToPath(new URL('../../src/ifood/smoke-preflight.ts', import.meta.url));
  const paymentOrderReadCli = fileURLToPath(new URL('../../src/ifood/payment-order-read-cli.ts', import.meta.url));
  const catalogCheckCli = fileURLToPath(new URL('../../src/ifood/catalog-check-cli.ts', import.meta.url));
  const integrationRead = fileURLToPath(new URL('../../scripts/integracao-ifood.ts', import.meta.url));
  const preparation = fileURLToPath(new URL('../../scripts/preparar-ifood.ts', import.meta.url));
  const demo = fileURLToPath(new URL('../../scripts/demo-ifood.ts', import.meta.url));
  const telegram = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
  const composition = fileURLToPath(new URL('../../src/app.ts', import.meta.url));
  const script = `
    import http from 'node:http';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const unexpected = () => { throw new Error('Efeito colateral durante importação'); };
    globalThis.fetch = unexpected;
    http.createServer = unexpected;
    childProcess.execFile = unexpected;
    syncBuiltinESMExports();
    const api = await import(pathToFileURL(process.argv[1]).href);
    await import(pathToFileURL(process.argv[2]).href);
    await import(pathToFileURL(process.argv[3]).href);
    await import(pathToFileURL(process.argv[4]).href);
    await import(pathToFileURL(process.argv[5]).href);
    await import(pathToFileURL(process.argv[6]).href);
    await import(pathToFileURL(process.argv[7]).href);
    await import(pathToFileURL(process.argv[8]).href);
    await import(pathToFileURL(process.argv[9]).href);
    await import(pathToFileURL(process.argv[10]).href);
    await import(pathToFileURL(process.argv[11]).href);
    await import(pathToFileURL(process.argv[12]).href);
    await import(pathToFileURL(process.argv[13]).href);
    console.log(Object.keys(api).sort().join(','));
  `;
  const output = execFileSync(process.execPath, [
    '--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script, api, cli, readCli, cartCli, smokeSetup, smokePreflight, paymentOrderReadCli, catalogCheckCli, integrationRead, preparation, demo, telegram, composition,
  ], { env: {}, encoding: 'utf8', timeout: 10_000 });
  expect(output.trim()).toBe('IfoodCatalogError,createIfoodCatalog,createIfoodCommercialPreparation,createIfoodDiscoveryCatalog,createIfoodMcpClient,createPrivateCartJournal,readIfoodCart,readIfoodMcpConfig');
});
