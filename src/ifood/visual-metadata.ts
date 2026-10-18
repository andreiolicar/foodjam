/** Origem observada nas inspeções MCP de 18/10/2026. Sem curingas ou redirects. */
export function validatedItemImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192 || value.trim() !== value || /[\s\\]/u.test(value) || [...value].some(c => c.charCodeAt(0) < 32)) return undefined;
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value)?.[1];
  if (!authority || authority.includes('@')) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.hostname !== 'static.ifood-static.com.br') return undefined;
    return value; // Preserva a query assinada, sem normalizar o valor recebido.
  } catch { return undefined; }
}

/** Formato comprovado: números JSON, sem coerção de strings/null/boolean. */
export function merchantReview(value: unknown): { reviewRating?: number; ratingCount?: number } {
  if (!value || typeof value !== 'object') return {};
  const { reviewRating, ratingCount } = value as Record<string, unknown>;
  return {
    ...(typeof reviewRating === 'number' && Number.isFinite(reviewRating) && reviewRating >= 0 && reviewRating <= 5 ? { reviewRating } : {}),
    ...(typeof ratingCount === 'number' && Number.isSafeInteger(ratingCount) && ratingCount >= 0 ? { ratingCount } : {}),
  };
}
