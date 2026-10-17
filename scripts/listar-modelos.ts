/**
 * Lista os modelos do provedor configurado (GET {AI_BASE_URL}/models com a
 * AI_API_KEY do .env), para escolher AI_MODEL com o nome exato.
 *
 * Uso: npm run listar:modelos
 */
import { config } from 'dotenv';
import { listarModelos } from '../src/core/llm-openai.js';

config({ quiet: true });

const baseUrl = process.env.AI_BASE_URL?.trim();
const apiKey = process.env.AI_API_KEY?.trim();

if (!baseUrl) {
  console.error('Defina AI_BASE_URL no .env (ex.: https://opencode.ai/zen/v1).');
  process.exit(1);
}
if (!apiKey) console.warn('Aviso: AI_API_KEY vazia; o provedor pode recusar a listagem.\n');

try {
  const ids = await listarModelos({ baseUrl, ...(apiKey && { apiKey }) });
  console.log(`${ids.length} modelo(s) em ${baseUrl}/models:\n`);
  for (const id of ids) console.log(`  ${id}`);
  console.log('\nCopie o id exato para AI_MODEL (ou AI_MODEL_FAST / AI_MODEL_CAPABLE) no .env.');
} catch (error) {
  console.error(`Não foi possível listar os modelos: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
