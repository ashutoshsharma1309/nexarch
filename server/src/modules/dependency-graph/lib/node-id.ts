/**
 * Centralized node-ID conventions. Every analyzer that emits an edge must
 * compute the same ID for the same logical node, so IDs are generated here
 * once rather than re-derived (and risking a typo'd mismatch) in each
 * analyzer.
 */

export function fileNodeId(path: string): string {
  return `file:${path}`;
}

export function tableNodeId(entity: string): string {
  return `db-table:${entity}`;
}

export function modelNodeId(entity: string): string {
  return `prisma-model:${entity}`;
}

export function apiEndpointNodeId(method: string, path: string): string {
  return `api-endpoint:${method.toUpperCase()} ${path}`;
}

export function envVarNodeId(name: string): string {
  return `env-var:${name}`;
}

export function securityModuleNodeId(name: string): string {
  return `security-module:${name}`;
}
