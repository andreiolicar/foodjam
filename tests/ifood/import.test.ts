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
    console.log(Object.keys(api).sort().join(','));
  `;
  const output = execFileSync(process.execPath, [
    '--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script, api, cli, readCli, cartCli, smokeSetup, smokePreflight, paymentOrderReadCli,
  ], { env: {}, encoding: 'utf8', timeout: 10_000 });
  expect(output.trim()).toBe('createIfoodMcpClient,readIfoodMcpConfig');
});
