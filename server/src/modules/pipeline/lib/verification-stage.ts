/**
 * The seam between a generated bundle and real execution of it.
 *
 * Loaded on first use rather than imported, so a run with no project, and the
 * generator's own tests, never pull in child-process machinery.
 */
import type {
  DeclaredRoute,
  ProjectFile,
  RepairOptions,
  RepairResult,
  VerificationResult,
  VerifyProjectOptions,
} from '../../build-verification/build-verification.types.js';
import type { PipelineArtifacts, RunOutcome, RunVerification } from '../pipeline.types.js';
import type { FeatureResult } from './feature-implementation.js';

export interface VerificationDeps {
  verifyProject(files: ProjectFile[], options: VerifyProjectOptions): Promise<VerificationResult>;
  repairVerifiedFailures(
    files: ProjectFile[],
    verification: VerificationResult,
    options: RepairOptions,
  ): Promise<RepairResult>;
}

export async function loadVerificationDeps(): Promise<VerificationDeps> {
  return import('../../build-verification/index.js');
}

/** What a merge reads and writes; earlier than the full bundle exists. */
type MergeableArtifacts = Pick<PipelineArtifacts, 'files' | 'backend' | 'frontend' | 'security'>;

const MAX_DECLARED_ROUTES = 12;

/**
 * Routes that can be checked with no data and no id: the collection reads.
 * A guarded one is expected to refuse an anonymous caller, so a 401 there is
 * the correct answer rather than a failure.
 */
export function declaredRoutes(
  routes: readonly { method: string; path: string; auth: boolean }[],
): DeclaredRoute[] {
  return routes
    .filter((route) => route.method.toUpperCase() === 'GET' && !route.path.includes(':'))
    .slice(0, MAX_DECLARED_ROUTES)
    .map((route) => ({
      method: 'GET',
      path: route.path,
      ...(route.auth ? { expectedStatus: 401 } : {}),
    }));
}

/** Blocked says nothing about its subject, so it is not a failure to repair. */
export function hasVerifiedFailure(result: VerificationResult): boolean {
  return (
    result.steps.some((step) => step.status === 'failed') ||
    result.routes.some((route) => route.status === 'failed')
  );
}

export function describeVerification(result: VerificationResult): string {
  const ran = result.steps.filter((step) => step.status !== 'skipped');
  const passed = ran.filter((step) => step.status === 'passed').length;
  return `${passed}/${ran.length} checks passed`;
}

export function describeFailure(result: VerificationResult): string {
  const failed = result.steps.filter((step) => step.status === 'failed');
  const routes = result.routes.filter((route) => route.status === 'failed');
  const lines = [
    ...failed.map((step) => `${step.id}: ${step.summary}`),
    ...routes.map(
      (route) => `${route.method} ${route.path} answered ${String(route.actualStatus)}`,
    ),
  ];
  return lines.slice(0, 3).join('; ') || 'No check could run to completion.';
}

/**
 * Writes repaired files back into the parts of the bundle they came from.
 *
 * Replacing `files` alone would not last: an edit reassembles the runnable set
 * from these parts, so the next edit would quietly undo the repair. A path in
 * the hardened overlay is updated there, because the overlay wins.
 */
export function mergeRepairedFiles<T extends MergeableArtifacts>(
  artifacts: T,
  repaired: readonly { path: string; content: string }[],
): T {
  const byPath = new Map(repaired.map((file) => [file.path, file.content]));

  function apply<F extends { path: string; content: string }>(
    prefix: string,
    generated: readonly F[],
    hardened: readonly F[],
  ): { generated: F[]; hardened: F[] } {
    const update = (file: F): F | null => {
      const content = byPath.get(`${prefix}/${file.path}`);
      return content === undefined ? null : { ...file, content };
    };
    const keep = (list: readonly F[]): F[] =>
      list.map(update).filter((file): file is F => file !== null);
    const nextHardened = keep(hardened);
    const nextGenerated = keep(generated);

    const known = new Set([...generated, ...hardened].map((file) => `${prefix}/${file.path}`));
    for (const [path, content] of byPath) {
      if (!path.startsWith(`${prefix}/`) || known.has(path)) continue;
      const file = { path: path.slice(prefix.length + 1), content, language: 'text' };
      nextGenerated.push(file as unknown as F);
    }
    return { generated: nextGenerated, hardened: nextHardened };
  }

  const backend = apply(
    'backend',
    artifacts.backend.files,
    artifacts.security.backendFiles as unknown as typeof artifacts.backend.files,
  );
  const frontend = apply(
    'frontend',
    artifacts.frontend.files,
    artifacts.security.frontendFiles as unknown as typeof artifacts.frontend.files,
  );

  return {
    ...artifacts,
    files: repaired.map((file) => ({ path: file.path, content: file.content })),
    backend: { ...artifacts.backend, files: backend.generated },
    frontend: { ...artifacts.frontend, files: frontend.generated },
    security: {
      ...artifacts.security,
      backendFiles: backend.hardened as unknown as typeof artifacts.security.backendFiles,
      frontendFiles: frontend.hardened as unknown as typeof artifacts.security.frontendFiles,
    },
  };
}

/**
 * The run's honest closing sentence.
 *
 * A run that reached its last stage still reports `completed`, because its
 * files are kept and usable. Whether the thing it built works is a separate
 * question, and this is the answer the client shows.
 */
export function describeRunOutcome(
  verification: RunVerification | undefined,
  features: FeatureResult | undefined,
): { outcome: RunOutcome; detail: string } {
  const missing = features?.capabilities.filter((entry) => entry.status === 'missing') ?? [];
  const featureShortfall =
    features === undefined || features.status === 'complete'
      ? null
      : features.status === 'not-run'
        ? `requested features were not implemented: ${features.limitations[0] ?? 'no model was available'}`
        : `${String(missing.length)} requested capabilities are missing (${missing
            .slice(0, 3)
            .map((entry) => entry.title)
            .join('; ')})`;

  if (verification === undefined) {
    return {
      outcome: featureShortfall === null ? 'unverified' : 'incomplete',
      detail: `it was not verified${featureShortfall === null ? '' : `, and ${featureShortfall}`}.`,
    };
  }
  if (!verification.result.ok) {
    const failed = hasVerifiedFailure(verification.result);
    const verdict = `it did not pass verification (${describeFailure(verification.result)})`;
    return {
      outcome: failed ? 'verification-failed' : 'verification-blocked',
      detail: `${failed ? verdict : `verification could not run to completion (${describeFailure(verification.result)})`}${featureShortfall === null ? '' : `, and ${featureShortfall}`}.`,
    };
  }
  if (featureShortfall !== null) {
    return { outcome: 'incomplete', detail: `it runs, but ${featureShortfall}.` };
  }
  return {
    outcome: 'verified',
    detail: `it passed verification (${describeVerification(verification.result)})${features === undefined ? '' : ' and every requested capability was implemented'}.`,
  };
}
