import { describe, expect, it } from 'vitest';

import {
  PADRAO_BOTAO_PRIVADO,
  callbackEndereco,
  callbackOrcamento,
  lerCallback,
} from '../../src/telegram/services/callbacks.js';

// Id de supergrupo do Telegram: negativo e com 13 dígitos.
const GRUPO = '-1001234567890';

describe('callback_data dos botões do privado', () => {
  it('ida e volta do endereço preserva ação e grupo', () => {
    for (const acao of ['confirmar', 'outro'] as const) {
      expect(lerCallback(callbackEndereco(acao, GRUPO))).toEqual({ tipo: 'endereco', acao, sessionId: GRUPO });
    }
  });

  it('ida e volta do orçamento preserva a resposta e o grupo', () => {
    for (const resposta of ['aceito', 'quero_outro', 'aceito_sugestao', 'fico_sem'] as const) {
      expect(lerCallback(callbackOrcamento(resposta, GRUPO))).toEqual({ tipo: 'orcamento', resposta, sessionId: GRUPO });
    }
  });

  it('cabe nos 64 bytes do Telegram e casa com o filtro do handler', () => {
    const data = callbackOrcamento('aceito_sugestao', GRUPO);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(PADRAO_BOTAO_PRIVADO.test(data)).toBe(true);
  });

  it('recusa sessionId que estoura o limite', () => {
    expect(() => callbackEndereco('confirmar', 'x'.repeat(70))).toThrow(/64 bytes/);
  });

  it('ignora dados desconhecidos ou incompletos', () => {
    expect(lerCallback('proposta:confirmar')).toBeUndefined();
    expect(lerCallback('ec:')).toBeUndefined();
    expect(lerCallback('sem-separador')).toBeUndefined();
    expect(PADRAO_BOTAO_PRIVADO.test('proposta:confirmar')).toBe(false);
  });
});
