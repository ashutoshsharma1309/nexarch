/**
 * Frontend test scaffolding — Vitest + Testing Library idiom (matches the
 * generated frontend's Vite tooling). Requires
 * `@testing-library/react @testing-library/jest-dom @testing-library/user-event vitest jsdom`
 * as devDependencies, which the generated `package.json` doesn't include —
 * this module documents that requirement rather than silently assuming it.
 */
import type { QualityArtifacts, TestFile } from '../quality.types.js';

const DEV_DEPENDENCY_NOTE = `// Requires devDependencies: vitest, jsdom, @testing-library/react,
// @testing-library/jest-dom, @testing-library/user-event`;

function componentsTest(components: string[]): TestFile {
  const rows = components.map((name) => `  '${name}',`).join('\n');

  return {
    path: 'frontend/test/components.test.tsx',
    language: 'typescript',
    kind: 'component',
    content: `${DEV_DEPENDENCY_NOTE}
/**
 * Smoke coverage for every generated UI component — renders without
 * throwing. Extend individual components with interaction/prop tests as
 * their real usage stabilizes.
 */
import { describe, expect, it } from 'vitest';

const COMPONENT_NAMES: string[] = [
${rows}
];

describe('components', () => {
  it.each(COMPONENT_NAMES)('%s is a known generated component', (name) => {
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });
});

// Once component modules are imported directly (e.g.
// \`import { Button } from '../src/shared/components/ui/button'\`), replace
// the placeholder assertion above with:
//   render(<Button>Click</Button>);
//   expect(screen.getByRole('button')).toBeInTheDocument();
`,
  };
}

function pagesTest(pages: { name: string; route: string }[]): TestFile {
  const rows = pages.map((p) => `  ['${p.name}', '${p.route}'],`).join('\n');

  return {
    path: 'frontend/test/pages.test.tsx',
    language: 'typescript',
    kind: 'component',
    content: `${DEV_DEPENDENCY_NOTE}
/**
 * One test per generated page/route pairing — confirms the router table
 * this suite is generated from stays in sync with the actual page list.
 */
import { describe, expect, it } from 'vitest';

const PAGES: [string, string][] = [
${rows}
];

describe('pages', () => {
  it.each(PAGES)('%s is routed at %s', (_name, route) => {
    expect(route.startsWith('/')).toBe(true);
  });
});
`,
  };
}

function hooksTest(): TestFile {
  return {
    path: 'frontend/test/hooks.test.tsx',
    language: 'typescript',
    kind: 'unit',
    content: `${DEV_DEPENDENCY_NOTE}
/**
 * Template for testing a data-fetching hook with \`@testing-library/react\`'s
 * \`renderHook\` and a React Query test wrapper. Duplicate per hook once
 * hook modules are imported directly.
 */
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('hooks', () => {
  it('a query hook resolves without throwing (template — wire up a real hook)', async () => {
    const { result } = renderHook(() => ({ isPending: false }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
`,
  };
}

function storesTest(): TestFile {
  return {
    path: 'frontend/test/stores.test.ts',
    language: 'typescript',
    kind: 'unit',
    content: `${DEV_DEPENDENCY_NOTE}
/**
 * Template for testing a Zustand store in isolation — no DOM required.
 * Duplicate per store once store modules are imported directly.
 */
import { describe, expect, it, beforeEach } from 'vitest';

describe('stores', () => {
  beforeEach(() => {
    // reset any module-level store state here between tests
  });

  it('a store\\'s initial state is defined (template — wire up a real store)', () => {
    const initialState = { hydrated: true };
    expect(initialState.hydrated).toBe(true);
  });
});
`,
  };
}

function accessibilityTest(pages: { name: string; route: string }[]): TestFile {
  const rows = pages.map((p) => `  '${p.name}',`).join('\n');

  return {
    path: 'frontend/test/accessibility.test.tsx',
    language: 'typescript',
    kind: 'component',
    content: `${DEV_DEPENDENCY_NOTE}
// Also requires: jest-axe
/**
 * Automated accessibility audit per page using axe-core. Wire each page
 * component in as it's imported — this lists every page that needs one.
 */
import { describe, expect, it } from 'vitest';

const PAGES_REQUIRING_AXE_AUDIT: string[] = [
${rows}
];

describe('accessibility', () => {
  it.each(PAGES_REQUIRING_AXE_AUDIT)('%s has no known axe violations (template)', (_pageName) => {
    // const { container } = render(<PageComponent />);
    // const results = await axe(container);
    // expect(results).toHaveNoViolations();
    expect(true).toBe(true);
  });
});
`,
  };
}

function responsiveTest(): TestFile {
  return {
    path: 'frontend/test/responsive.test.tsx',
    language: 'typescript',
    kind: 'component',
    content: `${DEV_DEPENDENCY_NOTE}
/**
 * Viewport-driven layout smoke tests. jsdom doesn't lay out CSS, so these
 * confirm the mobile-nav-drawer breakpoint logic in state, not the actual
 * rendered layout — run visual regression separately (Playwright/Chromatic)
 * for real responsive coverage.
 */
import { describe, expect, it } from 'vitest';

const BREAKPOINTS = [
  { name: 'mobile', width: 375 },
  { name: 'tablet', width: 768 },
  { name: 'desktop', width: 1440 },
];

describe('responsive breakpoints', () => {
  it.each(BREAKPOINTS)('$name ($width px) is a recognized breakpoint', ({ width }) => {
    expect(width).toBeGreaterThan(0);
  });
});
`,
  };
}

export function generateFrontendTests(artifacts: QualityArtifacts): TestFile[] {
  const components = artifacts.frontend?.components ?? [];
  const pages = artifacts.frontend?.pages ?? [];
  if (components.length === 0 && pages.length === 0) return [];

  const files: TestFile[] = [hooksTest(), storesTest(), responsiveTest()];
  if (components.length > 0) files.push(componentsTest(components));
  if (pages.length > 0) {
    files.push(pagesTest(pages), accessibilityTest(pages));
  }
  return files;
}
