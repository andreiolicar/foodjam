/**
 * Avaliação manual do prompt de coleta. Roda os casos de CASOS_COLETA no
 * provedor configurado (.env: AI_PROVIDER, AI_BASE_URL, AI_MODEL, AI_API_KEY)
 * e mostra taxa de acerto e latência. Fora do npm test: chama rede.
 *
 * Uso:
 *   npm run avaliar:coleta
 *   npm run avaliar:coleta -- --intervalo 4000      # ms entre chamadas (camadas gratuitas)
 *   npm run avaliar:coleta -- --max-chamadas 10     # para ao atingir o limite
 *
 * Antes de começar, mostra quantas chamadas estão previstas. Para no primeiro
 * erro fatal do provedor (chave, plano ou cota) e mostra a mensagem dele.
 * 429 por minuto e 503 são tratados no adaptador (espera e repete); essas
 * repetições internas não entram na contagem de --max-chamadas.
 */
import { config } from 'dotenv';
import { passaNoFiltro } from '../src/core/coleta.js';
import { CASOS_COLETA, avaliarCaso, chamadasPrevistas } from '../src/core/fakes/casos-coleta.js';
import type { LlmCallRecord } from '../src/core/llm.js';
import { criarLlmDoAmbiente, temProvedorReal } from '../src/core/llm-ambiente.js';
import type { LlmPort } from '../src/core/ports.js';

config({ quiet: true });

/** Lê "--nome 10" ou "--nome=10"; sem a opção, usa a variável de ambiente (ou undefined). */
function lerNumero(argv: readonly string[], nome: string, variavel: string): number | undefined {
  const i = argv.findIndex((a) => a === `--${nome}` || a.startsWith(`--${nome}=`));
  const valor = i < 0 ? process.env[variavel] : argv[i]?.includes('=') ? argv[i]?.split('=')[1] : argv[i + 1];
  if (valor === undefined || valor === '') return undefined;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${nome} inválido: ${valor}`);
  return n;
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

const LIMITE = 'limite de --max-chamadas atingido';

/** Conta as chamadas e recusa (como erro fatal, sem chamar o provedor) acima do limite. */
function limitar(llm: LlmPort, max: number | undefined): LlmPort & { feitas: number } {
  return {
    feitas: 0,
    async generate(request) {
      if (max !== undefined && this.feitas >= max) {
        throw Object.assign(new Error(`${LIMITE} (${max})`), { fatal: true });
      }
      this.feitas++;
      return llm.generate(request);
    },
  };
}

const argv = process.argv.slice(2);
const intervaloMs = lerNumero(argv, 'intervalo', 'AVAL_INTERVALO_MS') ?? 0;
const maxChamadas = lerNumero(argv, 'max-chamadas', 'AVAL_MAX_CHAMADAS');
const provider = process.env.AI_PROVIDER || 'fake';
if (provider !== 'fake' && !temProvedorReal(process.env)) {
  console.warn(`Aviso: AI_PROVIDER=${provider} sem AI_API_KEY; as chamadas devem ser recusadas.\n`);
}
const espacado = espacar(criarLlmDoAmbiente(process.env), intervaloMs);
const llm = limitar(espacado, maxChamadas);
const modelo = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '—';

const previstas = chamadasPrevistas(CASOS_COLETA);
console.log(`Avaliando ${CASOS_COLETA.length} casos de coleta · provedor: ${provider} · modelo fast: ${modelo}`);
console.log(
  `Chamadas previstas: ${previstas} (até ${previstas * 2} com novas tentativas)` +
    ` · limite: ${maxChamadas ?? 'sem limite'} · intervalo: ${intervaloMs} ms` +
    (intervaloMs > 0 ? ` · duração mínima ~${Math.ceil((previstas * intervaloMs) / 1000)} s` : '') +
    '\n',
);

const chamadas: LlmCallRecord[] = [];
const latenciaPorMensagem: number[] = [];
let acertos = 0;
let avaliados = 0;

for (const caso of CASOS_COLETA) {
  const doCaso = caso.mensagens.filter((m) => passaNoFiltro(m.trim())).length;
  if (maxChamadas !== undefined && llm.feitas + doCaso > maxChamadas) {
    console.log(`\n⏸ Limite de ${maxChamadas} chamadas: parei antes de "${caso.mensagens.join(' ⟶ ')}".`);
    break;
  }

  const antes = chamadas.length;
  const esperaAntes = espacado.esperadoMs;
  const inicio = performance.now();
  const { result, preferences, falhas } = await avaliarCaso(caso, llm, (r) => chamadas.push(r));
  const duracao = performance.now() - inicio - (espacado.esperadoMs - esperaAntes);

  const fatal = chamadas.slice(antes).find((c) => c.fatal);
  if (fatal?.error?.includes(LIMITE)) {
    console.log(`\n⏸ Limite de ${maxChamadas} chamadas atingido em "${caso.mensagens.join(' ⟶ ')}" (novas tentativas). Caso não contado.`);
    break;
  }
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

console.log(
  `\nTaxa de acerto: ${acertos}/${avaliados} avaliados (${Math.round((acertos / Math.max(1, avaliados)) * 100)}%)` +
    (avaliados < CASOS_COLETA.length ? ` · ${CASOS_COLETA.length - avaliados} não avaliados` : ''),
);
console.log(`Latência por mensagem: média ${Math.round(media)} ms · p95 ${Math.round(p95)} ms (sem o intervalo; inclui novas tentativas)`);
console.log(`Chamadas ao modelo: ${llm.feitas} de ${previstas} previstas (${falhasModelo.length} tentativas falharam)`);
// Erros iguais aparecem uma vez só.
const porErro = new Map<string, number>();
for (const c of falhasModelo) porErro.set(c.error ?? '', (porErro.get(c.error ?? '') ?? 0) + 1);
for (const [erro, vezes] of porErro) console.log(`  ${vezes}× ${erro}`);

if (process.exitCode === undefined && acertos < CASOS_COLETA.length) process.exitCode = 1;
