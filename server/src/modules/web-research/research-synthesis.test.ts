import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { synthesizeResearch } from './lib/research-synthesis.js';
import type { generate } from '../ai-orchestrator/ai-orchestrator.service.js';
import type { ResearchSource } from './web-research.types.js';

function source(id: string, chars: number): ResearchSource {
  return {
    id,
    title: id,
    url: 'https://example.com/' + id,
    retrievalKind: 'extracted-page',
    excerpt: 'x'.repeat(chars),
  } as unknown as ResearchSource;
}

function answering(body: unknown) {
  let sent: { variables?: Record<string, string> } = {};
  const fn = ((request: { variables?: Record<string, string> }) => {
    sent = request;
    return Promise.resolve({
      content: JSON.stringify(body),
      record: {
        provider: 'groq',
        model: 'm',
        tokens: { inputTokens: 1, outputTokens: 1 },
        cost: { totalCostUsd: 0, pricing: { known: true } },
        durationMs: 1,
        cacheHit: false,
      },
    });
  }) as unknown as typeof generate;
  return { fn, sent: () => sent };
}

const base = { prompt: 'p', objective: 'o', domainLabel: 'd', questions: ['q'], timeoutMs: 1_000 };

describe('citations are checked against what the model was sent', () => {
  it('drops a claim citing a source the evidence budget left out', async () => {
    const claim = (id: string) => ({ statement: 'A fact.', sourceIds: [id], confidence: 'high' });
    const { fn, sent } = answering({ findings: [claim('in'), claim('out')] });
    const outcome = await synthesizeResearch(
      { ...base, sources: [source('in', 100), source('out', 3_000)], maxEvidenceChars: 600 },
      fn,
    );
    assert.equal(sent().variables?.ALLOWED_SOURCE_IDS, 'in');
    assert.deepEqual(
      outcome.fields.findings.map((finding) => finding.sourceIds),
      [['in']],
    );
    assert.match(outcome.limitations.join(' '), /left out because the evidence limit/);
    assert.match(outcome.limitations.join(' '), /dropped/);
  });
});

describe('the model call has a time budget', () => {
  it('passes one shorter than its own limit, so the call is cancelled and not abandoned', async () => {
    let options: { timeBudgetMs?: number } | undefined;
    const { fn } = answering({ findings: [] });
    const capture = ((request: never, callOptions: typeof options) => {
      options = callOptions;
      return fn(request);
    }) as unknown as typeof generate;

    await synthesizeResearch(
      { ...base, timeoutMs: 60_000, sources: [source('in', 100)], maxEvidenceChars: 600 },
      capture,
    );

    assert.ok((options?.timeBudgetMs ?? 0) < 60_000);
    assert.ok((options?.timeBudgetMs ?? 0) > 55_000);
  });

  it('says no provider answered in time only when the time really ran out', async () => {
    const outcome = await synthesizeResearch(
      { ...base, timeoutMs: 30, sources: [source('in', 100)], maxEvidenceChars: 600 },
      (() => new Promise(() => undefined)) as unknown as typeof generate,
    );
    assert.equal(outcome.succeeded, false);
    assert.match(outcome.limitations.join(' '), /no AI provider answered within/);
  });

  it('says the providers refused when the chain ran out before the clock did', async () => {
    const outcome = await synthesizeResearch(
      { ...base, timeoutMs: 40_000, sources: [source('in', 100)], maxEvidenceChars: 600 },
      () => Promise.reject(new Error('Request timed out')),
    );
    assert.equal(outcome.succeeded, false);
    assert.match(outcome.limitations.join(' '), /refused or failed/);
    assert.doesNotMatch(outcome.limitations.join(' '), /within the/);
  });
});
