import type { IfoodMcpTool } from './client.js';
import { diagnosticError, reportDiagnostic } from './diagnostics.js';
import type { DiagnosticListener } from './diagnostics.js';
import type { IfoodMcpToolResult } from './tool-validation.js';

export type IfoodMcpPaymentOrderReadToolName = 'listPaymentMethods' | 'getOrder' | 'trackOrder';
export type IfoodMcpPaymentOrderToolName = IfoodMcpPaymentOrderReadToolName | 'setCartPayment';
export type IfoodMcpPaymentOrderResult = IfoodMcpToolResult;

// Classificação local explícita; schemas vêm de tools/list na conexão atual.
// listPaymentMethods e getOrder são leituras sensíveis. Nenhuma resposta é logada.
const readNames = new Set<string>(['listPaymentMethods', 'getOrder', 'trackOrder']);

export function assertApprovedPaymentOrderTool(name: string, allowPaymentConfiguration: boolean): asserts name is IfoodMcpPaymentOrderToolName {
  if (!readNames.has(name) && name !== 'setCartPayment') {
    throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_tool_not_allowed' });
  }
  if (name === 'setCartPayment' && allowPaymentConfiguration !== true) {
    throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_configuration_disabled' });
  }
}

/** Allowlist mais estreita para a CLI manual: nunca configura pagamento. */
export function assertApprovedPaymentOrderReadTool(name: string): asserts name is IfoodMcpPaymentOrderReadToolName {
  if (!readNames.has(name)) throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_tool_not_allowed' });
}

export function findPaymentOrderTool(name: IfoodMcpPaymentOrderToolName, catalog: readonly IfoodMcpTool[], onDiagnostic?: DiagnosticListener): IfoodMcpTool {
  const matches = catalog.filter((tool) => tool.name === name);
  if (matches.length === 0) throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_tool_not_found' });
  if (matches.length !== 1) throw diagnosticError('tools_payment_order', undefined, { reason: 'payment_order_catalog_ambiguous' });
  const tool = matches[0]!;
  // Annotations são dicas. Nunca autorizam mutações nem são copiadas para logs.
  if (tool.annotations && typeof tool.annotations === 'object' && 'readOnlyHint' in tool.annotations
    && typeof tool.annotations.readOnlyHint === 'boolean' && tool.annotations.readOnlyHint !== readNames.has(name)) {
    reportDiagnostic(onDiagnostic, { stage: 'tools_payment_order', event: 'annotation_mismatch' });
  }
  return tool;
}
