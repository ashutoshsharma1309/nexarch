/**
 * Executed test cases and results, per project.
 *
 * The same storage philosophy as the finding store: process-local,
 * bounded, and the single home for its kind of record — Step 18 forbids a
 * second test-result system, and the artifacts carry snapshots while this
 * store answers "what ran most recently" for the API and the UI.
 */
import type { TestCase, TestResult } from '../../../shared/types/validation.js';

interface TestRun {
  runId: string;
  cases: TestCase[];
  results: TestResult[];
  recordedAt: string;
}

const runsByProject = new Map<string, TestRun[]>();

const MAX_PROJECTS = 40;
const MAX_RUNS_PER_PROJECT = 5;

export function recordTestRun(
  projectId: string,
  runId: string,
  cases: TestCase[],
  results: TestResult[],
): void {
  const runs = runsByProject.get(projectId) ?? [];
  runs.push({ runId, cases, results, recordedAt: new Date().toISOString() });
  while (runs.length > MAX_RUNS_PER_PROJECT) runs.shift();
  runsByProject.set(projectId, runs);

  while (runsByProject.size > MAX_PROJECTS) {
    const oldest = runsByProject.keys().next().value;
    if (oldest === undefined || oldest === projectId) break;
    runsByProject.delete(oldest);
  }
}

export function latestTestRun(projectId: string): TestRun | null {
  return runsByProject.get(projectId)?.at(-1) ?? null;
}

export function resetValidationStoreForTests(): void {
  runsByProject.clear();
}
