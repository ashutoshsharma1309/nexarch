/**
 * The prose half of the analysis: an executive summary plus one focused
 * markdown explanation per structural concern (folders, database, API,
 * security). Written from the artifacts, never invented — every number and
 * name in the text is read from the plan/design it describes.
 */
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { FolderNode } from '../../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../../shared/types/design.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

export function writeSummary(
  spec: RequirementSpec,
  plan: ArchitecturePlan,
  design: DatabaseDesign,
): string {
  const endpoints = plan.apiModules.reduce((sum, m) => sum + m.endpoints.length, 0);
  const guarded = plan.apiModules.flatMap((m) => m.endpoints).filter((e) => e.auth).length;

  return [
    `# ${plan.meta.projectName} — Architecture Summary`,
    '',
    `**${plan.meta.projectName}** is a ${plan.meta.projectType} built as ${plan.decisions.architecture.choice}.`,
    '',
    `The system serves ${String(spec.roles.length)} user role(s) (${spec.roles.join(', ')}) across ` +
      `${String(plan.frontend.pages.length)} frontend pages, backed by ${String(plan.apiModules.length)} API modules ` +
      `exposing ${String(endpoints)} endpoints (${String(guarded)} of them authenticated), persisting into ` +
      `${String(design.tables.length)} ${design.meta.engine} tables related through ` +
      `${String(design.relationships.length)} foreign-key relationship(s).`,
    '',
    `Authentication follows **${plan.security.sessionStrategy}**; authorization is ${plan.security.authorization}.`,
    '',
    '## How a request flows',
    '',
    `Browser → React SPA → \`/api\` → Express module router → validation → service → ${design.meta.engine}. ` +
      'Every response uses one success/failure envelope, so clients branch on a single flag instead of parsing shapes.',
  ].join('\n');
}

function renderFolderTree(nodes: FolderNode[], depth: number): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    lines.push(`${indent}- \`${node.name}\`${node.type === 'directory' ? '/' : ''}`);
    if (node.children && depth < 2) {
      lines.push(...renderFolderTree(node.children, depth + 1));
    }
  }
  return lines;
}

export function explainFolders(plan: ArchitecturePlan): string {
  return [
    '## Folder structure',
    '',
    'The layout is feature-first: code is grouped by what it does for the product, not by file kind. ' +
      'Each backend module owns its routes, service, and validation; shared concerns live in one shared layer.',
    '',
    ...renderFolderTree(plan.folderStructure, 0).slice(0, 60),
  ].join('\n');
}

export function explainDatabase(design: DatabaseDesign): string {
  const lines = [
    '## Database design',
    '',
    `${design.meta.engine} ${design.meta.databaseVersion}, normalized to ${design.meta.normalForm}. ` +
      `${String(design.tables.length)} tables, ${String(design.relationships.length)} relationships, ` +
      `${String(design.enums.length)} enum(s).`,
    '',
  ];
  for (const table of design.tables) {
    const fks = table.columns.filter((c) => c.references).length;
    lines.push(
      `- **${table.entity}** (\`${table.tableName}\`) — ${String(table.columns.length)} columns, ` +
        `${String(table.indexes.length)} index(es)${fks > 0 ? `, ${String(fks)} foreign key(s)` : ''}${table.softDelete ? ', soft-deleted' : ''}. ${table.description}`,
    );
  }
  return lines.join('\n');
}

export function explainApi(plan: ArchitecturePlan): string {
  const lines = [
    '## API surface',
    '',
    'REST under a versioned prefix; every module owns a base path and the endpoints beneath it.',
    '',
  ];
  for (const module of plan.apiModules) {
    lines.push(
      `- **${module.module}** (\`${module.basePath}\`) — ${String(module.endpoints.length)} endpoint(s):`,
    );
    for (const endpoint of module.endpoints) {
      const guards = endpoint.auth
        ? ` · auth${endpoint.roles && endpoint.roles.length > 0 ? ` (${endpoint.roles.join(', ')})` : ''}`
        : '';
      lines.push(`  - \`${endpoint.method} ${endpoint.path}\` — ${endpoint.description}${guards}`);
    }
  }
  return lines.join('\n');
}

export function explainSecurity(plan: ArchitecturePlan): string {
  const security = plan.security;
  return [
    '## Security posture',
    '',
    `- **Authentication:** ${security.authentication.join('; ') || 'none planned'}`,
    `- **Session strategy:** ${security.sessionStrategy}`,
    `- **Authorization:** ${security.authorization}`,
    `- **Password policy:** ${security.passwordPolicy.join('; ') || 'none recorded'}`,
    `- **Rate limiting:** ${security.rateLimiting.join('; ') || 'none planned'}`,
    `- **Input validation:** ${security.validation}`,
    `- **Response headers:** ${security.headers.join(', ') || 'defaults only'}`,
    `- **CORS:** ${security.cors}`,
  ].join('\n');
}
