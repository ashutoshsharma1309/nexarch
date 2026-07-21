/**
 * RBAC: turns each entity's `EntityMetadata.permissions` (already derived by
 * the Database Designer) into a generated permission map plus a
 * `requirePermission(entity, action)` middleware — the same data
 * `mod.deleteRoles` already restricts DELETE routes with, extended to cover
 * every action instead of only delete.
 */
import type { SecurityModel } from './security-model.js';
import type {
  GeneratedFile,
  RbacConfig,
  RbacPermissionEntry,
  RbacRoleDefinition,
} from '../security-engine.types.js';
import { file } from './file-tree.js';

function describeRole(role: string, model: SecurityModel): string {
  const grantsAll = model.entities.every((e) =>
    e.permissions.find((p) => p.role === role)?.actions.includes('delete'),
  );
  if (grantsAll && model.entities.length > 0) {
    return `Full administrative access across all ${model.entities.length} entities, including deletion.`;
  }
  const canDeleteSome = model.entities.some((e) =>
    e.permissions.find((p) => p.role === role)?.actions.includes('delete'),
  );
  if (canDeleteSome) return 'Elevated access on some entities; deletion rights vary by entity.';
  const canWrite = model.entities.some((e) => {
    const actions = e.permissions.find((p) => p.role === role)?.actions ?? [];
    return actions.includes('create') || actions.includes('update');
  });
  return canWrite
    ? 'Standard authenticated access, generally scoped to records the user owns.'
    : 'Read-only access.';
}

export function buildRbacConfig(model: SecurityModel): RbacConfig {
  const roles: RbacRoleDefinition[] = model.roles.map((role) => ({
    role,
    description: describeRole(role, model),
  }));

  const permissions: RbacPermissionEntry[] = model.entities.flatMap((entity) =>
    entity.permissions.map((p) => ({ entity: entity.entity, role: p.role, actions: p.actions })),
  );

  return { roles, permissions };
}

function permissionMapLiteral(permissions: RbacPermissionEntry[]): string {
  const byEntity = new Map<string, RbacPermissionEntry[]>();
  for (const entry of permissions) {
    const list = byEntity.get(entry.entity) ?? [];
    list.push(entry);
    byEntity.set(entry.entity, list);
  }

  const entries = [...byEntity.entries()]
    .map(([entity, entryList]) => {
      const roleLines = entryList
        .map(
          (e) => `    ${JSON.stringify(e.role)}: [${e.actions.map((a) => `'${a}'`).join(', ')}],`,
        )
        .join('\n');
      return `  ${JSON.stringify(entity)}: {\n${roleLines}\n  },`;
    })
    .join('\n');

  return `{\n${entries}\n}`;
}

function permissionsGenerated(config: RbacConfig): string {
  return `/**
 * Generated from entity-metadata.json (Phase 4) by the Security Engine.
 * PERMISSION_MAP[entity][role] lists the actions that role may perform on
 * that entity; a role/entity pair absent from the map has no access.
 */
export type RbacAction = 'create' | 'read' | 'update' | 'delete';

export const PERMISSION_MAP: Record<string, Partial<Record<string, RbacAction[]>>> =
  ${permissionMapLiteral(config.permissions)};

export function isPermitted(entity: string, role: string, action: RbacAction): boolean {
  return PERMISSION_MAP[entity]?.[role]?.includes(action) ?? false;
}
`;
}

const rbacMiddleware = `import type { RequestHandler } from 'express';

import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';
import { isPermitted } from './permissions.generated.js';
import type { RbacAction } from './permissions.generated.js';

/**
 * Restricts a route to roles the generated RBAC map grants \`action\` on
 * \`entity\` — finer-grained than \`requireRoles\`, which only checks role
 * membership without knowing which entity or action is in play.
 */
export function requirePermission(entity: string, action: RbacAction): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    const permitted = req.user.roles.some((role) => isPermitted(entity, role, action));
    if (!permitted) {
      next(new ForbiddenError(\`Role(s) [\${req.user.roles.join(', ')}] may not \${action} \${entity}\`));
      return;
    }
    next();
  };
}
`;

export function emitRbac(config: RbacConfig): GeneratedFile[] {
  return [
    file(
      'src/shared/security/permissions.generated.ts',
      'typescript',
      permissionsGenerated(config),
    ),
    file('src/shared/security/rbac.ts', 'typescript', rbacMiddleware),
  ];
}
