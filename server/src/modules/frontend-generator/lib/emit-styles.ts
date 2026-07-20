/**
 * Emits the generated project's design tokens (`shared/styles/globals.css`)
 * and the `cn()` class-merging helper every component uses.
 *
 * Dark-first, one warm accent reserved for primary actions, everything else
 * cool graphite — the same restrained, Linear/Vercel-adjacent palette this
 * platform's own console uses, proven at this same quality bar rather than
 * imitated from a screenshot.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

const globalsCss = `@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --palette-canvas: #f6f6f7;
  --palette-surface: #ffffff;
  --palette-raised: #ffffff;
  --palette-inset: #eeeef0;
  --palette-line: #e2e3e6;
  --palette-line-strong: #cbccd1;
  --palette-fg: #191b1f;
  --palette-fg-muted: #5c5f66;
  --palette-fg-subtle: #8b8e96;
  --palette-accent: #4f5cc4;
  --palette-accent-hover: #4350b6;
  --palette-accent-soft: #4f5cc41a;
  --palette-success: #2f8a62;
  --palette-warning: #b07d28;
  --palette-danger: #c04747;
  --palette-danger-soft: #c047471a;
}

.dark {
  --palette-canvas: #0b0c0e;
  --palette-surface: #101114;
  --palette-raised: #16181c;
  --palette-inset: #0e0f11;
  --palette-line: #24262b;
  --palette-line-strong: #34373e;
  --palette-fg: #edeef0;
  --palette-fg-muted: #a2a5ab;
  --palette-fg-subtle: #6c6f76;
  --palette-accent: #7d8ae8;
  --palette-accent-hover: #929ded;
  --palette-accent-soft: #7d8ae824;
  --palette-success: #55b083;
  --palette-warning: #d0a04a;
  --palette-danger: #d96a6a;
  --palette-danger-soft: #d96a6a24;
}

@theme inline {
  --color-canvas: var(--palette-canvas);
  --color-surface: var(--palette-surface);
  --color-raised: var(--palette-raised);
  --color-inset: var(--palette-inset);
  --color-line: var(--palette-line);
  --color-line-strong: var(--palette-line-strong);
  --color-fg: var(--palette-fg);
  --color-fg-muted: var(--palette-fg-muted);
  --color-fg-subtle: var(--palette-fg-subtle);
  --color-accent: var(--palette-accent);
  --color-accent-hover: var(--palette-accent-hover);
  --color-accent-soft: var(--palette-accent-soft);
  --color-success: var(--palette-success);
  --color-warning: var(--palette-warning);
  --color-danger: var(--palette-danger);
  --color-danger-soft: var(--palette-danger-soft);
}

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: 1rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}

html {
  color-scheme: dark;
}
html:not(.dark) {
  color-scheme: light;
}

body {
  @apply bg-canvas font-sans text-[0.875rem] text-fg antialiased;
}

::selection {
  background: var(--palette-accent-soft);
}

:focus-visible {
  outline: 2px solid var(--palette-accent);
  outline-offset: 2px;
  border-radius: 2px;
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--palette-line-strong) transparent;
}

dialog::backdrop {
  background: color-mix(in srgb, var(--palette-canvas) 70%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

@media (prefers-contrast: more) {
  :root {
    --palette-line: var(--palette-line-strong);
  }
}
`;

const cnHelper = `import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Compose class names with correct Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
`;

export function emitStyles(): GeneratedFile[] {
  return [
    file('src/shared/styles/globals.css', 'css', globalsCss),
    file('src/shared/lib/cn.ts', 'typescript', cnHelper),
  ];
}
