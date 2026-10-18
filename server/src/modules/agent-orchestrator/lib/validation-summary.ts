/**
 * The validation, summed up and gated.
 *
 * The gate is a decision procedure, not a score: each rule is written
 * below in the order it is checked, the first one that fires wins, and the
 * summary carries the sentence saying which fired. Step 33 asks for
 * transparent rules and Step 32 forbids a fake percentage — this is what
 * both look like in code.
 *
 *   1. The project does not build or typecheck        → FAILED
 *   2. The application does not start                 → FAILED
 *   3. Runtime up but integration/tests never ran     → BLOCKED
 *   4. Not one planned test actually executed         → BLOCKED
 *   5. A CRITICAL test failed, or integration failed  → FAILED
 *   6. Any non-critical failure, skip or block        → PASSED_WITH_WARNINGS
 *   7. Everything ran and passed                      → PASSED
 *
 * Note what is *not* here: nothing about "production ready". A PASSED gate
 * means these checks ran and passed — a claim about this validation, not a
 * promise about production.
 */
import type {
  CheckStatus,
  IntegrationResult,
  RuntimeResult,
  TestCase,
  ValidationGate,
  ValidationSummary,
} from '../../../shared/types/validation.js';

export interface SummaryInput {
  projectId: string;
  runId: string;
  runtime: RuntimeResult | null;
  integration: IntegrationResult | null;
  cases: readonly TestCase[];
  agents: ValidationSummary['agents'];
}

function testCounts(cases: readonly TestCase[]): ValidationSummary['tests'] {
  return {
    total: cases.length,
    passed: cases.filter((c) => c.status === 'PASSED').length,
    failed: cases.filter((c) => c.status === 'FAILED').length,
    blocked: cases.filter((c) => c.status === 'BLOCKED').length,
    skipped: cases.filter((c) => c.status === 'SKIPPED').length,
    failedCritical: cases.filter((c) => c.status === 'FAILED' && c.priority === 'CRITICAL').length,
  };
}

function decideGate(input: SummaryInput): { gate: ValidationGate; reason: string } {
  const { runtime, integration } = input;
  const tests = testCounts(input.cases);

  if (!runtime) {
    return { gate: 'NOT_VALIDATED', reason: 'The runtime engineer did not run.' };
  }
  if (runtime.buildStatus === 'FAIL' || runtime.typeCheckStatus === 'FAIL') {
    return {
      gate: 'FAILED',
      reason: `The project does not compile: build ${runtime.buildStatus}, typecheck ${runtime.typeCheckStatus}.`,
    };
  }
  if (runtime.startupStatus === 'FAIL') {
    return { gate: 'FAILED', reason: 'The application did not start.' };
  }
  if (!integration || tests.total === 0) {
    return {
      gate: 'BLOCKED',
      reason: 'The runtime is up but integration or testing never ran, so behaviour is unverified.',
    };
  }
  /*
   * A plan whose every case was skipped or blocked is a plan that never
   * executed: `total > 0` says only that cases were *written*. Without this
   * rule such a run reached the PASSED branch below, because skips and
   * blocks were absent from the warning sum.
   */
  if (tests.passed + tests.failed === 0) {
    return {
      gate: 'BLOCKED',
      reason: `The runtime is up but not one of the ${String(tests.total)} planned test(s) executed: ${String(tests.skipped)} skipped, ${String(tests.blocked)} blocked. Behaviour is unverified.`,
    };
  }

  const integrationFailures = integration.checks.filter((check) => check.status === 'FAIL');
  const hardIntegration = integrationFailures.filter((check) => check.kind !== 'ERROR_HANDLING');

  if (tests.failedCritical > 0) {
    return {
      gate: 'FAILED',
      reason: `${String(tests.failedCritical)} critical test(s) failed against the running application.`,
    };
  }
  if (hardIntegration.length > 0) {
    return {
      gate: 'FAILED',
      reason: `${String(hardIntegration.length)} integration check(s) failed: ${hardIntegration
        .map((check) => check.kind)
        .join(', ')}.`,
    };
  }

  /*
   * A check that never ran is not a check that passed. The sum below used
   * to count only failures and blocks, so a project with no build and no
   * typecheck script (both SKIPPED) and a plan of entirely skipped cases
   * came out PASSED under the sentence "every planned test passed" — the
   * unevidenced success claim this mesh exists to make impossible. Skips
   * and non-passing compile checks are therefore warnings, and both
   * reasons below are assembled from what was actually observed, so
   * neither sentence can name a check that did not run.
   */
  const integrationPassed = integration.checks.filter((check) => check.status === 'PASS').length;

  const ranAndPassed: string[] = [];
  if (runtime.buildStatus === 'PASS') ranAndPassed.push('build');
  if (runtime.typeCheckStatus === 'PASS') ranAndPassed.push('typecheck');
  if (runtime.startupStatus === 'PASS') ranAndPassed.push('startup');
  if (runtime.healthStatus === 'PASS') ranAndPassed.push('the health endpoint');
  if (integrationPassed > 0) {
    ranAndPassed.push(`${String(integrationPassed)} integration check(s)`);
  }
  if (tests.passed > 0) {
    ranAndPassed.push(`${String(tests.passed)} of ${String(tests.total)} planned test(s)`);
  }

  const neverRan: string[] = [];
  if (runtime.buildStatus !== 'PASS') neverRan.push(`build ${runtime.buildStatus}`);
  if (runtime.typeCheckStatus !== 'PASS') neverRan.push(`typecheck ${runtime.typeCheckStatus}`);
  if (tests.skipped > 0) {
    neverRan.push(`${String(tests.skipped)} of ${String(tests.total)} planned test(s) SKIPPED`);
  }
  if (tests.blocked > 0) neverRan.push(`${String(tests.blocked)} test(s) BLOCKED`);

  const unrunCompileChecks =
    (runtime.buildStatus === 'PASS' ? 0 : 1) + (runtime.typeCheckStatus === 'PASS' ? 0 : 1);
  const warnings =
    tests.failed +
    tests.blocked +
    tests.skipped +
    integrationFailures.length +
    unrunCompileChecks +
    (runtime.lintStatus === 'FAIL' ? 1 : 0) +
    (runtime.healthStatus === 'FAIL' ? 1 : 0);

  if (warnings > 0) {
    const problems: string[] = [];
    if (tests.failed > 0) problems.push(`${String(tests.failed)} non-critical test failure(s)`);
    if (integrationFailures.length > 0) {
      problems.push(`${String(integrationFailures.length)} soft integration issue(s)`);
    }
    if (runtime.lintStatus === 'FAIL') problems.push('lint failed');
    if (runtime.healthStatus === 'FAIL') problems.push('the health endpoint failed');

    const clauses = [
      ranAndPassed.length > 0
        ? `Ran and passed: ${ranAndPassed.join(', ')}`
        : 'Nothing was confirmed to pass',
    ];
    if (neverRan.length > 0) clauses.push(`did not run: ${neverRan.join(', ')}`);
    if (problems.length > 0) clauses.push(`failed: ${problems.join(', ')}`);
    return { gate: 'PASSED_WITH_WARNINGS', reason: `${clauses.join('; ')}.` };
  }

  return {
    gate: 'PASSED',
    reason: `Ran and passed: ${ranAndPassed.join(', ')} — against the running application, with nothing skipped or blocked.`,
  };
}

function row(name: string, status: CheckStatus, detail: string): ValidationSummary['rows'][number] {
  return { name, status, detail };
}

export function summarizeValidation(input: SummaryInput): ValidationSummary {
  const { runtime, integration } = input;
  const tests = testCounts(input.cases);
  const { gate, reason } = decideGate(input);

  const rows: ValidationSummary['rows'] = [];
  if (runtime) {
    rows.push(
      row(
        'Build',
        runtime.buildStatus,
        runtime.commands
          .filter((c) => c.command === 'npm run build')
          .map((c) => `${c.area} exit ${String(c.exitCode)}`)
          .join(' · ') || 'no build script',
      ),
      row(
        'Type Check',
        runtime.typeCheckStatus,
        runtime.commands
          .filter((c) => c.command === 'npm run typecheck')
          .map((c) => `${c.area} exit ${String(c.exitCode)}`)
          .join(' · ') || 'no typecheck script',
      ),
      row(
        'Lint',
        runtime.lintStatus,
        runtime.commands
          .filter((c) => c.command === 'npm run lint')
          .map((c) => `${c.area} exit ${String(c.exitCode)}`)
          .join(' · ') || 'no lint script',
      ),
      row(
        'Startup',
        runtime.startupStatus,
        runtime.processes
          .map((p) => `${p.kind}: ${p.status}${p.port ? ` :${String(p.port)}` : ''}`)
          .join(' · '),
      ),
      row(
        'Health',
        runtime.healthStatus,
        runtime.errors.find((e) => e.startsWith('Health')) ?? 'health endpoint answered',
      ),
    );
  } else {
    rows.push(row('Runtime', 'BLOCKED', 'the runtime engineer did not run'));
  }

  if (integration) {
    const failed = integration.checks.filter((check) => check.status === 'FAIL').length;
    const blocked = integration.checks.filter((check) => check.status === 'BLOCKED').length;
    rows.push(
      row(
        'Integration',
        failed > 0 ? 'FAIL' : blocked === integration.checks.length ? 'BLOCKED' : 'PASS',
        `${String(integration.checks.length - failed - blocked)}/${String(integration.checks.length)} checks passed · ${String(integration.endpoints.length)} endpoints probed`,
      ),
    );
  }

  /*
   * PASS here needs a pass to point at. The row used to read PASS whenever
   * nothing failed, which reported a green Tests line for a plan in which
   * every case was skipped.
   */
  rows.push(
    row(
      'Tests',
      tests.total === 0
        ? 'BLOCKED'
        : tests.failed > 0
          ? 'FAIL'
          : tests.passed === 0
            ? tests.blocked > 0
              ? 'BLOCKED'
              : 'SKIPPED'
            : 'PASS',
      `${String(tests.passed)}/${String(tests.total)} passed · ${String(tests.failed)} failed · ${String(tests.blocked)} blocked · ${String(tests.skipped)} skipped`,
    ),
  );

  return {
    projectId: input.projectId,
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    rows,
    tests,
    gate,
    gateReason: reason,
    agents: input.agents,
  };
}
