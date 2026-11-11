import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSecurityStatus } from '../health/security-status.js';
import { redactString } from '../../shared/security/redact.js';
import { isLoopbackHost, isLoopbackPeer, noAuthRefusal, safeListenHost } from './lib/auth-mode.js';

describe('no-auth mode limits', () => {
  it('refuses AUTH_DISABLED only in production', () => {
    assert.match(
      noAuthRefusal({ disabled: true, isProduction: true }) ?? '',
      /AUTH_DISABLED=true is refused/,
    );
    assert.equal(noAuthRefusal({ disabled: true, isProduction: false }), null);
    assert.equal(noAuthRefusal({ disabled: false, isProduction: true }), null);
  });

  it('accepts only loopback Host headers, which is what stops DNS rebinding', () => {
    for (const host of [
      'localhost',
      'localhost:4000',
      'LOCALHOST:5173',
      '127.0.0.1:4000',
      '[::1]:4000',
    ]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of [
      'evil.example',
      'evil.example:4000',
      'localhost.evil.example',
      '192.168.1.5',
      undefined,
    ]) {
      assert.equal(isLoopbackHost(host), false, String(host));
    }
  });

  it('accepts only loopback peers', () => {
    for (const peer of ['127.0.0.1', '127.8.9.1', '::1', '::ffff:127.0.0.1']) {
      assert.equal(isLoopbackPeer(peer), true, peer);
    }
    for (const peer of [
      '192.168.1.20',
      '10.0.0.5',
      '::ffff:192.168.1.20',
      '1270.0.0.1',
      undefined,
    ]) {
      assert.equal(isLoopbackPeer(peer), false, String(peer));
    }
  });

  it('listens on loopback only while login is off', () => {
    assert.equal(safeListenHost(true), '127.0.0.1');
    assert.equal(safeListenHost(false), undefined);
  });
});

describe('security status truthfulness', () => {
  it('never reports the sandbox as passing, and says why', () => {
    const sandbox = getSecurityStatus().checks.find((check) => check.category === 'Sandbox');
    assert.ok(sandbox);
    assert.notEqual(sandbox.state, 'PASS');
    assert.match(sandbox.detail, /No OS-level isolation/);
  });
});

describe('hyphenated provider keys', () => {
  it('masks OpenRouter, Anthropic and OpenAI project key shapes', () => {
    for (const key of [
      `sk-or-v1-${'a'.repeat(40)}`,
      `sk-ant-api03-${'b'.repeat(40)}`,
      `sk-proj-${'c'.repeat(40)}`,
    ]) {
      assert.equal(redactString(`failed with ${key} here`), 'failed with *** here');
    }
  });

  it('leaves ordinary hyphenated words alone', () => {
    const text = 'task-management-dashboard-and-risk-assessment-framework';
    assert.equal(redactString(text), text);
  });
});
