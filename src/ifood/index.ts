// API de conexão e descoberta. Importar não abre conexões.
export { createIfoodMcpClient } from './client.js';
export type { IfoodMcpClient, IfoodMcpServer, IfoodMcpTool } from './client.js';
export { readIfoodMcpConfig } from './config.js';
export type { IfoodMcpConfig } from './config.js';
export type { IfoodMcpDiagnostic, IfoodMcpStage, DiagnosticListener } from './diagnostics.js';
export type { IfoodMcpReadResult } from './read-tools.js';
