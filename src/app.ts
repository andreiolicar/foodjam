import { criarAgenteDescoberta, temProvedorReal } from './core/index.js';
import { criarLlmObservado } from './core/llm-runtime.js';
import { criarBot } from './telegram/index.js';
import { createIfoodMcpClient, createIfoodDiscoveryCatalog, readIfoodMcpConfig } from './ifood/index.js';
import { discoveryLimits } from './core/discovery-search.js';
import type { DiscoveryCoverage } from './core/contracts.js';
import type { LlmCallRecord } from './core/llm.js';

/** Composição da aplicação real; importar não autentica nem inicia polling. */
export async function criarAplicacaoReal(env: NodeJS.ProcessEnv) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN obrigatório.');
  let groq = false;
  try { const url = new URL(env.AI_BASE_URL ?? ''); groq = url.hostname === 'api.groq.com' && url.protocol === 'https:'; } catch { /* Erro de configuração sanitizado abaixo. */ }
  if (!temProvedorReal(env) || env.AI_PROVIDER?.trim().toLowerCase() !== 'openai-compat'
    || !groq) throw new Error('A aplicação exige Groq real configurado; simulação desabilitada.');
  const unit = env.IFOOD_CATALOG_MONEY_UNIT;
  if (unit !== undefined && unit !== 'BRL' && unit !== 'cents') throw new Error('Unidade monetária não homologada.');
  const option = (name: string, fallback: number) => {
    if (env[name] === undefined) return fallback;
    if (!/^\d+$/.test(env[name]!)) throw new Error('Limite de descoberta inválido.');
    return Number(env[name]);
  };
  const limits = discoveryLimits({ maxSearchTerms: option('FOODJAM_DISCOVERY_MAX_TERMS', 4), maxStores: option('FOODJAM_DISCOVERY_MAX_STORES', 4), maxItemsPerStore: option('FOODJAM_DISCOVERY_ITEMS_PER_STORE', 12), maxItems: option('FOODJAM_DISCOVERY_MAX_ITEMS', 24), maxClassificationItems: option('FOODJAM_DISCOVERY_CLASSIFICATION_ITEMS', 8), maxRequests: option('FOODJAM_DISCOVERY_MAX_REQUESTS', 16), deadlineMs: option('FOODJAM_DISCOVERY_DEADLINE_MS', 45_000) });
  const maxPages = option('FOODJAM_DISCOVERY_MAX_PAGES', 2);
  const pageSize = option('FOODJAM_DISCOVERY_PAGE_SIZE', 12);
  if (maxPages < 1 || maxPages > 3 || pageSize < 1 || pageSize > 50) throw new Error('Paginação de descoberta inválida.');
  // Perfil operacional demonstrado por filtro BRL + getItem/getCart; somente unitPrice.
  const itemUnit = env.IFOOD_CATALOG_ITEM_MONEY_UNIT ?? unit ?? 'BRL';
  if (!['BRL', 'cents', 'unknown'].includes(itemUnit)) throw new Error('Perfil de preço unitário inválido.');
  const observation = criarLlmObservado(env, { onHttp: event => console.info('FoodJam IA:', JSON.stringify(event)) });
  const reads: { tool: string; ok: boolean }[] = [];
  const calls: Omit<LlmCallRecord, 'error'>[] = [];
  const discovery: { outcome: string; coverage: DiscoveryCoverage }[] = [];
  const client = createIfoodMcpClient(readIfoodMcpConfig(env), { allowCartMutations: false, allowPaymentConfiguration: false });
  try {
    await client.connect(); await client.listTools();
    const catalog = createIfoodDiscoveryCatalog({ async callReadTool(name, args, options) {
      const event = { tool: name, ok: false }; reads.push(event);
      const result = await client.callReadTool(name, args, options); event.ok = true; return result;
    } }, { maxPages, pageSize, allowTruncatedStoreSearch: true, ...(unit ? { moneyUnit: unit } : {}), itemMoneyUnit: itemUnit as 'BRL' | 'cents' | 'unknown' });
    const iris = criarAgenteDescoberta({ catalog, discoveryLimits: limits, llm: observation.llm, registrarDescoberta(event) {
      discovery.push(structuredClone(event)); console.info('FoodJam descoberta:', JSON.stringify(event));
    }, registrar(record) {
      const allowed = new Set(['pessoas', 'participantId', 'desejos', 'atende', 'substitutos', 'resultados', 'kind', 'wishes', 'foodPreferences', 'dietaryRestrictions', 'avoids', 'budgetText', 'clarification']);
      calls.push({ phase: record.phase, tier: record.tier, attempt: record.attempt, durationMs: record.durationMs, ok: record.ok,
        ...(record.fatal !== undefined ? { fatal: record.fatal } : {}), ...(record.failureKind ? { failureKind: record.failureKind } : {}),
        ...(record.validationIssues ? { validationIssues: record.validationIssues.map(issue => ({ code: issue.code, path: issue.path.map(key => typeof key === 'number' || allowed.has(key) ? key : 'other') })) } : {}),
      });
    } });
    const { bot, agrupador } = criarBot(token, iris, { preliminaryOnly: true, aoAutorizar() { throw new Error('Execução comercial bloqueada nesta composição.'); } });
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      try { if (bot.isRunning()) await bot.stop(); await agrupador.esvaziarTudo(); }
      finally { await client.close(); }
    })();
    console.info(`FoodJam fontes: catalog=ifood-mcp llm=groq cascade=${observation.providers.join(',')} modo=preliminar interface=grammy`);
    return { bot, agrupador, iris, close, diagnostico: () => structuredClone({ catalog: 'ifood-mcp', llm: 'groq', mode: 'preliminary', providers: observation.providers, reads, http: observation.http, switches: observation.switches, calls, discovery }) };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new Error('Não foi possível inicializar a integração real.', { cause: error });
  }
}
