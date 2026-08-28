/**
 * What actually happened when the generated project was executed.
 *
 * Everything in this file describes evidence: a command that ran and
 * exited, a port that answered or did not, a request that returned a
 * status code. Nothing here is a model's opinion — the validation mesh's
 * whole reason to exist is that "the code should work" is not a fact, and
 * these types are the shape facts take.
 *
 * `BLOCKED` versus `FAILED` is the one distinction worth being pedantic
 * about. A test that ran and produced the wrong answer failed; a test that
 * could not run because the application never started tells you nothing
 * about the test's subject. Collapsing the two would turn one startup
 * failure into thirty phantom test failures and bury the actual problem.
 */

export type TestCaseStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | 'BLOCKED';

export type TestCaseType = 'UNIT' | 'INTEGRATION' | 'API' | 'E2E' | 'BUILD' | 'SMOKE';

export type TestPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface TestStep {
  /** What the step does, e.g. `POST /products with a valid payload`. */
  action: string;
  /** What must be true afterwards, e.g. `201 and an id in the body`. */
  expect: string;
}

export interface TestCase {
  id: string;
  projectId: string;
  runId: string;
  agentId: string;
  name: string;
  type: TestCaseType;
  priority: TestPriority;
  /** What the test exercises, in product terms: a module, an endpoint, a flow. */
  target: string;
  steps: TestStep[];
  expectedResult: string;
  status: TestCaseStatus;
  /** Milliseconds, once the test has run. */
  duration: number | null;
  error: string | null;
  /** What was actually observed — request, status, body fragment. */
  evidence: string | null;
  createdAt: string;
}

/** One executed check's outcome, separate from the case that specified it. */
export interface TestResult {
  id: string;
  projectId: string;
  runId: string;
  agentId: string;
  testCaseId: string;
  status: TestCaseStatus;
  duration: number;
  error: string | null;
  evidence: string | null;
  createdAt: string;
}

/* ── Runtime ───────────────────────────────────────────────────────────── */

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED';

/** One command that actually ran, with what it printed. */
export interface CommandResult {
  /** e.g. `npm run typecheck` in `backend/`. */
  command: string;
  area: string;
  exitCode: number;
  durationMs: number;
  status: CheckStatus;
  /** Tail of combined output, secrets redacted. Never the whole log. */
  outputTail: string;
}

export interface RuntimeResult {
  projectId: string;
  runId: string;
  /** The Local Run Engine session that hosted this validation. */
  sessionId: string | null;
  workspaceDir: string | null;
  buildStatus: CheckStatus;
  typeCheckStatus: CheckStatus;
  lintStatus: CheckStatus;
  startupStatus: CheckStatus;
  healthStatus: CheckStatus;
  processStatus: CheckStatus;
  commands: CommandResult[];
  processes: { kind: string; status: string; port: number | null; url: string | null }[];
  /** Deterministic log-scan hits, not the logs themselves. */
  logSignals: { pattern: string; count: number; sample: string }[];
  durationMs: number;
  errors: string[];
  createdAt: string;
}

/* ── Integration ───────────────────────────────────────────────────────── */

export type IntegrationCheckKind =
  | 'API_CONTRACT'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'DATABASE'
  | 'FRONTEND_BACKEND'
  | 'ERROR_HANDLING';

export interface IntegrationCheck {
  kind: IntegrationCheckKind;
  name: string;
  status: CheckStatus;
  /** e.g. `GET /api/v1/products → 401 (guarded, mounted)`. */
  evidence: string;
  error: string | null;
}

export interface IntegrationResult {
  projectId: string;
  runId: string;
  baseUrl: string | null;
  checks: IntegrationCheck[];
  /** Declared endpoints probed live, and how each answered. */
  endpoints: { method: string; path: string; status: number | null; verdict: string }[];
  durationMs: number;
  createdAt: string;
}

/* ── Summary and gate (Steps 32–33) ────────────────────────────────────── */

export type ValidationGate =
  'NOT_VALIDATED' | 'VALIDATING' | 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED' | 'BLOCKED';

export interface ValidationSummary {
  projectId: string;
  runId: string;
  generatedAt: string;
  rows: { name: string; status: CheckStatus; detail: string }[];
  tests: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    failedCritical: number;
  };
  gate: ValidationGate;
  /**
   * Why the gate is what it is — the rule that fired, in words. A gate
   * whose reasoning is not shown is a score asking to be trusted.
   */
  gateReason: string;
  agents: { agentId: string; status: 'COMPLETED' | 'FAILED'; durationMs: number | null }[];
}
