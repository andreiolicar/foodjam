import type { RespostaOrcamento, SessionId } from '../../core/index.js';

// Botões do privado (endereço e orçamento) levam o sessionId do grupo no callback_data,
// porque no privado ctx.chat.id é o chat da pessoa, não o grupo.
// Formato: "<código>:<sessionId>". O Telegram limita callback_data a 64 bytes.

export type BotaoPrivado =
  | { tipo: 'endereco'; acao: 'confirmar' | 'outro'; sessionId: SessionId }
  | { tipo: 'orcamento'; resposta: RespostaOrcamento; sessionId: SessionId };

const ENDERECO = { confirmar: 'ec', outro: 'eo' } as const;

const ORCAMENTO = {
  aceito: 'oa',
  quero_outro: 'oq',
  aceito_sugestao: 'os',
  fico_sem: 'of',
} as const satisfies Record<RespostaOrcamento, string>;

const LIMITE_BYTES = 64;

/** Reconhece os callback_data dos botões do privado (para o filtro do handler). */
export const PADRAO_BOTAO_PRIVADO = /^(ec|eo|oa|oq|os|of):/;

function montar(codigo: string, sessionId: SessionId): string {
  const data = `${codigo}:${sessionId}`;
  if (Buffer.byteLength(data, 'utf8') > LIMITE_BYTES) {
    throw new Error(`callback_data passa de ${LIMITE_BYTES} bytes: ${data}`);
  }
  return data;
}

export function callbackEndereco(acao: 'confirmar' | 'outro', sessionId: SessionId): string {
  return montar(ENDERECO[acao], sessionId);
}

export function callbackOrcamento(resposta: RespostaOrcamento, sessionId: SessionId): string {
  return montar(ORCAMENTO[resposta], sessionId);
}

export function lerCallback(data: string): BotaoPrivado | undefined {
  const separador = data.indexOf(':');
  if (separador < 0) return undefined;

  const codigo = data.slice(0, separador);
  const sessionId = data.slice(separador + 1);
  if (sessionId.length === 0) return undefined;

  for (const [acao, valor] of Object.entries(ENDERECO)) {
    if (valor === codigo) return { tipo: 'endereco', acao: acao as 'confirmar' | 'outro', sessionId };
  }
  for (const [resposta, valor] of Object.entries(ORCAMENTO)) {
    if (valor === codigo) return { tipo: 'orcamento', resposta: resposta as RespostaOrcamento, sessionId };
  }
  return undefined;
}
