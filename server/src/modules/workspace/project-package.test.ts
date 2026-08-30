/**
 * Project package tests (`npm test`).
 *
 * The package is a trust boundary in both directions: export must never let
 * a secret out, import must never let a hostile path in. These tests pin
 * exactly those two guarantees, plus the round-trip and version handling,
 * because a package format that is wrong about safety is worse than none —
 * it is a file a user is invited to share and to open.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPackage,
  isPortableArtifact,
  PACKAGE_SCHEMA_VERSION,
  validatePackage,
} from './lib/project-package.js';
import type { ExportInput } from './lib/project-package.js';

function sampleExport(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    name: 'Shop',
    description: 'A shop.',
    artifacts: [
      { type: 'requirement-spec', version: 1, summary: null, content: { modules: ['auth'] } },
      { type: 'api-contract', version: 1, summary: null, content: { paths: {} } },
    ],
    graphNodes: [
      { id: 'n1', type: 'SERVICE', canonicalName: 'order', name: 'OrderService', metadata: {} },
      { id: 'n2', type: 'ENTITY', canonicalName: 'order-entity', name: 'Orders', metadata: {} },
    ],
    graphEdges: [{ sourceNodeId: 'n1', relationship: 'PERSISTS', targetNodeId: 'n2' }],
    findings: [],
    validation: null,
    repairs: [],
    ...overrides,
  };
}

/* ── Export secret safety (Step 39) ───────────────────────────────────── */

describe('export', () => {
  it('redacts secrets out of every part of the package', () => {
    const pkg = buildPackage(
      sampleExport({
        artifacts: [
          {
            type: 'requirement-spec',
            version: 1,
            summary: null,
            content: {
              env: 'DATABASE_URL=mysql://runner:supersecret@localhost:3307/db',
              apiKey: 'gsk_ABCDEFGHIJKLMNOP123456',
              note: 'password: hunter2fake',
            },
          },
        ],
      }),
    );
    const serialized = JSON.stringify(pkg);
    assert.ok(!serialized.includes('supersecret'));
    assert.ok(!serialized.includes('gsk_ABCDEFGHIJKLMNOP123456'));
    assert.ok(!serialized.includes('hunter2fake'));
  });

  it('preserves deeply nested content while still redacting a deep secret', () => {
    // An artifact nests far deeper than a log payload: a spec carries
    // modules, each with endpoints, each with parameters. The redactor must
    // not shear that structure into a marker — but a secret buried at the
    // bottom must still be caught. This pins the depth regression: reusing
    // the shallow log-depth default corrupted every value below depth 6.
    const deepArtifact = {
      type: 'architecture-plan',
      version: 1,
      summary: null,
      content: {
        apiModules: [
          {
            module: 'orders',
            endpoints: [
              {
                method: 'POST',
                path: '/orders',
                params: [{ name: 'total', in: 'body', note: 'the order total' }],
                config: { apiKey: 'gsk_DEEPSECRETVALUE0001', retries: 3 },
              },
            ],
          },
        ],
      },
    };
    const serialized = JSON.stringify(buildPackage(sampleExport({ artifacts: [deepArtifact] })));

    // No structure was truncated into the depth marker...
    assert.ok(!serialized.includes('[redacted-depth]'));
    // ...real values below depth 6 (endpoint, path, nested param) survived...
    assert.ok(serialized.includes('"method":"POST"'));
    assert.ok(serialized.includes('"path":"/orders"'));
    assert.ok(serialized.includes('"name":"total"'));
    // ...but a secret buried at the bottom was still redacted.
    assert.ok(!serialized.includes('gsk_DEEPSECRETVALUE0001'));
  });

  it('rewrites graph edges to canonical names and drops danglers', () => {
    const pkg = buildPackage(
      sampleExport({
        graphEdges: [
          { sourceNodeId: 'n1', relationship: 'PERSISTS', targetNodeId: 'n2' },
          { sourceNodeId: 'n1', relationship: 'USES', targetNodeId: 'missing' },
        ],
      }),
    );
    assert.equal(pkg.graph.edges.length, 1);
    assert.deepEqual(pkg.graph.edges[0], {
      from: 'order',
      relationship: 'PERSISTS',
      to: 'order-entity',
    });
  });

  it('carries only portable artifact types', () => {
    const pkg = buildPackage(
      sampleExport({
        artifacts: [
          { type: 'requirement-spec', version: 1, summary: null, content: {} },
          { type: 'backend-source', version: 1, summary: null, content: { files: [] } },
        ],
      }),
    );
    assert.equal(pkg.artifacts.length, 1);
    assert.equal(pkg.artifacts[0]?.type, 'requirement-spec');
    assert.ok(!isPortableArtifact('backend-source'));
  });
});

/* ── Import validation (Steps 22, 38) ─────────────────────────────────── */

describe('import validation', () => {
  const valid = buildPackage(sampleExport());

  it('accepts a well-formed package it just built', () => {
    const out = validatePackage(JSON.parse(JSON.stringify(valid)));
    assert.equal(out.schemaVersion, PACKAGE_SCHEMA_VERSION);
    assert.equal(out.project.name, 'Shop');
  });

  it('rejects an unsupported schema version', () => {
    assert.throws(() => validatePackage({ ...valid, schemaVersion: 999 }), /schema version/);
  });

  it('rejects a package with no project name', () => {
    assert.throws(() => validatePackage({ ...valid, project: { name: '', description: null } }));
  });

  it('rejects a traversal path inside an artifact (Step 38)', () => {
    assert.throws(
      () =>
        validatePackage({
          ...valid,
          artifacts: [
            {
              type: 'backend-metadata',
              version: 1,
              summary: null,
              content: { files: [{ path: '../../etc/passwd', content: 'x' }] },
            },
          ],
        }),
      /unsafe file path/,
    );
  });

  it('rejects an absolute path inside an artifact', () => {
    assert.throws(() =>
      validatePackage({
        ...valid,
        artifacts: [
          {
            type: 'backend-metadata',
            version: 1,
            summary: null,
            content: { files: [{ path: '/etc/shadow', content: 'x' }] },
          },
        ],
      }),
    );
  });

  it('rejects an unsupported artifact type', () => {
    assert.throws(() =>
      validatePackage({
        ...valid,
        artifacts: [{ type: 'malware-blob', version: 1, summary: null, content: {} }],
      }),
    );
  });

  it('rejects a non-object package', () => {
    assert.throws(() => validatePackage('not a package'));
    assert.throws(() => validatePackage(null));
  });

  it('drops graph edges that reference undeclared nodes rather than trusting them', () => {
    const out = validatePackage({
      ...valid,
      graph: {
        nodes: [{ type: 'SERVICE', canonicalName: 'a', name: 'A', metadata: {} }],
        edges: [{ from: 'a', relationship: 'USES', to: 'ghost' }],
      },
    });
    assert.equal(out.graph.edges.length, 0);
  });
});
