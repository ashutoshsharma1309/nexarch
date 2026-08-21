/**
 * The pure half of the runner: derive everything the run will do from the
 * file set alone — which targets exist, where to install, how to start,
 * which env files to synthesize. Keeping this pure means the whole plan is
 * testable against real generated projects without spawning a single
 * process, and the supervisor executes exactly what the plan says.
 */
import type { CreateSessionRequest, RunPlan, RunnerFile, RunStep } from '../runner.types.js';

interface TargetLayout {
  kind: 'backend' | 'frontend';
  directory: string;
  portPreference: number;
}

/**
 * Generated projects use backend/ + frontend/. Port preferences match the
 * generated projects' own defaults (4000/5173) so the generated frontend's
 * dev proxy works unmodified whenever those ports are free; the scanner
 * only drifts upward when they're taken.
 */
const KNOWN_LAYOUTS: TargetLayout[] = [
  { kind: 'backend', directory: 'backend', portPreference: 4000 },
  { kind: 'frontend', directory: 'frontend', portPreference: 5173 },
];

function hasFile(files: readonly RunnerFile[], path: string): boolean {
  return files.some((file) => file.path === path);
}

function readScripts(
  files: readonly RunnerFile[],
  packageJsonPath: string,
): Record<string, string> {
  const packageFile = files.find((file) => file.path === packageJsonPath);
  if (!packageFile) return {};
  try {
    const parsed = JSON.parse(packageFile.content) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

export function planRun(request: CreateSessionRequest): RunPlan {
  const { files } = request;
  const targets: RunPlan['targets'] = [];
  const steps: RunStep[] = [
    { name: 'workspace', description: 'Write project files to the run workspace' },
  ];
  const warnings: string[] = [];

  for (const layout of KNOWN_LAYOUTS) {
    const packageJsonPath = `${layout.directory}/package.json`;
    if (!hasFile(files, packageJsonPath)) continue;

    const scripts = readScripts(files, packageJsonPath);
    if (!scripts.dev && !scripts.start) {
      warnings.push(`${layout.directory}/package.json has no dev or start script — skipped`);
      continue;
    }
    const script = scripts.dev ? 'dev' : 'start';

    const envExamplePath = `${layout.directory}/.env.example`;
    const envFile = hasFile(files, envExamplePath)
      ? { path: `${layout.directory}/.env`, derivedFrom: envExamplePath }
      : null;
    const prisma = hasFile(files, `${layout.directory}/prisma/schema.prisma`);

    targets.push({
      kind: layout.kind,
      directory: layout.directory,
      installCommand: 'npm install --no-audit --no-fund',
      startCommand: `npm run ${script}`,
      npmScript: script,
      envFile,
      prisma,
      // Generated backends expose /api/v1/health; a frontend is ready when
      // its root document answers.
      healthPath: layout.kind === 'backend' ? '/api/v1/health' : '/',
    });

    if (envFile) {
      steps.push({
        name: `env-${layout.kind}`,
        description: `Create ${envFile.path} from ${envFile.derivedFrom} (kept if already present)`,
      });
    }
    steps.push({
      name: `install-${layout.kind}`,
      description: `npm install in ${layout.directory}/`,
    });
    if (prisma) {
      steps.push({
        name: `configure-${layout.kind}`,
        description: `prisma generate + database provisioning in ${layout.directory}/`,
      });
    }
  }

  for (const target of targets) {
    steps.push({
      name: `start-${target.kind}`,
      description: `${target.startCommand} in ${target.directory}/ on an auto-detected free port`,
    });
  }
  if (targets.length > 0) {
    steps.push({
      name: 'ready',
      description: 'Wait until every process answers over HTTP, then report URLs',
    });
  }

  if (targets.length === 0) {
    warnings.push(
      'No runnable targets found — expected backend/package.json or frontend/package.json',
    );
  }

  return { projectName: request.projectName, targets, steps, warnings };
}

/** Port preference for a target kind — exported so supervisor and tests agree. */
export function portPreferenceFor(kind: 'backend' | 'frontend'): number {
  return KNOWN_LAYOUTS.find((layout) => layout.kind === kind)?.portPreference ?? 4000;
}
