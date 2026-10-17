import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('bootstrap da Íris', () => {
  it.each([
    ['telegram', () => import('../src/telegram/index.js')],
    ['core', () => import('../src/core/index.js')],
    ['ifood', () => import('../src/ifood/index.js')],
  ] as const)('permite importar o módulo %s', async (_name, importModule) => {
    await expect(importModule()).resolves.toBeTypeOf('object');
  });

  it('executa o ponto de entrada sem arquivo .env ou credenciais', () => {
    const directory = mkdtempSync(join(tmpdir(), 'iris-smoke-'));

    try {
      const output = execFileSync(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          fileURLToPath(new URL('../src/index.ts', import.meta.url)),
        ],
        {
          cwd: directory,
          env: {},
          encoding: 'utf8',
          timeout: 10_000,
        },
      );

      expect(output.trim()).toBe('Íris: bootstrap inicializado.');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
