/**
 * Shared-lib tests: the tiny pure utilities every feature leans on. These
 * encode the behaviors callers actually depend on — Tailwind conflict
 * resolution in `cn`, the slug fallback contract, and the relative-time
 * boundaries — so a future refactor can't silently change them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cn } from './cn';
import { formatDate, formatRelativeTime } from './format';
import { slugify } from './slugify';

describe('cn', () => {
  it('resolves Tailwind conflicts in favor of the later class', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy conditionals and keeps independent classes', () => {
    const active = false as boolean; // widened — the conditional is the point of the test
    expect(cn('text-fg', active && 'bg-raised', 'rounded-md')).toBe('text-fg rounded-md');
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates, and trims punctuation runs', () => {
    expect(slugify('  My Project!! v2 ', 'x')).toBe('my-project-v2');
  });

  it('falls back when the input is all punctuation or whitespace', () => {
    expect(slugify('!!! ???', 'project')).toBe('project');
    expect(slugify('', 'project')).toBe('project');
  });
});

describe('format', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats an ISO date as "Mon D, YYYY"', () => {
    expect(formatDate('2026-07-18T10:00:00.000Z')).toMatch(/Jul 1[78], 2026/);
  });

  it('reports under a minute as "just now" and larger gaps in the right unit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'));

    expect(formatRelativeTime('2026-07-22T11:59:30.000Z')).toBe('just now');
    expect(formatRelativeTime('2026-07-22T11:57:00.000Z')).toBe('3 minutes ago');
    expect(formatRelativeTime('2026-07-22T09:00:00.000Z')).toBe('3 hours ago');
    expect(formatRelativeTime('2026-07-15T12:00:00.000Z')).toBe('last week');
  });
});
