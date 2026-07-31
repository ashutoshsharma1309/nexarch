/**
 * Mermaid diagram sources derived from the structured plan/design — the
 * client renders them. Mermaid (not SVG) because the diagrams stay
 * diffable, versionable text and inherit the console's theme instead of
 * baking in colors.
 */
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../../shared/types/design.js';
import type { InsightsDiagrams } from '../insights.types.js';

/** Mermaid node ids must be bare words; labels carry the readable text. */
function mermaidId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '_');
}

function buildArchitectureDiagram(plan: ArchitecturePlan): string {
  const lines: string[] = ['flowchart LR'];

  lines.push('  Browser([Browser])');
  lines.push('  Frontend[Frontend SPA]');
  lines.push('  Api[API Server]');
  lines.push(`  Db[(${plan.database.engine})]`);
  lines.push('  Browser --> Frontend');
  lines.push('  Frontend -->|HTTP /api| Api');
  lines.push('  Api --> Db');

  // One subgraph listing the API's feature modules keeps the diagram honest
  // about scale without drawing an unreadable node per endpoint.
  if (plan.apiModules.length > 0) {
    lines.push('  subgraph Modules[API modules]');
    for (const module of plan.apiModules) {
      lines.push(
        `    ${mermaidId(module.module)}[${module.module} · ${String(module.endpoints.length)} endpoints]`,
      );
    }
    lines.push('  end');
    lines.push('  Api --- Modules');
  }

  return lines.join('\n');
}

function buildErDiagram(design: DatabaseDesign): string {
  const lines: string[] = ['erDiagram'];

  const cardinalityArrow: Record<string, string> = {
    'one-to-one': '||--||',
    'one-to-many': '||--o{',
    'many-to-one': '}o--||',
    'many-to-many': '}o--o{',
  };

  for (const relationship of design.relationships) {
    const arrow = cardinalityArrow[relationship.cardinality] ?? '||--o{';
    lines.push(
      `  ${mermaidId(relationship.parent)} ${arrow} ${mermaidId(relationship.child)} : "${relationship.name}"`,
    );
  }

  for (const table of design.tables) {
    lines.push(`  ${mermaidId(table.entity)} {`);
    for (const column of table.columns) {
      const marker = column.primaryKey ? ' PK' : column.references ? ' FK' : '';
      lines.push(`    ${column.prismaType.toLowerCase()} ${column.field}${marker}`);
    }
    lines.push('  }');
  }

  return lines.join('\n');
}

function buildApiFlowDiagram(plan: ArchitecturePlan): string {
  // A representative authenticated write beats an abstract legend: take the
  // first module with a POST endpoint and narrate that request end to end.
  const module =
    plan.apiModules.find((m) => m.endpoints.some((e) => e.method === 'POST')) ?? plan.apiModules[0];
  const endpoint = module?.endpoints.find((e) => e.method === 'POST') ?? module?.endpoints[0];

  const lines: string[] = [
    'sequenceDiagram',
    '  participant C as Client',
    '  participant A as API',
  ];
  if (!module || !endpoint) {
    lines.push('  C->>A: HTTP request');
    lines.push('  A-->>C: JSON envelope');
    return lines.join('\n');
  }

  lines.push('  participant D as Database');
  lines.push(`  C->>A: ${endpoint.method} ${endpoint.path}`);
  if (endpoint.auth) {
    lines.push('  A->>A: verify JWT + role');
    lines.push('  alt token invalid');
    lines.push('    A-->>C: 401 UNAUTHORIZED');
    lines.push('  end');
  }
  lines.push('  A->>A: validate request body');
  lines.push(
    `  A->>D: ${endpoint.method === 'GET' ? 'SELECT' : 'INSERT/UPDATE'} (${module.module})`,
  );
  lines.push('  D-->>A: rows');
  lines.push(`  A-->>C: ${endpoint.method === 'POST' ? '201' : '200'} success envelope`);

  return lines.join('\n');
}

export function buildDiagrams(plan: ArchitecturePlan, design: DatabaseDesign): InsightsDiagrams {
  return {
    architecture: { title: 'System architecture', mermaid: buildArchitectureDiagram(plan) },
    er: { title: 'Entity-relationship model', mermaid: buildErDiagram(design) },
    apiFlow: { title: 'Representative API flow', mermaid: buildApiFlowDiagram(plan) },
  };
}
