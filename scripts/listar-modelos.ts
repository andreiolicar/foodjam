/**
 * Lista os modelos do provedor configurado (GET {AI_BASE_URL}/models com a
 * AI_API_KEY do .env), com os campos e limites que o provedor informar, para
 * escolher AI_MODEL com o nome exato. Faz uma única chamada.
 *
 * Uso: npm run listar:modelos
 */
import { config } from 'dotenv';
import { consultarModelos } from '../src/core/llm-openai.js';

config({ quiet: true });

const baseUrl = process.env.AI_BASE_URL?.trim();
const apiKey = process.env.AI_API_KEY?.trim();

if (!baseUrl) {
  console.error('Defina AI_BASE_URL no .env (ex.: https://api.groq.com/openai/v1).');
  process.exit(1);
}
if (!apiKey) console.warn('Aviso: AI_API_KEY vazia; o provedor pode recusar a listagem.\n');

try {
  const { modelos, limites } = await consultarModelos({ baseUrl, ...(apiKey && { apiKey }) });
  console.log(`${modelos.length} modelo(s) em ${baseUrl}/models:\n`);

  const temDetalhes = modelos.some((m) => m.ownedBy || m.contextWindow || m.maxCompletionTokens || m.active === false);
  if (temDetalhes) {
    console.table(
      modelos.map((m) => ({
        id: m.id,
        dono: m.ownedBy ?? '',
        contexto: m.contextWindow ?? '',
        'max saída': m.maxCompletionTokens ?? '',
        ativo: m.active === undefined ? '' : m.active ? 'sim' : 'não',
      })),
    );
  } else {
    for (const m of modelos) console.log(`  ${m.id}`);
  }

  const nomes = Object.keys(limites);
  console.log(
    nomes.length > 0
      ? `\nLimites informados nesta resposta:\n${nomes.map((n) => `  ${n}: ${limites[n]}`).join('\n')}`
      : '\nO provedor não informou limites nesta resposta (eles costumam vir nas respostas de /chat/completions).',
  );
  console.log('\nCopie o id exato para AI_MODEL (ou AI_MODEL_FAST / AI_MODEL_CAPABLE) no .env.');
} catch (error) {
  console.error(`Não foi possível listar os modelos: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
