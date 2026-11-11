import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { aiConfigured, analyzeWithAi, designEntityFields, writeSiteDesign } from './ai-stages.js';
import type { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import type { EntityPlan } from '../../../shared/types/architecture.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const KEYS = [
  'GROQ_API_KEY',
  'AI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'CEREBRAS_API_KEY',
];
const saved = new Map<string, string | undefined>();

const spec: RequirementSpec = {
  projectName: 'Clinic',
  projectType: 'healthcare',
  roles: ['Admin'],
  modules: ['Appointments'],
  frontend: [],
  backend: [],
  database: ['Users'],
  authentication: [],
  integrations: [],
  missingRequirements: [],
};

function answering(body: unknown): typeof generate {
  return (() =>
    Promise.resolve({
      content: JSON.stringify(body),
      record: {
        provider: 'groq',
        model: 'm',
        tokens: { inputTokens: 5, outputTokens: 5 },
        cost: { totalCostUsd: 0.001 },
        durationMs: 1,
        retries: 0,
        cacheHit: false,
      },
    })) as unknown as typeof generate;
}

describe('ai stages', () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved.set(key, process.env[key]);
      Reflect.deleteProperty(process.env, key);
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it('counts any configured provider, not just the first two', () => {
    assert.equal(aiConfigured(), false);
    process.env.OPENROUTER_API_KEY = 'test-value';
    assert.equal(aiConfigured(), true);
  });

  it('marks evidence applied only when a model answer built on it was used', async () => {
    process.env.OPENROUTER_API_KEY = 'test-value';
    const sections = {
      sections: [{ kind: 'hero', id: 'top', navLabel: 'Home', headline: 'Care close to home' }],
    };
    const used = await writeSiteDesign('A clinic website.', spec, [], {
      evidence: 'Findings: clinics list treatments.',
      researchIncluded: true,
      callModel: answering(sections),
    });
    assert.equal(used.degraded, false);
    assert.equal(used.evidenceApplied, true);

    // The mock's answer is valid JSON, so the design brief alone proves the
    // distinction: a brief is not research.
    const briefOnly = await writeSiteDesign('A clinic website.', spec, [], {
      evidence: 'Design brief.',
      researchIncluded: false,
    });
    assert.equal(briefOnly.evidenceApplied, false);
  });

  it('reports the fallback when no section of the answer was usable', async () => {
    process.env.OPENROUTER_API_KEY = 'test-value';
    const outcome = await writeSiteDesign('A clinic website.', spec, [], {
      evidence: 'Findings.',
      researchIncluded: true,
      callModel: answering({ sections: [] }),
    });
    assert.equal(outcome.degraded, true);
    assert.equal(outcome.evidenceApplied, false);
    assert.match(outcome.note ?? '', /no usable page sections/);
  });

  describe('entity fields', () => {
    const entities = [
      { name: 'Patient', keyFields: ['id', 'created_at', 'updated_at'], relations: [] },
    ] as unknown as EntityPlan[];
    const context = { projectName: 'Clinic', projectType: 'healthcare' };

    it('marks evidence applied when a field reached an entity', async () => {
      process.env.OPENROUTER_API_KEY = 'test-value';
      const answer = { entities: [{ name: 'Patient', fields: ['full_name'] }] };
      const outcome = await designEntityFields(entities, context, 'Findings.', answering(answer));
      assert.equal(outcome.degraded, false);
      assert.equal(outcome.evidenceApplied, true);
      assert.ok(outcome.value[0]?.keyFields.includes('full_name'));
    });

    it('reports the fallback when no returned field survived', async () => {
      process.env.OPENROUTER_API_KEY = 'test-value';
      const answer = { entities: [{ name: 'Nobody', fields: ['full_name'] }] };
      const outcome = await designEntityFields(entities, context, 'Findings.', answering(answer));
      assert.equal(outcome.degraded, true);
      assert.equal(outcome.evidenceApplied, false);
    });
  });

  it('does not claim evidence when no model ran', async () => {
    const offline = await writeSiteDesign('A clinic website.', spec, [], {
      evidence: 'Findings.',
      researchIncluded: true,
    });
    assert.equal(offline.evidenceApplied, undefined);
    const analysis = await analyzeWithAi(
      'A clinic booking system for patients.',
      'Clinic',
      'Findings.',
    );
    assert.equal(analysis.evidenceApplied, undefined);
  });
});
