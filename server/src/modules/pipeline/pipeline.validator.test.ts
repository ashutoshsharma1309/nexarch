import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validationResult } from 'express-validator';
import type { Request } from 'express';

import { MAX_REFERENCE_URLS, startRunValidation } from './pipeline.validator.js';

async function errorsFor(referenceUrls: unknown): Promise<string[]> {
  const req = {
    body: {
      prompt: 'Build a website for a neighbourhood bakery.',
      ...(referenceUrls === undefined ? {} : { referenceUrls }),
    },
  } as unknown as Request;
  await Promise.all(startRunValidation.map((chain) => chain.run(req)));
  return validationResult(req)
    .array()
    .map((error) => String(error.msg));
}

describe('reference URL validation', () => {
  it('is optional', async () => {
    assert.deepEqual(await errorsFor(undefined), []);
  });

  it('accepts public pages', async () => {
    assert.deepEqual(await errorsFor(['https://example.com/', 'http://example.org/about']), []);
  });

  it('refuses what research must never fetch', async () => {
    for (const url of [
      'http://127.0.0.1/admin',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      'https://user:secret@example.com/',
      'https://example.com/installer.exe',
    ]) {
      assert.ok((await errorsFor([url])).length > 0, url);
    }
  });

  it('refuses a non-list, a non-string and too many', async () => {
    assert.ok((await errorsFor('https://example.com/')).length > 0);
    assert.ok((await errorsFor([42])).length > 0);
    const many = Array.from(
      { length: MAX_REFERENCE_URLS + 1 },
      (_, index) => `https://example.com/${String(index)}`,
    );
    assert.ok((await errorsFor(many)).length > 0);
  });
});
