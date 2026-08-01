/**
 * Vitest setup — loaded once before every suite. Registers Testing
 * Library's jest-dom matchers on Vitest's `expect` (and their TypeScript
 * augmentation, since this file is part of the tsconfig program) and
 * unmounts rendered trees between tests so suites can't leak DOM state
 * into each other.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
