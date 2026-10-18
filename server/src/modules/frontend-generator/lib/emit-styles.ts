/**
 * Emits the generated project's design tokens (`shared/styles/globals.css`)
 * and the `cn()` class-merging helper every component uses.
 *
 * The token *names* are fixed — every generated component is written against
 * `canvas / surface / fg / accent …`, and that is what makes the design
 * system coherent. The token *values* are not: they come from the site
 * design, so a cafe gets warm paper and a developer tool gets cool graphite
 * from the same components. Before this, every generated project shipped the
 * identical dark palette no matter what was asked for.
 *
 * The structural CSS below the palette — focus rings, reduced motion,
 * contrast, scrollbars — stays fixed. It is accessibility behaviour, not
 * taste, and a model has no business rewriting it.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';
import { fontOf, paletteFor, type SitePalette, type SiteTheme } from './site-content.js';

const CORNER_RADII = {
  sharp: ['0.125rem', '0.25rem', '0.375rem'],
  soft: ['0.375rem', '0.5rem', '0.75rem'],
  round: ['0.625rem', '0.875rem', '1.25rem'],
} as const;

/**
 * The design's palette, written as the light and dark halves of the theme.
 *
 * Both halves are always emitted: the generated app keeps its theme toggle,
 * and a visitor who flips it should get a considered palette rather than the
 * platform default. The design decides which half the app opens in.
 */
function paletteBlocks(theme: SiteTheme): string {
  const chosen = theme.palette;
  const other = paletteFor(
    theme.mode === 'dark' ? 'light' : 'dark',
    theme.temperature,
    chosen.accent,
  );
  const light = theme.mode === 'light' ? chosen : other;
  const dark = theme.mode === 'dark' ? chosen : other;

  return `:root {
${tokens(light)}
}

.dark {
${tokens(dark)}
}`;
}

function tokens(palette: SitePalette): string {
  return [
    `  --palette-canvas: ${palette.canvas};`,
    `  --palette-surface: ${palette.surface};`,
    `  --palette-raised: ${palette.raised};`,
    `  --palette-inset: ${palette.inset};`,
    `  --palette-line: ${palette.line};`,
    `  --palette-line-strong: ${palette.lineStrong};`,
    `  --palette-fg: ${palette.fg};`,
    `  --palette-fg-muted: ${palette.fgMuted};`,
    `  --palette-fg-subtle: ${palette.fgSubtle};`,
    `  --palette-accent: ${palette.accent};`,
    `  --palette-accent-hover: ${palette.accentHover};`,
    `  --palette-accent-soft: ${palette.accentSoft};`,
    `  --palette-accent-fg: ${palette.accentFg};`,
    `  --palette-success: ${palette.success};`,
    `  --palette-warning: ${palette.warning};`,
    `  --palette-danger: ${palette.danger};`,
    `  --palette-danger-soft: ${palette.dangerSoft};`,
  ].join('\n');
}

function globalsCss(theme: SiteTheme): string {
  const font = fontOf(theme);
  const [sm, md, lg] = CORNER_RADII[theme.corners];
  return `@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

${paletteBlocks(theme)}

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
  --color-accent-fg: var(--palette-accent-fg);
  --color-success: var(--palette-success);
  --color-warning: var(--palette-warning);
  --color-danger: var(--palette-danger);
  --color-danger-soft: var(--palette-danger-soft);
}

@theme {
  --font-sans: ${font.stack}, ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: 1rem;
  --radius-sm: ${sm};
  --radius-md: ${md};
  --radius-lg: ${lg};
}

html {
  color-scheme: ${theme.mode};
}
html${theme.mode === 'dark' ? ':not(.dark)' : '.dark'} {
  color-scheme: ${theme.mode === 'dark' ? 'light' : 'dark'};
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
}

const cnHelper = `import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Compose class names with correct Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
`;

export function emitStyles(theme: SiteTheme): GeneratedFile[] {
  return [
    file('src/shared/styles/globals.css', 'css', globalsCss(theme)),
    file('src/shared/lib/cn.ts', 'typescript', cnHelper),
  ];
}
