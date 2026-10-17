import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import type { IfoodMcpTool } from './client.js';
import { diagnosticError } from './diagnostics.js';

/** Nomes exatos confirmados pelo responsável na descoberta real da IF-01. */
const approvedNames = new Set([
  'getUser', 'listAddresses', 'browseOffers', 'searchOffers',
  'getRecommendations', 'getMerchant', 'getItem',
]);

/** Conteúdo MCP opaco: não presume domínio, dados pessoais ou sucesso comercial. */
export interface IfoodMcpReadResult {
  content: { type: string; [field: string]: unknown }[];
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
  [metadata: string]: unknown;
}

export function assertApprovedReadTool(name: string): void {
  if (!approvedNames.has(name)) throw diagnosticError('tools_read', undefined, { reason: 'read_tool_not_allowed' });
}

export function findReadTool(name: string, catalog: readonly IfoodMcpTool[]): IfoodMcpTool {
  assertApprovedReadTool(name);
  const matches = catalog.filter((tool) => tool.name === name);
  if (matches.length === 0) throw diagnosticError('tools_read', undefined, { reason: 'read_tool_not_found' });
  if (matches.length !== 1) throw diagnosticError('tools_read', undefined, { reason: 'read_catalog_ambiguous' });
  const tool = matches[0]!;
  if (tool.annotations && typeof tool.annotations === 'object' && 'readOnlyHint' in tool.annotations
    && tool.annotations.readOnlyHint === false) {
    throw diagnosticError('tools_read', undefined, { reason: 'read_tool_write_hint' });
  }
  return tool;
}

/** Rejeita valores que JSON alteraria silenciosamente, antes de validar/enviar. */
export function snapshotReadArguments(args: Record<string, unknown>): Record<string, unknown> {
  const parents = new WeakSet<object>();
  const inspect = (value: unknown): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object' || parents.has(value)) throw new Error('JSON inválido.');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Objeto não JSON.');
    parents.add(value);
    if (Array.isArray(value)) for (const item of value) inspect(item);
    else for (const item of Object.values(value)) inspect(item);
    parents.delete(value);
  };
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos não são objeto.');
    inspect(args);
    return JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
  } catch {
    throw diagnosticError('tools_read', undefined, { reason: 'read_arguments_invalid' });
  }
}

export function validateReadSchema(schema: Record<string, unknown>, value: unknown, target: 'input' | 'output') {
  let valid: boolean;
  try {
    // Instância isolada evita colisões de $id entre schemas/ferramentas.
    const validator = new AjvJsonSchemaValidator().getValidator(schema as JsonSchemaType);
    valid = validator(value).valid;
  } catch {
    // Nunca expor errorMessage do validador: pode conter argumentos/respostas.
    throw diagnosticError('tools_read', undefined, { reason: 'read_schema_invalid' });
  }
  if (!valid) throw diagnosticError('tools_read', undefined, {
    reason: target === 'input' ? 'read_arguments_invalid' : 'read_result_invalid',
  });
}

export function validateReadResult(tool: IfoodMcpTool, result: unknown): IfoodMcpReadResult {
  if (!result || typeof result !== 'object' || !('content' in result) || !Array.isArray(result.content)
    || !CallToolResultSchema.safeParse(result).success) {
    throw diagnosticError('tools_read', undefined, { reason: 'read_result_invalid' });
  }
  const checked = result as IfoodMcpReadResult;
  // O SDK guarda outputSchemas da última página. Conferir o catálogo completo
  // também cobre ferramentas descobertas em páginas anteriores.
  if (!checked.isError && tool.outputSchema && typeof tool.outputSchema === 'object') {
    validateReadSchema(tool.outputSchema as Record<string, unknown>, checked.structuredContent, 'output');
  }
  return checked;
}
