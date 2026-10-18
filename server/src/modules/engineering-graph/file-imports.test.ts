/**
 * The knowledge graph is only worth having if its edges are true. These tests
 * are therefore mostly about what must *not* appear: a dependency on a
 * package that is not in the project, an edge to a file that does not exist,
 * and above all a relationship inferred from two files merely sharing a
 * directory. A graph that invents edges is worse than no graph, because it is
 * believed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { folderTree, isConfigFile, parentFolder, resolveImports } from './lib/file-imports.js';

const FILES = [
  {
    path: 'backend/src/modules/orders/orders.service.ts',
    content: [
      "import { prisma } from '../../shared/db.js';",
      "import { logger } from '@/shared/logger.js';",
      "import express from 'express';",
      "import './side-effect.js';",
      "export { helper } from './orders.helpers.js';",
    ].join('\n'),
  },
  { path: 'backend/src/shared/db.ts', content: 'export const prisma = {};\n' },
  { path: 'backend/src/shared/logger.ts', content: 'export const logger = {};\n' },
  { path: 'backend/src/modules/orders/side-effect.ts', content: 'console.log("hi");\n' },
  { path: 'backend/src/modules/orders/orders.helpers.ts', content: 'export const helper = 1;\n' },
  {
    path: 'backend/src/modules/orders/orders.service.test.ts',
    content: "import { createOrder } from './orders.service.js';\n",
  },
  // A sibling that nobody imports: same folder, no relationship.
  { path: 'backend/src/modules/orders/unrelated.ts', content: 'export const x = 1;\n' },
  { path: 'backend/package.json', content: '{"dependencies":{"express":"^5.0.0"}}' },
];

describe('file imports', () => {
  it('resolves relative, aliased, side-effect and re-export specifiers', () => {
    const edges = resolveImports(FILES);
    const from = 'backend/src/modules/orders/orders.service.ts';
    const targets = edges.filter((edge) => edge.from === from).map((edge) => edge.to);

    assert.deepEqual(targets.sort(), [
      'backend/src/modules/orders/orders.helpers.ts',
      'backend/src/modules/orders/side-effect.ts',
      'backend/src/shared/db.ts',
      'backend/src/shared/logger.ts',
    ]);
  });

  it('rewrites the ESM .js specifier to the .ts file that actually exists', () => {
    const edge = resolveImports(FILES).find(
      (candidate) => candidate.to === 'backend/src/shared/db.ts',
    );
    assert.equal(edge?.specifier, '../../shared/db.js', 'the claim is kept verbatim');
  });

  it('never invents an edge for a package or a file that is not there', () => {
    const edges = resolveImports([
      ...FILES,
      {
        path: 'backend/src/modules/orders/ghost.ts',
        content: "import x from './does-not-exist.js';\nimport y from 'left-pad';\n",
      },
    ]);
    assert.equal(
      edges.some((edge) => edge.from === 'backend/src/modules/orders/ghost.ts'),
      false,
    );
    assert.equal(
      edges.some((edge) => edge.to.includes('left-pad') || edge.to.includes('express')),
      false,
      'external packages are modelled as dependencies, not as files',
    );
  });

  it('does not treat sharing a directory as a dependency', () => {
    const edges = resolveImports(FILES);
    assert.equal(
      edges.some((edge) => edge.to === 'backend/src/modules/orders/unrelated.ts'),
      false,
    );
  });

  it('reads containment off the paths, parents first', () => {
    const folders = folderTree(FILES.map((file) => file.path));
    const byPath = new Map(folders.map((folder) => [folder.path, folder.parent]));

    assert.equal(byPath.get('backend'), null);
    assert.equal(byPath.get('backend/src'), 'backend');
    assert.equal(byPath.get('backend/src/modules/orders'), 'backend/src/modules');
    assert.equal(parentFolder('backend/package.json'), 'backend');
    assert.equal(parentFolder('README.md'), null);
  });

  it('tells configuration from source', () => {
    assert.equal(isConfigFile('backend/package.json'), true);
    assert.equal(isConfigFile('frontend/vite.config.ts'), true);
    assert.equal(isConfigFile('backend/.env'), true);
    assert.equal(isConfigFile('backend/src/modules/orders/orders.service.ts'), false);
  });
});
