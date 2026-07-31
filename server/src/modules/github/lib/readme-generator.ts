/**
 * README for pushed projects. Deterministic markdown from the project
 * meta the client supplies out of pipeline artifacts — kept deliberately
 * lean because the generated project already ships full documentation;
 * this is the repository landing page, not the manual.
 */
import type { PushProjectMeta } from '../github.types.js';

export function buildReadme(meta: PushProjectMeta, filePaths: readonly string[]): string {
  const hasBackend = filePaths.some((p) => p.startsWith('backend/'));
  const hasFrontend = filePaths.some((p) => p.startsWith('frontend/'));
  const hasCompose = filePaths.some((p) => p.includes('docker-compose'));

  const lines: string[] = [
    `# ${meta.projectName}`,
    '',
    meta.description ?? `${meta.projectName} — generated with NexArch.`,
    '',
  ];

  if (meta.stack && meta.stack.length > 0) {
    lines.push('## Stack', '');
    for (const item of meta.stack) lines.push(`- ${item}`);
    lines.push('');
  }

  lines.push('## Getting started', '', '```bash');
  if (hasCompose) {
    lines.push('docker compose up --build');
  } else {
    if (hasBackend) lines.push('cd backend && npm install && npm run dev');
    if (hasFrontend) lines.push('cd frontend && npm install && npm run dev');
    if (!hasBackend && !hasFrontend) lines.push('npm install && npm run dev');
  }
  lines.push('```', '');

  lines.push('---', '', 'Generated with [NexArch](https://github.com/ashutoshsharma1309/nexarch).');
  return lines.join('\n');
}
