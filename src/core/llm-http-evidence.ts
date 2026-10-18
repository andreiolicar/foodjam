import { tempoDeEspera } from './llm-openai.js';

export function rateEvidence(status: number, headers: Headers, body: string) {
  // Apenas enums e números: nunca guardar mensagem, headers arbitrários ou IDs da organização.
  const dimension = /tokens per minute|\bTPM\b/i.test(body) ? 'tokens_per_minute'
    : /requests per minute|\bRPM\b/i.test(body) ? 'requests_per_minute'
      : /tokens per day|\bTPD\b/i.test(body) ? 'tokens_per_day'
        : /requests per day|\bRPD\b/i.test(body) ? 'requests_per_day'
          : /insufficient_quota|billing|payment|credit/i.test(body) ? 'quota' : 'unknown';
  const number = (key: string) => { const raw = headers.get(key); return raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined; };
  const wait = tempoDeEspera(headers, body);
  return { status, dimension, retryAfterMs: Number.isSafeInteger(wait) && wait! >= 0 && wait! <= 86400000 ? wait : undefined,
    remainingRequestsPerDay: number('x-ratelimit-remaining-requests'), remainingTokensPerMinute: number('x-ratelimit-remaining-tokens'),
    limitRequestsPerDay: number('x-ratelimit-limit-requests'), limitTokensPerMinute: number('x-ratelimit-limit-tokens') };
}
