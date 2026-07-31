/**
 * The dry-run half of the push flow — pure, so the whole push experience
 * (steps, sizes, README inclusion, warnings) works and is testable with no
 * token and no network. The executor in `commit-service.ts` follows
 * exactly the steps this planner describes; if they ever drift, the tests
 * comparing them fail.
 */
import type { PushFile, PushPlan, PushRequest } from '../github.types.js';
import { buildReadme } from './readme-generator.js';

/** GitHub's blob API takes base64 payloads; past ~50MB pushes need Git LFS. */
const LARGE_FILE_BYTES = 5 * 1024 * 1024;
const MANY_FILES_THRESHOLD = 1_000;

export function resolvePushFiles(request: PushRequest): PushFile[] {
  const hasReadme = request.files.some((f) => f.path.toLowerCase() === 'readme.md');
  if (!request.generateReadme || hasReadme) return request.files;

  return [
    ...request.files,
    {
      path: 'README.md',
      content: buildReadme(
        request.projectMeta ?? { projectName: request.repo },
        request.files.map((f) => f.path),
      ),
    },
  ];
}

export function planPush(request: PushRequest): PushPlan {
  const files = resolvePushFiles(request);
  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);

  const warnings: string[] = [];
  if (files.length > MANY_FILES_THRESHOLD) {
    warnings.push(
      `${String(files.length)} files in one commit — GitHub accepts this, but consider splitting unrelated concerns.`,
    );
  }
  for (const file of files) {
    if (Buffer.byteLength(file.content, 'utf8') > LARGE_FILE_BYTES) {
      warnings.push(`${file.path} exceeds 5MB — large binaries belong in Git LFS, not the tree.`);
    }
  }
  const duplicates = files.map((f) => f.path).filter((p, i, all) => all.indexOf(p) !== i);
  for (const path of new Set(duplicates)) {
    warnings.push(`${path} appears more than once — the last occurrence wins.`);
  }

  return {
    owner: request.owner,
    repo: request.repo,
    branch: request.branch,
    fileCount: files.length,
    totalBytes,
    readmeIncluded: files.length !== request.files.length,
    steps: [
      {
        name: 'resolve-branch',
        description: `Resolve heads/${request.branch} (created from the default branch if missing)`,
      },
      { name: 'create-blobs', description: `Upload ${String(files.length)} file blob(s)` },
      { name: 'create-tree', description: 'Build the git tree on top of the branch head' },
      { name: 'create-commit', description: `Commit: "${request.message}"` },
      { name: 'update-ref', description: `Fast-forward heads/${request.branch} to the new commit` },
    ],
    warnings,
  };
}
