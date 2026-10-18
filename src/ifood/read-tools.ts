import type { IfoodMcpTool } from './client.js';
import { diagnosticError } from './diagnostics.js';

/** Nomes exatos confirmados pelo responsável na descoberta real da IF-01. */
const approvedNames = new Set([
  'getUser', 'listAddresses', 'browseOffers', 'searchOffers',
  'getRecommendations', 'getMerchant', 'getItem',
]);

// Compatibilidade da IF-02; a IF-03 reutiliza a mesma validação.
export type { IfoodMcpToolResult as IfoodMcpReadResult } from './tool-validation.js';
export {
  snapshotToolArguments as snapshotReadArguments,
  validateToolSchema as validateReadSchema,
  validateToolResult as validateReadResult,
} from './tool-validation.js';

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
