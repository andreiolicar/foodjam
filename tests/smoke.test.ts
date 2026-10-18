import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('bootstrap do foodjam', () => {
  // Importar um módulo transforma todos os arquivos dele; com a suíte inteira em
  // paralelo isso pode passar dos 5 s padrão do Vitest. O módulo telegram carrega
  // o grammY e já passou de 15 s sob carga, então o limite é 30 s.
  it.each([
    ['telegram', () => import('../src/telegram/index.js')],
    ['core', () => import('../src/core/index.js')],
    ['ifood', () => import('../src/ifood/index.js')],
  ] as const)('permite importar o módulo %s', async (_name, importModule) => {
    await expect(importModule()).resolves.toBeTypeOf('object');
  }, 30_000);

  it('executa o ponto de entrada sem arquivo .env ou credenciais', () => {
    const directory = mkdtempSync(join(tmpdir(), 'foodjam-smoke-'));

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

      expect(output.trim()).toBe('foodjam: bootstrap inicializado.');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
