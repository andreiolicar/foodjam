import type { IfoodMcpTool } from './client.js';
import { diagnosticError, reportDiagnostic } from './diagnostics.js';
import type { DiagnosticListener } from './diagnostics.js';
import type { IfoodMcpToolResult } from './tool-validation.js';

export type IfoodMcpCartReadToolName = 'getCart' | 'getCartDeliveryMethods';
export type IfoodMcpCartMutationToolName = 'createCart' | 'addItemToCart'
  | 'updateCartItem' | 'removeItemFromCart' | 'setCartDelivery';
export type IfoodMcpCartToolName = IfoodMcpCartReadToolName | IfoodMcpCartMutationToolName;
export type IfoodMcpCartResult = IfoodMcpToolResult;

// Política local fechada. Metadados do servidor nunca concedem permissão.
const readNames = new Set<string>(['getCart', 'getCartDeliveryMethods']);
const mutationNames = new Set<string>([
  'createCart', 'addItemToCart', 'updateCartItem', 'removeItemFromCart', 'setCartDelivery',
]);

export function assertApprovedCartTool(name: string, allowMutations: boolean): asserts name is IfoodMcpCartToolName {
  if (!readNames.has(name) && !mutationNames.has(name)) {
    throw diagnosticError('tools_cart', undefined, { reason: 'cart_tool_not_allowed' });
  }
  if (mutationNames.has(name) && allowMutations !== true) {
    throw diagnosticError('tools_cart', undefined, { reason: 'cart_mutations_disabled' });
  }
}

export function findCartTool(name: IfoodMcpCartToolName, catalog: readonly IfoodMcpTool[], onDiagnostic?: DiagnosticListener): IfoodMcpTool {
  const matches = catalog.filter((tool) => tool.name === name);
  if (matches.length === 0) throw diagnosticError('tools_cart', undefined, { reason: 'cart_tool_not_found' });
  if (matches.length !== 1) throw diagnosticError('tools_cart', undefined, { reason: 'cart_catalog_ambiguous' });
  const tool = matches[0]!;
  // Annotations são dicas, não autorização nem fonte da classificação local.
  // Registra somente um evento fixo; nunca copia metadados brutos do servidor.
  if (tool.annotations && typeof tool.annotations === 'object' && 'readOnlyHint' in tool.annotations
    && typeof tool.annotations.readOnlyHint === 'boolean' && tool.annotations.readOnlyHint !== readNames.has(name)) {
    reportDiagnostic(onDiagnostic, { stage: 'tools_cart', event: 'annotation_mismatch' });
  }
  return tool;
}
