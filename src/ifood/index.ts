// API de conexão e descoberta. Importar não abre conexões.
export { createIfoodMcpClient } from './client.js';
export type { IfoodMcpClient, IfoodMcpClientOptions, IfoodMcpServer, IfoodMcpTool } from './client.js';
export { readIfoodMcpConfig } from './config.js';
export type { IfoodMcpConfig } from './config.js';
export type { IfoodMcpDiagnostic, IfoodMcpStage, DiagnosticListener } from './diagnostics.js';
export type { IfoodMcpReadResult } from './read-tools.js';
export type { IfoodMcpCartResult, IfoodMcpCartToolName, IfoodMcpCartReadToolName, IfoodMcpCartMutationToolName } from './cart-tools.js';
export type { IfoodMcpPaymentOrderResult, IfoodMcpPaymentOrderToolName, IfoodMcpPaymentOrderReadToolName } from './payment-order-tools.js';
export { createIfoodCatalog } from './catalog.js';
export type { IfoodCatalogOptions } from './catalog.js';
export { IfoodCatalogError } from './catalog-data.js';
export type { IfoodCatalogErrorReason } from './catalog-data.js';

export { createIfoodDiscoveryCatalog } from './discovery.js';
export { createIfoodCommercialPreparation } from './commercial.js';
export type { CartJournal } from './commercial.js';
export { createPrivateCartJournal } from './cart-journal.js';
export { readIfoodCart } from './cart-observation.js';
