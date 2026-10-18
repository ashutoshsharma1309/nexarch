/**
 * The edit feature's two load-bearing claims, tested where they can be tested
 * without a model or a generated project:
 *
 * 1. An uploaded image is what it says it is. Every rejection path matters —
 *    a feature that accepts a renamed text file and sends it to a provider is
 *    worse than one that refuses it.
 * 2. "These files changed" is computed from the bytes, not asserted. The
 *    whole premise of a targeted edit is that the untouched files are
 *    provably untouched.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';

import { acceptImage, ImageRejected } from './lib/image-input.js';
import {
  changedFilesBetween,
  decideEditOutcome,
  describeChange,
} from './project-editor.service.js';
import { deriveSiteDesign } from '../frontend-generator/frontend-generator.service.js';
import type { SiteDesign } from '../frontend-generator/frontend-generator.service.js';
import type { CheckStatus } from '../../shared/types/validation.js';

/** A real PNG, built here so the test owns its own fixture. */
function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function dataUrl(bytes: Buffer, declared = 'image/png'): string {
  return `data:${declared};base64,${bytes.toString('base64')}`;
}

describe('reference image input', () => {
  it('accepts a real PNG and reads its true size', () => {
    const accepted = acceptImage({
      dataUrl: dataUrl(png(800, 600)),
      kind: 'reference',
      name: 'ref.png',
    });
    assert.equal(accepted.mediaType, 'image/png');
    assert.equal(accepted.width, 800);
    assert.equal(accepted.height, 600);
    assert.equal(accepted.kind, 'reference');
    assert.ok(accepted.dataUrl.startsWith('data:image/png;base64,'));
  });

  it('refuses a file that only claims to be an image', () => {
    const notAnImage = Buffer.from('<?php system($_GET["c"]); ?>', 'utf8');
    assert.throws(
      () => acceptImage({ dataUrl: dataUrl(notAnImage), kind: 'reference' }),
      (error: unknown) =>
        error instanceof ImageRejected && error.message.includes('not a PNG, JPEG or WebP'),
      'the declared type must not be trusted over the bytes',
    );
  });

  it('refuses an image too small to carry a design', () => {
    assert.throws(
      () => acceptImage({ dataUrl: dataUrl(png(16, 16)), kind: 'mockup' }),
      (error: unknown) =>
        error instanceof ImageRejected && error.message.includes('pixels on a side'),
    );
  });

  it('refuses an unknown kind, and says which kinds exist', () => {
    assert.throws(
      () => acceptImage({ dataUrl: dataUrl(png(400, 300)), kind: 'screenshot' }),
      (error: unknown) =>
        error instanceof ImageRejected && error.message.includes('reference, mockup, asset'),
    );
  });

  it('refuses something that is not a data URL at all', () => {
    assert.throws(
      () => acceptImage({ dataUrl: 'https://example.com/hero.png', kind: 'reference' }),
      (error: unknown) => error instanceof ImageRejected && error.message.includes('data:image'),
      'a remote URL would have the server fetch an attacker-chosen address',
    );
  });
});

describe('what an edit changed', () => {
  const before = [
    { path: 'frontend/src/content/site.ts', content: 'export const site = 1;\n' },
    { path: 'frontend/src/shared/styles/globals.css', content: ':root { --a: red; }\n' },
    { path: 'backend/src/index.ts', content: 'listen();\n' },
  ];

  it('reports only the files whose bytes differ', () => {
    const after = [
      { path: 'frontend/src/content/site.ts', content: 'export const site = 2;\n' },
      { path: 'frontend/src/shared/styles/globals.css', content: ':root { --a: red; }\n' },
      { path: 'backend/src/index.ts', content: 'listen();\n' },
    ];
    const changed = changedFilesBetween(before, after);
    assert.deepEqual(
      changed.map((file) => file.path),
      ['frontend/src/content/site.ts'],
      'an untouched backend proves the edit was targeted',
    );
    const [site] = changed;
    assert.ok(site);
    assert.equal(site.addedLines, 1);
    assert.equal(site.removedLines, 1);
  });

  it('counts a brand new file as added rather than ignoring it', () => {
    const changed = changedFilesBetween(before, [
      ...before,
      { path: 'frontend/src/components/Art.tsx', content: 'export const Art = 1;\n' },
    ]);
    assert.deepEqual(
      changed.map((file) => file.path),
      ['frontend/src/components/Art.tsx'],
    );
  });

  it('says nothing changed when nothing changed', () => {
    assert.deepEqual(changedFilesBetween(before, [...before]), []);
  });
});

describe('describing an edit before it is applied', () => {
  const spec = {
    projectName: 'Bean Lane',
    projectType: 'cafe',
    roles: ['Admin', 'User'],
    modules: ['Menu', 'Orders'],
    frontend: [],
    backend: [],
    database: ['Orders'],
    authentication: [],
    integrations: [],
    missingRequirements: [],
  };
  const current = deriveSiteDesign(spec);

  it('names the theme change in words a reviewer can check', () => {
    const next: SiteDesign = {
      ...current,
      theme: { ...current.theme, mode: 'light', fontId: 'fraunces' },
    };
    const { summary } = describeChange(current, next);
    assert.match(summary, /theme switches to light/);
    assert.match(summary, /type changes to fraunces/);
  });

  it('raises removing a section as a risk, because that is destructive', () => {
    const next: SiteDesign = {
      ...current,
      sections: current.sections.filter((section) => section.kind !== 'faq'),
    };
    const { risks } = describeChange(current, next);
    assert.ok(
      risks.some((risk) => risk.includes('faq') && risk.includes('removes it')),
      'a reviewer must be told before working content disappears',
    );
  });

  it('does not invent a change when the design is the same', () => {
    const { summary, risks } = describeChange(current, { ...current });
    assert.match(summary, /structure and theme stay as they are/);
    assert.deepEqual(risks, []);
  });
});

describe('accepting or discarding an edit', () => {
  const check = (name: string, status: CheckStatus) => ({ name, status, detail: '' });
  const validation = (checks: { name: string; status: CheckStatus }[], startedUp: boolean) => ({
    checks: checks.map((entry) => check(entry.name, entry.status)),
    startedUp,
    frontendUrl: null,
    backendUrl: null,
  });

  it('discards an edit whose build failed, and names the failure', () => {
    const { accepted, outcome } = decideEditOutcome(
      validation(
        [
          { name: 'Build', status: 'FAIL' },
          { name: 'Type check', status: 'FAIL' },
          { name: 'Startup', status: 'BLOCKED' },
        ],
        false,
      ),
      5,
      180,
    );
    assert.equal(accepted, false);
    assert.match(outcome, /Build and Type check failed/);
    assert.match(outcome, /keeps its previous files/);
  });

  it('discards an edit that builds but will not start', () => {
    const { accepted, outcome } = decideEditOutcome(
      validation(
        [
          { name: 'Build', status: 'PASS' },
          { name: 'Startup', status: 'FAIL' },
        ],
        false,
      ),
      2,
      100,
    );
    assert.equal(accepted, false);
    assert.match(outcome, /Startup failed/);
  });

  it('accepts a clean edit and reports what actually ran', () => {
    const { accepted, outcome } = decideEditOutcome(
      validation(
        [
          { name: 'Build', status: 'PASS' },
          { name: 'Type check', status: 'PASS' },
          { name: 'Startup', status: 'PASS' },
        ],
        true,
      ),
      5,
      179,
    );
    assert.equal(accepted, true);
    assert.match(outcome, /5 files changed, 174 untouched/);
  });

  it('never calls a skipped check a pass', () => {
    const { accepted, outcome } = decideEditOutcome(
      validation(
        [
          { name: 'Build', status: 'PASS' },
          { name: 'Lint', status: 'SKIPPED' },
          { name: 'Startup', status: 'PASS' },
        ],
        true,
      ),
      1,
      50,
    );
    assert.equal(accepted, true, 'a missing lint script is not a regression');
    assert.match(outcome, /Lint did not run/);
    assert.equal(
      /passed[^.]*lint/i.test(outcome),
      false,
      'lint must not appear as something that passed',
    );
  });
});
