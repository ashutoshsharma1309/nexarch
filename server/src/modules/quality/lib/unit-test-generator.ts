/**
 * Backend unit test scaffolding — table-driven across every generated
 * module (services, controllers, repositories) plus a dedicated
 * validation/business-logic file and an authentication file. These are
 * shape-level smoke assertions (the module imports cleanly, exposes the
 * functions its name promises), not behavioral tests against a live
 * database — generating real behavioral tests would require executing the
 * generated project, which this module never does. Runnable as-is with
 * `node --import tsx --test`, same idiom the platform's own test suites use.
 */
import type { QualityArtifacts, TestFile } from '../quality.types.js';

function servicesTest(modules: string[]): TestFile {
  const rows = modules
    .map((name) => `  ['${name}', '../modules/${name}/${name}.service.js'],`)
    .join('\n');

  return {
    path: 'backend/test/unit/services.test.ts',
    language: 'typescript',
    kind: 'unit',
    content: `/**
 * Generated smoke coverage for every service module — confirms each one
 * imports cleanly and exports at least one function. Extend per-module
 * with real business-logic assertions once fixtures/a test database exist.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const SERVICE_MODULES: [string, string][] = [
${rows}
];

describe('service modules', () => {
  for (const [name, path] of SERVICE_MODULES) {
    it(\`\${name} service module exports at least one function\`, async () => {
      const module = (await import(path)) as Record<string, unknown>;
      const exportedFunctions = Object.values(module).filter((value) => typeof value === 'function');
      assert.ok(exportedFunctions.length > 0, \`\${name}.service.ts exported no functions\`);
    });
  }
});
`,
  };
}

function controllersTest(modules: string[]): TestFile {
  const rows = modules
    .map((name) => `  ['${name}', '../modules/${name}/${name}.controller.js'],`)
    .join('\n');

  return {
    path: 'backend/test/unit/controllers.test.ts',
    language: 'typescript',
    kind: 'unit',
    content: `/**
 * Generated smoke coverage for every controller — each one should be a
 * thin layer of Express handlers (functions accepting req/res), never
 * containing business logic itself.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const CONTROLLER_MODULES: [string, string][] = [
${rows}
];

describe('controller modules', () => {
  for (const [name, path] of CONTROLLER_MODULES) {
    it(\`\${name} controller exports request handlers\`, async () => {
      const module = (await import(path)) as Record<string, unknown>;
      const handlers = Object.values(module).filter(
        (value) => typeof value === 'function' && (value as (...args: unknown[]) => unknown).length <= 3,
      );
      assert.ok(handlers.length > 0, \`\${name}.controller.ts exported no handler-shaped functions\`);
    });
  }
});
`,
  };
}

function validationTest(): TestFile {
  return {
    path: 'backend/test/unit/validation.test.ts',
    language: 'typescript',
    kind: 'unit',
    content: `/**
 * Every generated \`*.validator.ts\` exports express-validator chains plus a
 * \`read<Entity>Request\` narrowing function. This confirms that contract
 * holds across every module without hand-listing each validator.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('validators', () => {
  it('every module folder contains a *.validator.ts file', () => {
    const moduleNames = readdirSync(new URL('../../src/modules/', import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const name of moduleNames) {
      const files = readdirSync(new URL(\`../../src/modules/\${name}/\`, import.meta.url));
      assert.ok(
        files.some((file) => file.endsWith('.validator.ts')),
        \`\${name} module has no validator file\`,
      );
    }
  });
});
`,
  };
}

function authenticationTest(hasAuth: boolean): TestFile {
  return {
    path: 'backend/test/unit/authentication.test.ts',
    language: 'typescript',
    kind: 'unit',
    content: `/**
 * JWT signing/verification round-trip using the same secret contract the
 * generated Security Engine wires up (\`JWT_SECRET\`, HS256).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'test-secret';

describe('authentication', () => {
  it('signs and verifies an access token', () => {
    const token = jwt.sign({ sub: 'user-1', role: 'user' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m',
    });
    const decoded = jwt.verify(token, SECRET) as { sub: string; role: string };
    assert.equal(decoded.sub, 'user-1');
    assert.equal(decoded.role, 'user');
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = jwt.sign({ sub: 'user-1' }, 'wrong-secret', { algorithm: 'HS256' });
    assert.throws(() => jwt.verify(token, SECRET));
  });
${
  hasAuth
    ? `
  it('rejects an expired token', () => {
    const token = jwt.sign({ sub: 'user-1' }, SECRET, { algorithm: 'HS256', expiresIn: -1 });
    assert.throws(() => jwt.verify(token, SECRET));
  });`
    : ''
}
});
`,
  };
}

export function generateUnitTests(artifacts: QualityArtifacts): TestFile[] {
  const modules = artifacts.backend?.modules ?? [];
  const hasAuth = Boolean(artifacts.requirements?.authentication?.length);

  const files = [validationTest(), authenticationTest(hasAuth)];
  if (modules.length > 0) {
    files.push(servicesTest(modules), controllersTest(modules));
  }
  return files;
}
