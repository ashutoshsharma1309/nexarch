import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  callsService,
  deriveCapabilities,
  evaluateCapabilities,
  findStubs,
  isConnected,
} from './capability-coverage.js';
import { describeRunOutcome } from './verification-stage.js';
import type { FeatureResult } from './feature-implementation.js';
import { namedServices, decideProduct } from './product-decision.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const spec: RequirementSpec = {
  projectName: 'Thing',
  projectType: 'custom',
  roles: [],
  modules: ['Authentication', 'Widgets'],
  frontend: [],
  backend: [],
  database: [],
  authentication: [],
  integrations: [],
  missingRequirements: [],
  functionalRequirements: ['Add widgets to a saved basket', 'Filter widgets by colour'],
};

const needed = { needed: true, reason: 'r', signals: ['acme'] };
const notNeeded = { needed: false, reason: 'r', signals: [] };

describe('capability derivation', () => {
  it('lists named services first, then functional requirements', () => {
    const list = deriveCapabilities(spec, { externalApis: needed });
    assert.equal(list[0]?.service, 'acme');
    assert.equal(list[1]?.title, 'Add widgets to a saved basket');
  });

  it('leaves out capabilities the product decision ruled out', () => {
    const withLogin = {
      ...spec,
      functionalRequirements: ['A customer can register and log in', 'Browse the widget catalogue'],
    };
    const titles = deriveCapabilities(withLogin, {
      externalApis: notNeeded,
      authentication: notNeeded,
    }).map((c) => c.title);
    assert.deepEqual(titles, ['Browse the widget catalogue']);
  });

  it('falls back to modules, leaving out generic chrome', () => {
    const bare = { ...spec, functionalRequirements: [] };
    const titles = deriveCapabilities(bare, { externalApis: notNeeded }).map((c) => c.title);
    assert.deepEqual(titles, ['Widgets']);
  });
});

describe('stub finding', () => {
  it('finds handlers that cannot work and pages that say so', () => {
    const stubs = findStubs(
      new Map([
        ['backend/src/modules/x/x.controller.ts', "throw new NotImplementedError('x');"],
        ['backend/src/shared/errors/app-error.ts', 'export class NotImplementedError {}'],
        ['frontend/src/features/x/XPage.tsx', '<p>This module is not implemented yet.</p>'],
        ['frontend/src/features/y/YPage.tsx', 'export const y = 1;'],
      ]),
    );
    assert.deepEqual(
      stubs.map((stub) => stub.kind),
      ['not-implemented-handler', 'placeholder-page'],
    );
  });
});

describe('connection and service checks', () => {
  it('sees a new page wired through the alias', () => {
    const files = new Map([
      ['frontend/src/features/a/APage.tsx', 'export function A() {}'],
      ['frontend/src/app/other.tsx', "import('@/features/a/APage')"],
    ]);
    assert.equal(isConnected('frontend/src/features/a/APage.tsx', files), true);
    files.set('frontend/src/app/other.tsx', 'nothing');
    assert.equal(isConnected('frontend/src/features/a/APage.tsx', files), false);
  });

  it('requires a real call, and ignores marketing copy', () => {
    const copy = new Map([['frontend/src/content/site.ts', "'Powered by Acme Maps https://x'"]]);
    assert.equal(callsService('Acme Maps', copy), false);
    const called = new Map([
      ['backend/src/modules/m/m.service.ts', "await fetch('https://api.acmemaps.com/v1')"],
    ]);
    assert.equal(callsService('Acme Maps', called), true);
  });
});

describe('capability evaluation', () => {
  const capability = {
    id: 'C1',
    title: 'Saved basket',
    detail: 'd',
    source: 'requirement' as const,
  };

  it('reports a capability nothing implements as missing, with why', () => {
    const coverage = evaluateCapabilities({
      capabilities: [capability],
      implementedBy: new Map(),
      files: new Map(),
      changed: [],
      stubs: [],
    });
    assert.equal(coverage[0]?.status, 'missing');
    assert.match(coverage[0].gaps[0] ?? '', /No file/);
  });

  it('maps a delivered capability to the files that do it', () => {
    const path = 'backend/src/modules/b/basket.service.ts';
    const files = new Map([
      [path, 'export class BasketService { saved() {} }'],
      [
        'backend/src/modules/b/basket.controller.ts',
        "import { BasketService } from './basket.service.js';",
      ],
    ]);
    const coverage = evaluateCapabilities({
      capabilities: [capability],
      implementedBy: new Map([['C1', [path]]]),
      files,
      changed: [path],
      stubs: [],
    });
    assert.deepEqual(coverage[0], {
      id: 'C1',
      title: 'Saved basket',
      source: 'requirement',
      status: 'implemented',
      files: [path],
      gaps: [],
    });
  });

  it('will not credit a schema or seed change as a delivered capability', () => {
    const schema = 'backend/prisma/schema.prisma';
    const coverage = evaluateCapabilities({
      capabilities: [capability],
      implementedBy: new Map([['C1', [schema]]]),
      files: new Map([[schema, 'model SavedBasket { id Int }']]),
      changed: [schema],
      stubs: [],
    });
    assert.equal(coverage[0]?.status, 'missing');
    assert.match(coverage[0].gaps.join(' '), /no application code/);
  });

  it('will not credit backend code no page uses when the project has a frontend', () => {
    const service = 'backend/src/modules/b/basket.service.ts';
    const files = new Map([
      [service, 'export function savedBasket() {}'],
      ['backend/src/routes.ts', "import { savedBasket } from './modules/b/basket.service.js';"],
      ['frontend/src/features/x/XPage.tsx', 'export const x = 1;'],
    ]);
    const coverage = evaluateCapabilities({
      capabilities: [capability],
      implementedBy: new Map([['C1', [service]]]),
      files,
      changed: [service],
      stubs: [],
    });
    assert.equal(coverage[0]?.status, 'missing');
    assert.match(coverage[0].gaps.join(' '), /No page uses it/);
  });

  it('will not credit a file that is still a placeholder', () => {
    const path = 'backend/src/modules/b/basket.service.ts';
    const files = new Map([[path, 'saved basket']]);
    const coverage = evaluateCapabilities({
      capabilities: [capability],
      implementedBy: new Map([['C1', [path]]]),
      files,
      changed: [path],
      stubs: [{ path, kind: 'not-implemented-handler' }],
    });
    assert.equal(coverage[0]?.status, 'missing');
  });
});

describe('named service detection', () => {
  it('finds a service named before API and after integrate', () => {
    const names = namedServices('Show weather from the Open-Meteo API and integrate with Twilio.');
    assert.ok(names.some((name) => name.toLowerCase() === 'open-meteo'));
    assert.ok(names.some((name) => name.toLowerCase() === 'twilio'));
  });

  it('does not treat generic phrases as a service', () => {
    assert.deepEqual(namedServices('A REST API and a public API for our own app.'), []);
  });

  it('marks external APIs needed in the decision', () => {
    const decision = decideProduct('A weather app using the Open-Meteo API', {
      appAuthEnabled: true,
    });
    assert.equal(decision.externalApis.needed, true);
    assert.ok(decision.externalApis.signals.includes('open-meteo'));
  });

  it('reads a named integration from the requirements only when the request names it', () => {
    const named = decideProduct('A weather app using Open-Meteo for forecasts', {
      appAuthEnabled: true,
      integrations: ['Open-Meteo forecasts'],
    });
    assert.equal(named.externalApis.needed, true);
    const unrequested = decideProduct('A student records system', {
      appAuthEnabled: true,
      integrations: ['Twilio SMS'],
    });
    assert.equal(unrequested.externalApis.needed, false);
  });
});

describe('run outcome', () => {
  const feature = (status: FeatureResult['status']): FeatureResult => ({
    status,
    capabilities: [
      {
        id: 'C1',
        title: 'Saved basket',
        source: 'requirement',
        status: 'missing',
        files: [],
        gaps: ['x'],
      },
    ],
    stubsFound: [],
    stubsRemaining: [],
    filesChanged: [],
    passes: 1,
    modelCalls: 1,
    inputTokens: 0,
    outputTokens: 0,
    budgetExhausted: false,
    limitations: [],
  });
  const verification = (ok: boolean, stepStatus: 'failed' | 'blocked') => ({
    result: {
      ok,
      steps: [{ id: 'build', status: ok ? ('passed' as const) : stepStatus, summary: 'x' }],
      routes: [],
      limitations: [],
    },
    repairAttempts: 0,
    repaired: false,
    limitations: [],
  });

  it('says plainly when verification failed', () => {
    const outcome = describeRunOutcome(verification(false, 'failed') as never, undefined);
    assert.equal(outcome.outcome, 'verification-failed');
    assert.match(outcome.detail, /did not pass verification/);
  });

  it('distinguishes a blocked check from a failed one', () => {
    assert.equal(
      describeRunOutcome(verification(false, 'blocked') as never, undefined).outcome,
      'verification-blocked',
    );
  });

  it('does not call a passing build complete when a capability is missing', () => {
    const outcome = describeRunOutcome(verification(true, 'failed') as never, feature('partial'));
    assert.equal(outcome.outcome, 'incomplete');
    assert.match(outcome.detail, /Saved basket/);
  });

  it('reports verified only when both are true', () => {
    assert.equal(
      describeRunOutcome(verification(true, 'failed') as never, undefined).outcome,
      'verified',
    );
  });

  it('says it was not verified when no check ran', () => {
    assert.equal(describeRunOutcome(undefined, undefined).outcome, 'unverified');
  });
});
