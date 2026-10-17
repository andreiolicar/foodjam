/**
 * Avaliação manual do prompt de coleta. Roda os casos de CASOS_COLETA no
 * provedor configurado (.env: AI_PROVIDER, AI_BASE_URL, AI_MODEL, AI_API_KEY)
 * e mostra taxa de acerto e latência. Fora do npm test: chama rede.
 *
 * Uso:
 *   npm run avaliar:coleta
 *   npm run avaliar:coleta -- --intervalo 4000   # ms entre chamadas (camadas gratuitas)
 *
 * Para no primeiro erro fatal do provedor (chave, plano ou cota) e mostra a
 * mensagem dele. 429 de limite por minuto é tratado no adaptador (espera e repete).
 */
import { config } from 'dotenv';
import { CASOS_COLETA, avaliarCaso } from '../src/core/fakes/casos-coleta.js';
import type { LlmCallRecord } from '../src/core/llm.js';
import { criarLlmDoAmbiente, temProvedorReal } from '../src/core/llm-ambiente.js';
import type { LlmPort } from '../src/core/ports.js';

config({ quiet: true });

function lerIntervalo(argv: readonly string[]): number {
  const i = argv.findIndex((a) => a === '--intervalo' || a.startsWith('--intervalo='));
  if (i < 0) return Number(process.env.AVAL_INTERVALO_MS ?? 0);
  const valor = argv[i]?.includes('=') ? argv[i]?.split('=')[1] : argv[i + 1];
  const ms = Number(valor);
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`--intervalo inválido: ${String(valor)}`);
  return ms;
}

/**
 * Garante pelo menos `intervaloMs` entre o início de duas chamadas (inclui
 * novas tentativas) e soma o tempo esperado, para tirá-lo da latência.
 */
function espacar(llm: LlmPort, intervaloMs: number): LlmPort & { esperadoMs: number } {
  let ultima = 0;
  return {
    esperadoMs: 0,
    async generate(request) {
      const espera = ultima + intervaloMs - Date.now();
      if (espera > 0) {
        await new Promise((resolve) => setTimeout(resolve, espera));
        this.esperadoMs += espera;
      }
      ultima = Date.now();
      return llm.generate(request);
    },
  };
}

const intervaloMs = lerIntervalo(process.argv.slice(2));
const provider = process.env.AI_PROVIDER || 'fake';
if (provider !== 'fake' && !temProvedorReal(process.env)) {
  console.warn(`Aviso: AI_PROVIDER=${provider} sem AI_API_KEY; as chamadas devem ser recusadas.\n`);
}
const llm = espacar(criarLlmDoAmbiente(process.env), intervaloMs);
const modelo = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '—';

console.log(
  `Avaliando ${CASOS_COLETA.length} casos de coleta · provedor: ${provider} · modelo fast: ${modelo}` +
    ` · intervalo: ${intervaloMs} ms\n`,
);

const chamadas: LlmCallRecord[] = [];
const latenciaPorMensagem: number[] = [];
let acertos = 0;
let avaliados = 0;

for (const caso of CASOS_COLETA) {
  const antes = chamadas.length;
  const esperaAntes = llm.esperadoMs;
  const inicio = performance.now();
  const { result, preferences, falhas } = await avaliarCaso(caso, llm, (r) => chamadas.push(r));
  const duracao = performance.now() - inicio - (llm.esperadoMs - esperaAntes);

  const fatal = chamadas.slice(antes).find((c) => c.fatal);
  if (fatal) {
    console.log(`\n⛔ Erro fatal do provedor em "${caso.mensagens.join(' ⟶ ')}". Avaliação interrompida.`);
    console.log(`   ${fatal.error ?? ''}`);
    console.log('   Confira AI_API_KEY, AI_BASE_URL, AI_MODEL e o plano/cota da conta.');
    process.exitCode = 2;
    break;
  }

  avaliados++;
  const ok = falhas.length === 0;
  if (ok) acertos++;
  // Mensagens filtradas não chamam o modelo e não entram na média.
  if (chamadas.length > antes) latenciaPorMensagem.push(duracao / caso.mensagens.length);

  console.log(`${ok ? '✓' : '✗'} ${caso.mensagens.join('  ⟶  ')}  (${Math.round(duracao)} ms)`);
  console.log(
    `    ${result.outcome} · quer: [${preferences?.foodPreferences?.join(', ') ?? ''}]` +
      ` · restrições: [${preferences?.dietaryRestrictions?.join(', ') ?? ''}]` +
      ` · evita: [${preferences?.avoids?.join(', ') ?? ''}]` +
      ` · orçamento: ${preferences?.budgetCents ?? '—'}`,
  );
  for (const falha of falhas) console.log(`    ✗ ${falha}`);
}

const media = latenciaPorMensagem.reduce((a, b) => a + b, 0) / Math.max(1, latenciaPorMensagem.length);
const ordenadas = [...latenciaPorMensagem].sort((a, b) => a - b);
const p95 = ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * 0.95))] ?? 0;
const falhasModelo = chamadas.filter((c) => !c.ok && !c.fatal);

console.log(`\nTaxa de acerto: ${acertos}/${avaliados} avaliados (${Math.round((acertos / Math.max(1, avaliados)) * 100)}%)` +
  (avaliados < CASOS_COLETA.length ? ` · ${CASOS_COLETA.length - avaliados} não avaliados` : ''));
console.log(`Latência por mensagem: média ${Math.round(media)} ms · p95 ${Math.round(p95)} ms (sem o intervalo; inclui novas tentativas)`);
console.log(`Chamadas ao modelo: ${chamadas.length} (${falhasModelo.length} tentativas falharam)`);
// Erros iguais aparecem uma vez só.
const porErro = new Map<string, number>();
for (const c of falhasModelo) porErro.set(c.error ?? '', (porErro.get(c.error ?? '') ?? 0) + 1);
for (const [erro, vezes] of porErro) console.log(`  ${vezes}× ${erro}`);

if (process.exitCode === undefined && acertos < CASOS_COLETA.length) process.exitCode = 1;
