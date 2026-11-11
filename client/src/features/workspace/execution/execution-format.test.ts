import { describe, expect, it } from 'vitest';

import { formatKnownCost, formatKnownTokens } from './execution-format';

describe('figures that may not be measurements', () => {
  it('never shows an unpriced model as free', () => {
    expect(formatKnownCost(0, 3, 3)).toBe('cost unknown');
  });

  it('treats zero across real calls on an older record as unknown', () => {
    expect(formatKnownCost(0, 2)).toBe('cost unknown');
  });

  it('labels a partial total', () => {
    expect(formatKnownCost(0.5, 4, 1)).toMatch(/^at least .* \(1 of 4 calls not priced\)$/);
  });

  it('shows a fully priced total plainly', () => {
    expect(formatKnownCost(0.0123, 2, 0)).toContain('0.0123');
  });

  it('reports no tokens as not reported rather than zero', () => {
    expect(formatKnownTokens(0, 2)).toBe('tokens not reported');
    expect(formatKnownTokens(100, 2, 1)).toBe('at least 100 tokens');
    expect(formatKnownTokens(100, 2)).toBe('100 tokens');
  });
});
