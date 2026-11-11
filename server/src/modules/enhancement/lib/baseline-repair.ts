/**
 * When a repair may keep a change to a file the plan did not name.
 *
 * A plan describes one change. If the project was already failing to compile
 * before that change, the file that fixes it is not in the plan, and restoring
 * it would make every change to that project impossible. The exception is
 * narrow and evidence-based: the failing step must name the file, and there
 * must be evidence the failure predates this change. Everything else a repair
 * touches outside the plan is still put back.
 */
import type { VerificationResult } from '../../build-verification/index.js';
import { importedPaths } from './implementer.js';

interface ProjectFile {
  path: string;
  content: string;
}

const COMPILE_STEPS = new Set(['typecheck', 'build']);

function namesFile(text: string, path: string): boolean {
  // Tools report paths relative to the package, so both forms are real.
  const relative = path.slice(path.indexOf('/') + 1);
  return [path, relative].some((candidate) => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w./-])${escaped}(?![\\w.-])`, 'm').test(text);
  });
}

function failingStepNaming(verification: VerificationResult, path: string): string | null {
  const step = verification.steps.find(
    (candidate) =>
      candidate.status === 'failed' &&
      COMPILE_STEPS.has(candidate.id) &&
      namesFile(`${candidate.summary}\n${candidate.output}`, path),
  );
  return step?.id ?? null;
}

/**
 * The files outside the plan a repair may keep, each with the reason.
 *
 * Evidence, strongest first: the base version's own stored verification failed
 * on this file, or the file imports nothing the plan changed, so nothing in
 * this change can have broken it.
 */
export function baselineRepairPermits(input: {
  planned: ReadonlySet<string>;
  baseline: readonly ProjectFile[];
  repaired: readonly ProjectFile[];
  /** The verification that failed and sent this change to repair. */
  failing: VerificationResult;
  /** The base version's own verdict, when one was stored. */
  storedBaseline: VerificationResult | undefined;
  changedByPlan: ReadonlySet<string>;
}): Map<string, string> {
  const original = new Map(input.baseline.map((file) => [file.path, file.content]));
  const known = new Set(original.keys());
  const permits = new Map<string, string>();
  for (const file of input.repaired) {
    const before = original.get(file.path);
    if (input.planned.has(file.path) || before === undefined || before === file.content) continue;
    const step = failingStepNaming(input.failing, file.path);
    if (step === null) continue;
    const storedStep = input.storedBaseline
      ? failingStepNaming(input.storedBaseline, file.path)
      : null;
    const importsChanged = importedPaths(file.path, before, known).some((path) =>
      input.changedByPlan.has(path),
    );
    if (storedStep !== null) {
      permits.set(
        file.path,
        `${step} failed on it in this change, and the version this change started from failed ${storedStep} on the same file.`,
      );
    } else if (!importsChanged) {
      permits.set(
        file.path,
        `${step} failed on it, and it imports nothing this change touched, so the failure was already there.`,
      );
    }
  }
  return permits;
}
