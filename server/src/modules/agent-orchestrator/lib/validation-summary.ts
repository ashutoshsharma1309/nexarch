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
 *   4. A CRITICAL test failed, or integration failed  → FAILED
 *   5. Any non-critical failure or warning            → PASSED_WITH_WARNINGS
 *   6. Everything ran and passed                      → PASSED
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

  const warnings =
    tests.failed +
    tests.blocked +
    integrationFailures.length +
    (runtime.lintStatus === 'FAIL' ? 1 : 0) +
    (runtime.healthStatus === 'FAIL' ? 1 : 0);
  if (warnings > 0) {
    return {
      gate: 'PASSED_WITH_WARNINGS',
      reason: `Core checks passed; ${String(tests.failed)} non-critical test failure(s), ${String(tests.blocked)} blocked, ${String(integrationFailures.length)} soft integration issue(s).`,
    };
  }

  return {
    gate: 'PASSED',
    reason:
      'Build, startup, integration and every planned test passed against the running application.',
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

  rows.push(
    row(
      'Tests',
      tests.total === 0
        ? 'BLOCKED'
        : tests.failed > 0
          ? 'FAIL'
          : tests.blocked === tests.total
            ? 'BLOCKED'
            : 'PASS',
      `${String(tests.passed)}/${String(tests.total)} passed · ${String(tests.failed)} failed · ${String(tests.blocked)} blocked`,
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
