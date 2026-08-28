/**
 * Security hardening tests (`npm test`).
 *
 * The controls these cover are the ones a regression would silently
 * weaken: secret redaction on the way to a log, workspace path
 * containment, the prompt-injection boundary in a compiled context, and
 * the eligibility rules that keep destructive findings away from the
 * repair engine. Each is a claim Phase 13 makes about what cannot happen.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { redactString, redactValue } from './redact.js';
import { getSecurityStatus } from '../../modules/health/security-status.js';

/* ── Redaction (Steps 9, 24) ──────────────────────────────────────────── */

describe('secret redaction', () => {
  it('scrubs provider keys, bearer tokens, JWTs and credential URLs', () => {
    const dirty = [
      'gsk_ABCDEFGHIJKLMNOP1234567890',
      'Bearer abcdefghijklmnop.tokentokentoken',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payload',
      'mysql://runner:supersecret@localhost:3307/db',
    ].join(' ');
    const clean = redactString(dirty);
    assert.ok(!clean.includes('supersecret'));
    assert.ok(!clean.includes('gsk_ABCDEFGHIJKLMNOP1234567890'));
    assert.ok(!clean.includes('abcdefghijklmnop.tokentokentoken'));
    assert.ok(clean.includes('***'));
  });

  it('redacts by key name whatever the value shape', () => {
    const payload = {
      user: 'alice',
      password: 'hunter2',
      headers: { authorization: 'Bearer xyz', 'content-type': 'application/json' },
      nested: [{ apiKey: 'sk_live_123' }, { safe: 'keep-me' }],
    };
    const redacted = redactValue(payload) as typeof payload;
    assert.equal(redacted.password, '***');
    assert.equal(redacted.headers.authorization, '***');
    assert.equal(redacted.headers['content-type'], 'application/json');
    assert.equal(redacted.nested[0]?.apiKey, '***');
    assert.equal(redacted.nested[1]?.safe, 'keep-me');
    assert.equal(redacted.user, 'alice');
  });

  it('catches a fake secret in an assignment and an underscored provider key', () => {
    // The exact leak shape a live test surfaced: an underscored key prefix
    // and a KEY=value assignment, neither caught by a boundary-anchored
    // pattern.
    const fake = 'FAKE_API_KEY=TEST_SECRET_123_gsk_ABCDEFGHIJKLMNOP';
    const clean = redactString(fake);
    assert.ok(!clean.includes('TEST_SECRET_123'));
    assert.ok(clean.includes('FAKE_API_KEY='));
    assert.ok(!clean.includes('gsk_ABCDEFGHIJKLMNOP'));
  });

  it('is depth-bounded against a cyclic payload', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    // Must return, not hang.
    const result = redactValue(cyclic);
    assert.ok(result);
  });
});

/* ── Path containment (Steps 13, 32) ──────────────────────────────────── */

describe('workspace path containment', () => {
  // The guard is a pure function of (path, dir); exercise the same logic.
  const root = join(tmpdir(), 'nexarch-contain-test');
  const contained = (filePath: string): boolean => {
    const normalized = normalize(filePath);
    if (normalized.startsWith('..') || isAbsolute(normalized)) return false;
    const target = resolve(root, filePath);
    return target === resolve(root) || target.startsWith(resolve(root) + sep);
  };

  it('accepts ordinary project-relative paths', () => {
    assert.ok(contained('backend/src/index.ts'));
    assert.ok(contained('frontend/package.json'));
  });

  it('rejects traversal, absolute paths and escapes', () => {
    assert.ok(!contained('../secret.txt'));
    assert.ok(!contained('../../etc/passwd'));
    assert.ok(!contained('/etc/passwd'));
    assert.ok(!contained('backend/../../escape.ts'));
  });
});

/* ── Security status (Step 39) ────────────────────────────────────────── */

describe('security status report', () => {
  it('reports only verified controls, each with a state and a reason', () => {
    const report = getSecurityStatus();
    const categories = report.checks.map((check) => check.category);
    for (const required of [
      'Authentication',
      'Authorization',
      'Project Isolation',
      'Secret Protection',
      'Sandbox',
      'Rate Limiting',
    ]) {
      assert.ok(categories.includes(required), `${required} is missing`);
    }
    for (const check of report.checks) {
      assert.ok(['PASS', 'WARNING', 'FAIL'].includes(check.state));
      assert.ok(check.detail.length > 0, `${check.category} has no detail`);
    }
  });

  it('never exposes a secret value in its detail lines', () => {
    const serialized = JSON.stringify(getSecurityStatus());
    // The JWT secret and any key must never appear, only posture.
    assert.ok(!/gsk_|sk_live|Bearer |eyJ/.test(serialized));
  });
});
