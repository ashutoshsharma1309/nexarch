/**
 * Real file changes have to land. These cover the failures seen against the
 * running app: an empty edit list, search text that was not in the file, a
 * retry answered from the cache, and a repair undone for being "out of plan".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { VerificationResult } from '../build-verification/index.js';
import type { FunctionalCheckSpec } from './enhancement.types.js';
import { baselineRepairPermits } from './lib/baseline-repair.js';
import {
  capabilityAlreadyPresent,
  disconnectedFrontendReason,
  evaluateCoverage,
  missingAreas,
  requiresFunctionalCheck,
} from './lib/coverage.js';
import { applyEdits, wholeFileProblem } from './lib/file-patch.js';
import {
  ImplementationError,
  implementFile,
  missingImports,
  undeclaredPrismaTypes,
} from './lib/implementer.js';
import { classifyInstruction } from './lib/intent.js';
import { modelCaller } from './lib/usage.js';
import type { ModelCaller } from './lib/usage.js';
import { restoreUnplanned } from './lib/worker.js';

const PATH = 'backend/src/routes.ts';
const ROUTES = [
  "import { Router } from 'express';",
  '// Mounts every module.',
  'export function buildApiRouter(): Router {',
  '  const router = Router();',
  "  router.use('/products', productsRouter);",
  '  return router;',
  '}',
  '',
].join('\n');

interface Sent {
  variables: Record<string, string>;
  untrustedData?: string;
}

function scripted(answers: readonly unknown[]): { call: ModelCaller; sent: Sent[] } {
  const sent: Sent[] = [];
  const call = ((request: Sent) => {
    const answer = answers[Math.min(sent.length, answers.length - 1)];
    sent.push(request);
    return Promise.resolve({ content: JSON.stringify(answer) });
  }) as unknown as ModelCaller;
  return { call, sent };
}

function run(call: ModelCaller, content: string = ROUTES) {
  return implementFile({
    plan: {
      instruction: 'add notes',
      summary: 's',
      steps: [],
      research: { outcome: 'not-needed' },
    } as never,
    file: { path: PATH, action: 'modify', reason: 'mount notes' },
    workspace: new Map([[PATH, content]]),
    changedSoFar: [],
    call,
  });
}

const mounted = ROUTES.replace(
  '  return router;',
  "  router.use('/notes', notesRouter);\n  return router;",
);

describe('applying a model answer', () => {
  it('falls back to a whole file after an empty edit list', async () => {
    const { call, sent } = scripted([
      { edits: [], summary: 'none' },
      { content: mounted, summary: 'mounted' },
    ]);
    const done = await run(call);
    assert.equal(done.content, mounted);
    assert.match(sent[1]?.variables.RETRY_NOTE ?? '', /contained no edits/);
    assert.match(sent[1]?.variables.RETRY_NOTE ?? '', /complete new file/);
  });

  it('feeds back the exact search text and what the file really says', async () => {
    const { call, sent } = scripted([
      { edits: [{ find: "  router.use('/product', productsRouter);", replace: 'x' }] },
      { content: mounted },
    ]);
    await run(call);
    const note = sent[1]?.variables.RETRY_NOTE ?? '';
    assert.match(note, /not in the file/);
    assert.match(note, /line 5: router\.use\('\/products', productsRouter\);/);
  });

  it('accepts the other names models give the edit fields', async () => {
    const { call, sent } = scripted([
      {
        edits: [
          {
            search: '  return router;',
            replacement: "  router.use('/notes', n);\n  return router;",
          },
        ],
      },
    ]);
    const done = await run(call);
    assert.equal(sent.length, 1);
    assert.match(done.content ?? '', /notes/);
  });

  it('sends the exact file, comments included, not the compressed prompt copy', async () => {
    const { call, sent } = scripted([{ content: mounted }]);
    await run(call);
    assert.match(sent[0]?.untrustedData ?? '', /\/\/ Mounts every module\./);
    assert.doesNotMatch(sent[0]?.variables.FILE_CONTENT ?? '', /Mounts every module/);
  });

  it('stops after a bounded number of attempts and reports the real reason', async () => {
    const { call, sent } = scripted([{ edits: [] }]);
    await assert.rejects(run(call), (error: Error) => {
      assert.ok(error instanceof ImplementationError);
      assert.match(error.message, /after 3 attempts/);
      assert.match(error.message, /no edits/);
      return true;
    });
    assert.equal(sent.length, 3);
  });

  it('keeps asking for edits on a file too large to rewrite safely', async () => {
    const large = `${'// filler line\n'.repeat(2_000)}${ROUTES}`;
    const { call, sent } = scripted([{ edits: [] }]);
    await assert.rejects(run(call, large));
    assert.match(sent[1]?.variables.RETRY_NOTE ?? '', /corrected edits/);
    assert.doesNotMatch(sent[1]?.variables.RETRY_NOTE ?? '', /complete new file/);
  });

  it('refuses a rewrite that adds a stub, and says so', async () => {
    const stub = `${ROUTES}throw new NotImplementedError('notes');\n`;
    const { call, sent } = scripted([{ content: stub }, { content: mounted }]);
    const done = await run(call);
    assert.equal(done.content, mounted);
    assert.match(sent[1]?.variables.RETRY_NOTE ?? '', /not implemented/);
  });

  it('refuses a rewrite that elides code or returns the file unchanged', () => {
    assert.match(wholeFileProblem(ROUTES, ROUTES) ?? '', /exactly as it was/);
    assert.match(
      wholeFileProblem(ROUTES, `import x from 'y';\n// ... rest of file\n`) ?? '',
      /left part of the file out/,
    );
    assert.equal(wholeFileProblem(ROUTES, mounted), null);
  });

  it('reports every failing edit at once and treats a no-op as a failure', () => {
    const failed = applyEdits('a\nb\n', [
      { find: 'x', replace: '1' },
      { find: 'y', replace: '2' },
    ]);
    assert.ok(!failed.ok);
    assert.match(failed.reason, /Edit 1[\s\S]*Edit 2/);
    assert.equal(applyEdits('a\n', [{ find: 'a', replace: 'a' }]).ok, false);
  });
});

describe('a new file follows the project it joins', () => {
  const controller = 'backend/src/modules/notes/controllers/notes.controller.ts';
  const express =
    "import type { Request } from 'express';\nexport const list = (req: Request) => req;\n";
  const workspace = new Map([
    ['backend/package.json', JSON.stringify({ dependencies: { express: '^4' } })],
    ['backend/src/modules/orders/controllers/orders.controller.ts', express],
    [
      'backend/src/modules/stubs/controllers/stubs.controller.ts',
      'throw new NotImplementedError();\n',
    ],
  ]);
  function create(call: ModelCaller, plannedPaths?: ReadonlySet<string>) {
    return implementFile({
      plan: {
        instruction: 'i',
        summary: 's',
        steps: [],
        research: { outcome: 'not-needed' },
      } as never,
      file: { path: controller, action: 'create', reason: 'r' },
      workspace,
      changedSoFar: [],
      call,
      ...(plannedPaths ? { plannedPaths } : {}),
    });
  }

  it('shows a finished file of the same kind and the available packages', async () => {
    const { call, sent } = scripted([{ content: express }]);
    await create(call);
    const related = sent[0]?.variables.RELATED ?? '';
    assert.match(related, /orders\.controller\.ts/);
    assert.doesNotMatch(related, /stubs\.controller\.ts/);
    assert.match(related, /Packages available in backend[\s\S]*express/);
  });

  it('refuses a framework the project does not have, and says which', async () => {
    const nest = "import { Controller } from '@nestjs/common';\nexport class C {}\n";
    const { call, sent } = scripted([{ content: nest }, { content: express }]);
    const done = await create(call);
    assert.equal(done.content, express);
    assert.match(
      sent[1]?.variables.RETRY_NOTE ?? '',
      /@nestjs\/common \(not in backend\/package\.json\)/,
    );
    assert.match(sent[1]?.variables.RETRY_NOTE ?? '', /complete file/);
  });

  it('refuses a relative import of a file nobody is creating', async () => {
    const wrong = "import { x } from '../../prisma/prisma.service';\nexport const y = x;\n";
    const { call, sent } = scripted([{ content: wrong }, { content: express }]);
    await create(call);
    assert.match(sent[1]?.variables.RETRY_NOTE ?? '', /prisma\.service \(no such file/);
  });

  it('allows an import of a file a later step creates, and built-in modules', async () => {
    const later = 'backend/src/modules/notes/services/notes.service.ts';
    const fine =
      "import { readFile } from 'node:fs';\nimport path from 'path';\nimport { s } from '../services/notes.service.js';\nexport const y = [readFile, path, s];\n";
    const { call, sent } = scripted([{ content: fine }]);
    await create(call, new Set([later]));
    assert.equal(sent.length, 1);
  });
});

describe('a schema change that cannot generate', () => {
  const schema = 'enum Role {\n  A\n}\nmodel Users {\n  id String @id\n  role Role\n}\n';
  const added = `${schema}model Notes {\n  id String @id\n  user Users @relation(fields: [userId], references: [id])\n  userId String\n  course Courses @relation(fields: [courseId], references: [id])\n  courseId String\n  @@index([userId])\n}\n`;

  it('names a relation to a model that does not exist', () => {
    assert.deepEqual(undeclaredPrismaTypes(added), ['Courses']);
    assert.deepEqual(undeclaredPrismaTypes(schema), []);
  });

  it('is sent back with the name of what is missing', () => {
    assert.deepEqual(
      missingImports({
        path: 'backend/prisma/schema.prisma',
        existing: schema,
        content: added,
        workspace: new Map(),
        plannedPaths: new Set(),
      }),
      ['Courses (no such model in the schema)'],
    );
  });
});

describe('a retry is a new request', () => {
  it('asks past the response cache on every call', async () => {
    let options: { forceRefresh?: boolean } = {};
    const generate = ((_request: unknown, sent: typeof options) => {
      options = sent;
      return Promise.resolve({
        content: '{}',
        record: {
          cacheHit: false,
          tokens: { inputTokens: 1, outputTokens: 1 },
          cost: { totalCostUsd: 0 },
          provider: 'p',
          model: 'm',
          durationMs: 1,
        },
      });
    }) as unknown as Parameters<typeof modelCaller>[0];
    await modelCaller(generate, () => undefined)({} as never, {
      stage: 's',
      agentId: 'a',
      maxOutputTokens: 1,
    });
    assert.equal(options.forceRefresh, true);
  });
});

describe('repairing a baseline that was already failing', () => {
  const site = 'frontend/src/content/site.ts';
  const page = 'frontend/src/features/landing/LandingPage.tsx';
  const baseline = [
    { path: site, content: 'export const site = 1;\n' },
    { path: page, content: "import { site } from '../../content/site';\n" },
    { path: 'backend/src/app.ts', content: 'export {};\n' },
  ];
  function failure(output: string): VerificationResult {
    return {
      ok: false,
      steps: [
        {
          id: 'typecheck',
          status: 'failed',
          command: 'tsc',
          exitCode: 2,
          durationMs: 1,
          summary: 'failed',
          output,
          reason: null,
        },
      ],
      routes: [],
      limitations: [],
      startedAt: '',
      completedAt: '',
      durationMs: 1,
    };
  }
  const repaired = baseline.map((file) =>
    file.path === page ? file : { ...file, content: `${file.content}// fixed\n` },
  );
  const planned = new Set([page]);
  const input = { planned, baseline, repaired, changedByPlan: planned };
  const siteError = "src/content/site.ts(180,7): error TS2353: 'layout' does not exist";

  it('permits a file the failure names, with the reason recorded', () => {
    const permits = baselineRepairPermits({
      ...input,
      failing: failure(siteError),
      storedBaseline: failure(siteError),
    });
    assert.deepEqual([...permits.keys()], [site]);
    assert.match(permits.get(site) ?? '', /started from failed typecheck/);
  });

  it('infers it from imports when no verdict was stored', () => {
    const permits = baselineRepairPermits({
      ...input,
      failing: failure(siteError),
      storedBaseline: undefined,
    });
    assert.match(permits.get(site) ?? '', /imports nothing this change touched/);
  });

  it('does not permit a file the failure does not name', () => {
    const permits = baselineRepairPermits({
      ...input,
      failing: failure(siteError),
      storedBaseline: undefined,
    });
    assert.equal(permits.has('backend/src/app.ts'), false);
  });

  it('does not permit a file this change may itself have broken', () => {
    const importer = 'frontend/src/App.tsx';
    const permits = baselineRepairPermits({
      planned,
      baseline: [
        ...baseline,
        { path: importer, content: "import { x } from './features/landing/LandingPage';\n" },
      ],
      repaired: [{ path: importer, content: 'changed\n' }],
      changedByPlan: planned,
      failing: failure('src/App.tsx(1,1): error TS2305'),
      storedBaseline: undefined,
    });
    assert.equal(permits.size, 0);
  });

  it('does not confuse one file for another with a longer name', () => {
    const permits = baselineRepairPermits({
      ...input,
      failing: failure('src/content/site.tsx(1,1): error'),
      storedBaseline: undefined,
    });
    assert.equal(permits.has(site), false);
  });

  it('keeps a permitted file and still restores the rest', () => {
    const { workspace, restored } = restoreUnplanned(
      planned,
      baseline,
      repaired,
      new Map([[site, 'reason']]),
    );
    assert.match(workspace.get(site) ?? '', /fixed/);
    assert.deepEqual(restored, ['backend/src/app.ts']);
  });
});

describe('classifying a visual change', () => {
  const visual = [
    'Improve the visual design of the landing page with a new hero section',
    'Make the page look more premium with a new section layout',
    'Refine the typography and spacing on the home page',
    'Improve the visual hierarchy and contrast across the page',
    'Polish the look and feel of the new landing page',
  ];
  for (const instruction of visual) {
    it(`reads "${instruction}" as visual`, () => {
      assert.equal(classifyInstruction(instruction), 'improve-visuals');
    });
  }
  it('still reads a real new page as a module', () => {
    assert.equal(classifyInstruction('Add a dashboard page and make it look good'), 'add-module');
  });
  it('still reads a stated contrast standard as accessibility', () => {
    assert.equal(
      classifyInstruction('Fix contrast ratios so the text meets WCAG AA'),
      'improve-accessibility',
    );
  });
});

describe('what adding a backend must deliver', () => {
  const baseline = [
    'backend/src/modules/weather/routes/weather.routes.ts',
    'backend/src/modules/weather/services/weather.service.ts',
    'backend/prisma/schema.prisma',
    'frontend/src/features/weather/services/weather.service.ts',
  ];
  const check: FunctionalCheckSpec = {
    kind: 'crud',
    resource: 'note',
    collectionPath: '/api/v1/notes',
    createBody: {},
    updateBody: {},
    idField: 'id',
  };

  it('needs a live round trip', () => {
    assert.equal(requiresFunctionalCheck('add-backend'), 'crud');
  });

  it('is not satisfied by the stubs a generated app already has', () => {
    assert.equal(capabilityAlreadyPresent('add-backend', baseline), false);
    const gaps = missingAreas(
      evaluateCoverage('add-backend', ['backend/src/routes.ts'], baseline),
    ).map((area) => area.area);
    assert.deepEqual(gaps, ['persistence', 'frontend-api']);
  });

  it('can reuse an existing schema, which is reported', () => {
    const schema = evaluateCoverage('add-backend', [], baseline).find(
      (area) => area.area === 'schema',
    );
    assert.equal(schema?.satisfied, true);
    assert.equal(schema.alreadyPresent, true);
  });

  it('refuses a backend no changed frontend file calls', () => {
    assert.match(
      disconnectedFrontendReason(
        'add-backend',
        [check],
        [{ path: 'frontend/src/App.tsx', content: 'const a = 1;' }],
      ) ?? '',
      /no frontend file that changed calls it/,
    );
    assert.equal(
      disconnectedFrontendReason(
        'add-backend',
        [check],
        [{ path: 'frontend/src/notes.service.ts', content: "api.get('/notes')" }],
      ),
      null,
    );
    assert.equal(disconnectedFrontendReason('add-module', [check], []), null);
  });
});
