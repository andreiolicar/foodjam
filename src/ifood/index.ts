// API de conexão e descoberta. Importar não abre conexões.
export { createIfoodMcpClient } from './client.js';
export type { IfoodMcpClient, IfoodMcpClientOptions, IfoodMcpServer, IfoodMcpTool } from './client.js';
export { readIfoodMcpConfig } from './config.js';
export type { IfoodMcpConfig } from './config.js';
export type { IfoodMcpDiagnostic, IfoodMcpStage, DiagnosticListener } from './diagnostics.js';
export type { IfoodMcpReadResult } from './read-tools.js';
export type { IfoodMcpCartResult, IfoodMcpCartToolName, IfoodMcpCartReadToolName, IfoodMcpCartMutationToolName } from './cart-tools.js';
export type { IfoodMcpPaymentOrderResult, IfoodMcpPaymentOrderToolName, IfoodMcpPaymentOrderReadToolName } from './payment-order-tools.js';
