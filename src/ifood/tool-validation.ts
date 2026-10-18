import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import type { IfoodMcpTool } from './client.js';
import { diagnosticError } from './diagnostics.js';

type Operation = 'read' | 'cart' | 'payment_order';
const stage = (operation: Operation) => `tools_${operation}` as const;

/** Conteúdo MCP opaco, preservado sem conversões de domínio ou finanças. */
export interface IfoodMcpToolResult {
  content: { type: string; [field: string]: unknown }[];
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
  [metadata: string]: unknown;
}

/** Rejeita valores que JSON alteraria silenciosamente, antes de validar/enviar. */
export function snapshotToolArguments(args: Record<string, unknown>, operation: Operation = 'read'): Record<string, unknown> {
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
    throw diagnosticError(stage(operation), undefined, { reason: `${operation}_arguments_invalid` });
  }
}

export function validateToolSchema(schema: Record<string, unknown>, value: unknown, target: 'input' | 'output', operation: Operation = 'read') {
  let valid: boolean;
  try {
    // Instância isolada evita colisões de $id entre schemas/ferramentas.
    const validator = new AjvJsonSchemaValidator().getValidator(schema as JsonSchemaType);
    valid = validator(value).valid;
  } catch {
    // Nunca expor errorMessage do validador: pode conter argumentos/respostas.
    throw diagnosticError(stage(operation), undefined, { reason: `${operation}_schema_invalid` });
  }
  if (!valid) throw diagnosticError(stage(operation), undefined, {
    reason: target === 'input' ? `${operation}_arguments_invalid` : `${operation}_result_invalid`,
  });
}

export function validateToolResult(tool: IfoodMcpTool, result: unknown, operation: Operation = 'read'): IfoodMcpToolResult {
  if (!result || typeof result !== 'object' || !('content' in result) || !Array.isArray(result.content)
    || !CallToolResultSchema.safeParse(result).success) {
    throw diagnosticError(stage(operation), undefined, { reason: `${operation}_result_invalid` });
  }
  const checked = result as IfoodMcpToolResult;
  // O SDK guarda outputSchemas da última página. Conferir o catálogo completo
  // também cobre ferramentas descobertas em páginas anteriores.
  if (!checked.isError && tool.outputSchema && typeof tool.outputSchema === 'object') {
    validateToolSchema(tool.outputSchema as Record<string, unknown>, checked.structuredContent, 'output', operation);
  }
  return checked;
}
