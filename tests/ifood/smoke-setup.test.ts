import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../src/ifood/smoke-setup.ts', import.meta.url));
const merchantId = '5443791a-6f3a-481a-9a60-9fa6bbfc2dd4';
const itemId = '18409df3-1e16-4bf8-9be5-433882c049aa';
const addressId = '2831b708-f518-4e4e-955e-19c0d70f6214'; // Fixture, não endereço real.

function fixtureDatabase(path: string, withCreation: boolean) {
  const records = [
    ...(withCreation ? [{ tool: 'ifood_createCart', state: { status: 'completed', input: {
      merchantId, addressId, items: [{ itemId, quantity: 3, options: [{ optionId: 'private-option' }] }], paymentMethod: { cardTokenId: 'private-token' },
    }, output: 'private-output' } }] : []),
    { tool: 'ifood_getMerchant', state: { status: 'completed', input: { merchantId, userLocation: { latitude: -20, longitude: -40 } } } },
    { tool: 'ifood_getItem', state: { status: 'completed', input: { merchantId, itemId, userLocation: { latitude: -20, longitude: -40 } } } },
  ];
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `
import { DatabaseSync } from 'node:sqlite';
const database = new DatabaseSync(process.argv[1]);
database.exec('CREATE TABLE part(session_id TEXT,time_created INTEGER,data TEXT)');
const insert = database.prepare('INSERT INTO part VALUES(?,?,?)');
JSON.parse(process.argv[2]).forEach((record, index) => insert.run('fixture-session', index, JSON.stringify(record)));
database.close();
`, path, JSON.stringify(records)], { stdio: 'pipe' });
}

describe('preparação local a partir do registro anterior', () => {
  it('recupera endereço privadamente, prepara um produto quantidade 1 e omite opções/pagamento', () => {
    const root = mkdtempSync(join(tmpdir(), 'foodjam-smoke-setup-'));
    try {
      const database = join(root, 'fixture.db');
      fixtureDatabase(database, true);
      const before = readFileSync(database);
      const output = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', import.meta.resolve('tsx'), script, '--database', database, '--out-dir', join(root, 'args')], { encoding: 'utf8', stdio: 'pipe' });
      expect(JSON.parse(readFileSync(join(root, 'args/ifood-smoke-create.json'), 'utf8'))).toEqual({ merchantId, addressId, items: [{ itemId, quantity: 1 }] });
      expect(JSON.parse(readFileSync(join(root, 'args/ifood-smoke-preflight.json'), 'utf8'))).toEqual({
        addressId, merchantArgs: { merchantId, userLocation: { latitude: -20, longitude: -40 } },
        itemArgs: { merchantId, itemId, userLocation: { latitude: -20, longitude: -40 } },
      });
      expect(statSync(join(root, 'args/ifood-smoke-create.json')).mode & 0o777).toBe(0o600);
      expect(readFileSync(database)).toEqual(before);
      expect(output).not.toMatch(/private-|2831b708|-20|-40/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('registro ausente não fabrica endereço nem prepara uma criação', () => {
    const root = mkdtempSync(join(tmpdir(), 'foodjam-smoke-missing-'));
    try {
      const database = join(root, 'fixture.db');
      fixtureDatabase(database, false);
      expect(() => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', import.meta.resolve('tsx'), script, '--database', database, '--out-dir', join(root, 'args')], { stdio: 'pipe' })).toThrow();
      expect(existsSync(join(root, 'args/ifood-smoke-create.json'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
