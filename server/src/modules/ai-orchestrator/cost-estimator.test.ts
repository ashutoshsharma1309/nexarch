/**
 * Cost estimator tests. The arithmetic matters least here: what these
 * cover is the refusal. A model with no published price must report no
 * cost, because by the time a borrowed-rate figure reaches the UI it is
 * indistinguishable from a measured one. Rates asserted below are the ones
 * recorded in `lib/model-pricing.ts`, with the dollar figures worked out by
 * hand in each test so a silent table edit fails loudly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estimateCost } from './lib/cost-estimator.js';
import { getProvider } from './lib/providers/provider-registry.js';

const groq = getProvider('groq');
const openrouter = getProvider('openrouter');
const mock = getProvider('mock');

describe('cost estimator', () => {
  it('prices a known model from that model’s own published rate', () => {
    // openai/gpt-oss-120b: $0.15 per million in, $0.60 per million out.
    //  12,000 in  -> 0.012 * 0.15 = $0.0018
    //   3,000 out -> 0.003 * 0.60 = $0.0018
    const estimate = estimateCost(groq, 'openai/gpt-oss-120b', {
      inputTokens: 12_000,
      outputTokens: 3_000,
    });

    assert.equal(estimate.inputCostUsd, 0.0018);
    assert.equal(estimate.outputCostUsd, 0.0018);
    assert.equal(estimate.totalCostUsd, 0.0036);
    assert.equal(estimate.pricing.known, true);
    assert.equal(estimate.provider, 'groq');
  });

  it('charges two models on one provider their two different rates', () => {
    // The defect this module was rewritten for: both of these came back
    // identical, because the rate was read off the provider object.
    const usage = { inputTokens: 100_000, outputTokens: 50_000 };

    // gpt-oss-20b: 0.1 * $0.075 + 0.05 * $0.30 = $0.0225
    assert.equal(estimateCost(groq, 'openai/gpt-oss-20b', usage).totalCostUsd, 0.0225);
    // qwen3.8-27b: 0.1 * $0.80 + 0.05 * $4.00 = $0.28 — 12.4x the above
    assert.equal(estimateCost(groq, 'qwen/qwen3.8-27b', usage).totalCostUsd, 0.28);
  });

  it('reports an unknown cost, not zero, for a model it has no price for', () => {
    const estimate = estimateCost(openrouter, 'openrouter/auto', {
      inputTokens: 40_000,
      outputTokens: 10_000,
    });

    assert.equal(estimate.inputCostUsd, null);
    assert.equal(estimate.outputCostUsd, null);
    assert.equal(estimate.totalCostUsd, null);
    // The narrowing is the assertion: an unpriced estimate must carry a
    // reason naming the model, not just a null total.
    assert.ok(!estimate.pricing.known);
    assert.match(estimate.pricing.reason, /openrouter\/auto/);
  });

  it('costs nothing for zero tokens on a priced model', () => {
    const estimate = estimateCost(groq, 'openai/gpt-oss-120b', {
      inputTokens: 0,
      outputTokens: 0,
    });

    assert.equal(estimate.totalCostUsd, 0);
    assert.equal(estimate.pricing.known, true);
  });

  it('prices the offline provider at a known zero rather than unknown', () => {
    // The mock runs no inference, so $0 is a fact about it. Reporting it as
    // unknown would make every test-suite and unconfigured-install total
    // unknown for no reason.
    const estimate = estimateCost(mock, 'mock-1', { inputTokens: 5_000, outputTokens: 2_000 });

    assert.equal(estimate.totalCostUsd, 0);
    assert.equal(estimate.pricing.known, true);
  });
});
