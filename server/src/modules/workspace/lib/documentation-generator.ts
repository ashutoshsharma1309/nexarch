/**
 * Documentation generators — one function per `DocumentationType`. Each
 * reads only the slice of `ProjectArtifacts` it needs and degrades
 * gracefully (a short "not generated yet" note) when that pipeline stage
 * hasn't run, since a project can request documentation at any point in its
 * lifecycle.
 */
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { DatabaseDesign } from '../../../shared/types/design.js';
import type {
  DocumentationResult,
  DocumentationType,
  ProjectArtifacts,
} from '../workspace.types.js';

function heading(title: string): string {
  return `# ${title}\n`;
}

function missing(stage: string): string {
  return `_${stage} has not been generated for this project yet._\n`;
}

function generateReadme(artifacts: ProjectArtifacts): string {
  const { projectName, requirements, architecture, security } = artifacts;
  const lines: string[] = [heading(projectName)];

  if (requirements) {
    lines.push(
      `${requirements.projectType} built with ${requirements.frontend.join(', ') || 'a generated frontend'} and ${requirements.backend.join(', ') || 'a generated backend'}.\n`,
    );
  }

  lines.push('## Features\n');
  if (requirements?.modules.length) {
    lines.push(...requirements.modules.map((m) => `- ${m}`), '');
  } else {
    lines.push(missing('Requirement analysis'));
  }

  lines.push('## Tech stack\n');
  if (architecture) {
    lines.push(
      `- **Frontend:** ${requirements?.frontend.join(', ') ?? 'generated frontend'}`,
      `- **Backend:** ${requirements?.backend.join(', ') ?? 'generated backend'}`,
      `- **Database:** ${architecture.database.engine}`,
      `- **Architecture pattern:** ${architecture.decisions.architecture.choice}`,
      '',
    );
  } else {
    lines.push(missing('Architecture plan'));
  }

  lines.push('## Security\n');
  if (security) {
    lines.push(
      `Security score **${security.report.overallScore}/100** (grade ${security.report.grade}), OWASP Top 10 2021: ${security.owasp.passed}/${security.owasp.passed + security.owasp.warned + security.owasp.failed} categories passed.\n`,
    );
  } else {
    lines.push(missing('Security review'));
  }

  lines.push('## Getting started\n', '```bash', 'npm install', 'npm run dev', '```', '');
  return lines.join('\n');
}

function generateApiDocs(artifacts: ProjectArtifacts): string {
  const { openapi } = artifacts;
  if (!openapi) return heading('API Documentation') + '\n' + missing('An OpenAPI contract');

  const lines: string[] = [heading(openapi.info.title), openapi.info.description, ''];
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(item)) {
      lines.push(`## ${method.toUpperCase()} ${path}`, '', op.summary, '');
      if (op.parameters?.length) {
        lines.push(
          '**Parameters:**',
          ...op.parameters.map(
            (p) => `- \`${p.name}\` (${p.in}${p.required ? ', required' : ''}) — ${p.description}`,
          ),
          '',
        );
      }
      const responseCodes = Object.keys(op.responses).join(', ');
      lines.push(`**Responses:** ${responseCodes}`, '');
    }
  }
  return lines.join('\n');
}

function describeArchitecture(architecture: ArchitecturePlan): string {
  const lines: string[] = [heading(`${architecture.meta.projectName} — Architecture`)];
  lines.push(
    `**Architecture:** ${architecture.decisions.architecture.choice} — ${architecture.decisions.architecture.reasoning}`,
    `**Frontend architecture:** ${architecture.decisions.frontendArchitecture.choice}`,
    `**Backend architecture:** ${architecture.decisions.backendArchitecture.choice}`,
    `**Authentication:** ${architecture.decisions.authentication.choice}`,
    '',
  );

  lines.push('## API modules\n');
  for (const mod of architecture.apiModules) {
    lines.push(`### ${mod.module} (\`${mod.basePath}\`)`, '');
    lines.push(
      ...mod.endpoints.map(
        (e) => `- \`${e.method} ${e.path}\` — ${e.description}${e.auth ? ' 🔒' : ''}`,
      ),
      '',
    );
  }

  lines.push('## Backend modules\n');
  lines.push(
    ...architecture.services.map(
      (s) =>
        `- **${s.module}** — controller: \`${s.controller}\`, service: \`${s.service}\`, repository: \`${s.repository}\``,
    ),
    '',
  );

  lines.push('## Folder structure\n', '```');
  const printTree = (nodes: ArchitecturePlan['folderStructure'], depth: number): void => {
    for (const node of nodes) {
      lines.push(`${'  '.repeat(depth)}${node.name}${node.type === 'directory' ? '/' : ''}`);
      if (node.children) printTree(node.children, depth + 1);
    }
  };
  printTree(architecture.folderStructure, 0);
  lines.push('```', '');

  return lines.join('\n');
}

function generateArchitectureDocs(artifacts: ProjectArtifacts): string {
  if (!artifacts.architecture)
    return heading('Architecture Documentation') + '\n' + missing('An architecture plan');
  return describeArchitecture(artifacts.architecture);
}

function describeDatabase(design: DatabaseDesign, prismaSchema?: string): string {
  const lines: string[] = [heading(`${design.meta.projectName} — Database`)];
  lines.push(`Engine: ${design.meta.engine}, normal form: ${design.meta.normalForm}.\n`);

  lines.push('## Tables\n');
  for (const table of design.tables) {
    lines.push(`### ${table.entity} (\`${table.tableName}\`)`, '', table.description, '');
    lines.push('| Column | Type | Nullable | Notes |', '| --- | --- | --- | --- |');
    for (const col of table.columns) {
      const notes = [
        col.primaryKey && 'PK',
        col.unique && 'unique',
        col.references && `FK → ${col.references.table}`,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(
        `| ${col.field} | ${col.prismaType} | ${col.nullable ? 'yes' : 'no'} | ${notes} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Relationships\n');
  lines.push(
    ...design.relationships.map(
      (r) => `- ${r.parent} ${r.cardinality} ${r.child} (on delete: ${r.onDelete})`,
    ),
    '',
  );

  if (prismaSchema) {
    lines.push('## Prisma schema\n', '```prisma', prismaSchema.trim(), '```', '');
  }

  return lines.join('\n');
}

function generateDatabaseDocs(artifacts: ProjectArtifacts): string {
  if (!artifacts.databaseDesign)
    return heading('Database Documentation') + '\n' + missing('A database design');
  return describeDatabase(artifacts.databaseDesign, artifacts.prismaSchema);
}

function generateSecurityDocs(artifacts: ProjectArtifacts): string {
  const { security } = artifacts;
  if (!security) return heading('Security Documentation') + '\n' + missing('A security review');

  const lines: string[] = [heading(`${artifacts.projectName} — Security`)];
  lines.push(
    `**Overall score:** ${security.report.overallScore}/100 (grade ${security.report.grade})`,
    '',
    '## OWASP Top 10 (2021)',
    '',
    `- Passed: ${security.owasp.passed}`,
    `- Warned: ${security.owasp.warned}`,
    `- Failed: ${security.owasp.failed}`,
    `- Not applicable: ${security.owasp.notApplicable}`,
    '',
    '## Findings',
    '',
    `- Critical: ${security.report.summary.critical}`,
    `- High: ${security.report.summary.high}`,
    `- Medium: ${security.report.summary.medium}`,
    `- Low: ${security.report.summary.low}`,
    `- Resolved: ${security.report.summary.resolved}`,
    '',
    '## Recommendations',
    '',
    ...security.report.recommendations.map((r) => `- ${r}`),
    '',
  );
  return lines.join('\n');
}

function generateDeploymentGuide(artifacts: ProjectArtifacts): string {
  const { architecture } = artifacts;
  const lines: string[] = [heading(`${artifacts.projectName} — Deployment Guide`)];
  lines.push(
    '## Requirements',
    '',
    '- Node.js 20+',
    `- ${architecture?.database.engine ?? 'MySQL 8'}`,
    '- Docker (optional, for the bundled compose setup)',
    '',
    '## Environment variables',
    '',
    '```',
    'DATABASE_URL=',
    'JWT_SECRET=',
    'PORT=4000',
    '```',
    '',
    '## Build & run',
    '',
    '```bash',
    'npm install',
    'npm run build',
    'npm run start',
    '```',
    '',
    '## Docker',
    '',
    '```bash',
    'docker compose up --build',
    '```',
    '',
  );
  return lines.join('\n');
}

function generateDeveloperGuide(artifacts: ProjectArtifacts): string {
  const { architecture, backend, frontend } = artifacts;
  const lines: string[] = [heading(`${artifacts.projectName} — Developer Guide`)];
  lines.push(
    '## Project layout',
    '',
    architecture
      ? `Follows a ${architecture.decisions.architecture.choice} pattern. See Architecture Documentation for the full folder tree.`
      : missing('An architecture plan'),
    '',
    '## Backend',
    '',
    backend
      ? `${backend.files.length} files across modules: ${backend.modules.join(', ')}.`
      : missing('Backend generation'),
    '',
    '## Frontend',
    '',
    frontend
      ? `${frontend.files.length} files, ${frontend.pages.length} pages, ${frontend.components.length} components.`
      : missing('Frontend generation'),
    '',
    '## Conventions',
    '',
    '- Feature-first folder structure',
    '- Strict TypeScript, no implicit `any`',
    "- One module per domain concern; modules do not import each other's internals",
    '',
  );
  return lines.join('\n');
}

const GENERATORS: Record<DocumentationType, (artifacts: ProjectArtifacts) => string> = {
  readme: generateReadme,
  api: generateApiDocs,
  architecture: generateArchitectureDocs,
  database: generateDatabaseDocs,
  security: generateSecurityDocs,
  'deployment-guide': generateDeploymentGuide,
  'developer-guide': generateDeveloperGuide,
};

const FILENAMES: Record<DocumentationType, string> = {
  readme: 'README.md',
  api: 'API.md',
  architecture: 'ARCHITECTURE.md',
  database: 'DATABASE.md',
  security: 'SECURITY.md',
  'deployment-guide': 'DEPLOYMENT.md',
  'developer-guide': 'DEVELOPER_GUIDE.md',
};

export function generateDocumentation(
  type: DocumentationType,
  artifacts: ProjectArtifacts,
): DocumentationResult {
  return {
    type,
    filename: FILENAMES[type],
    markdown: GENERATORS[type](artifacts),
  };
}
