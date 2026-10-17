/**
 * Avaliação manual do prompt de coleta. Roda os casos de CASOS_COLETA no
 * provedor configurado (.env: AI_PROVIDER, AI_BASE_URL, AI_MODEL, AI_API_KEY)
 * e mostra taxa de acerto e latência. Fora do npm test: chama rede e gasta tokens.
 *
 * Uso: npm run avaliar:coleta
 */
import { config } from 'dotenv';
import { CASOS_COLETA, avaliarCaso } from '../src/core/fakes/casos-coleta.js';
import type { LlmCallRecord } from '../src/core/llm.js';
import { criarLlmDoAmbiente, temProvedorReal } from '../src/core/llm-ambiente.js';

config({ quiet: true });

const provider = process.env.AI_PROVIDER || 'fake';
if (provider !== 'fake' && !temProvedorReal(process.env)) {
  console.warn(`Aviso: AI_PROVIDER=${provider} sem AI_API_KEY; as chamadas devem falhar com 401.\n`);
}
const llm = criarLlmDoAmbiente(process.env);
const modelo = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '—';

console.log(`Avaliando ${CASOS_COLETA.length} casos de coleta · provedor: ${provider} · modelo fast: ${modelo}\n`);

const chamadas: LlmCallRecord[] = [];
const latenciaPorMensagem: number[] = [];
let acertos = 0;

for (const caso of CASOS_COLETA) {
  const antes = chamadas.length;
  const inicio = performance.now();
  const { result, preferences, falhas } = await avaliarCaso(caso, llm, (r) => chamadas.push(r));
  const duracao = performance.now() - inicio;
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
const falhasModelo = chamadas.filter((c) => !c.ok);

console.log(`\nTaxa de acerto: ${acertos}/${CASOS_COLETA.length} (${Math.round((acertos / CASOS_COLETA.length) * 100)}%)`);
console.log(`Latência por mensagem: média ${Math.round(media)} ms · p95 ${Math.round(p95)} ms (inclui novas tentativas)`);
console.log(`Chamadas ao modelo: ${chamadas.length} (${falhasModelo.length} tentativas falharam)`);
for (const falha of falhasModelo) console.log(`  tentativa ${falha.attempt} falhou: ${falha.error ?? ''}`);

if (acertos < CASOS_COLETA.length) process.exitCode = 1;
