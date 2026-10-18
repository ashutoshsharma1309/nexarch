/**
 * Gives generated applications pictures.
 *
 * Until now a generated site was type, rules and colour and nothing else:
 * honest, but a landing page with an empty hero reads as unfinished however
 * good the copy is. The obvious fixes are all worse. A stock photo URL is a
 * remote dependency that rots, ships someone else's licence and leaks the
 * visitor's IP to a CDN; a generated raster is megabytes of base64 in a source
 * file; an icon-font or illustration package is an npm dependency the user did
 * not ask for. So the art is hand-authored flat vector, inlined as a single
 * component, and drawn entirely in `currentColor` over the project's own theme
 * tokens — which means it inherits the site's accent and flips with dark mode
 * for free, and a user who restyles the palette restyles the illustrations
 * too.
 *
 * The subject is chosen from the brief's own words rather than asked of a
 * model: a bakery brief gets a croissant, a dashboard brief gets a chart, and
 * anything unrecognised gets a neutral abstract composition. Keyword matching
 * is crude but it is deterministic, free and instant, and being wrong only
 * ever costs a slightly generic picture.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

export const ART_KINDS = [
  'coffee',
  'pastry',
  'dining',
  'storefront',
  'campus',
  'book',
  'calendar',
  'health',
  'commerce',
  'analytics',
  'code',
  'abstract',
] as const;

export type ArtKind = (typeof ART_KINDS)[number];

export function isArtKind(value: unknown): value is ArtKind {
  return typeof value === 'string' && (ART_KINDS as readonly string[]).includes(value);
}

/**
 * The keyword table, in the order it is tested. Order is the whole design:
 * briefs mix vocabularies ("coffee shop", "course booking", "product
 * dashboard"), so the more specific subject is listed first and wins. Narrow
 * trades (coffee, pastry) precede the broader category they sit in (dining,
 * storefront), concrete nouns precede abstractions, and the generic business
 * vocabularies (commerce, analytics, code) come last because almost every
 * brief contains some of them.
 */
const KEYWORD_PRIORITY: readonly { readonly kind: ArtKind; readonly words: readonly string[] }[] = [
  {
    kind: 'coffee',
    words: ['coffee', 'espresso', 'latte', 'cappuccino', 'cafe', 'barista', 'roastery'],
  },
  {
    kind: 'pastry',
    words: ['pastry', 'pastries', 'bakery', 'croissant', 'cake', 'dessert', 'bread', 'patisserie'],
  },
  {
    kind: 'dining',
    words: ['menu', 'dish', 'dishes', 'restaurant', 'food', 'meal', 'cuisine', 'kitchen', 'bistro'],
  },
  {
    kind: 'storefront',
    words: ['shop', 'store', 'location', 'visit', 'address', 'boutique', 'storefront'],
  },
  {
    kind: 'campus',
    words: ['campus', 'college', 'university', 'school', 'student', 'faculty', 'academy'],
  },
  {
    kind: 'book',
    words: [
      'course',
      'class',
      'classes',
      'library',
      'learn',
      'learning',
      'lesson',
      'study',
      'book',
    ],
  },
  {
    kind: 'calendar',
    words: [
      'hours',
      'schedule',
      'timetable',
      'calendar',
      'booking',
      'reservation',
      'appointment',
      'availability',
    ],
  },
  {
    kind: 'health',
    words: ['health', 'clinic', 'patient', 'doctor', 'medical', 'care', 'dentist', 'wellness'],
  },
  {
    kind: 'commerce',
    words: ['product', 'cart', 'checkout', 'order', 'shipping', 'price', 'pricing', 'catalog'],
  },
  {
    kind: 'analytics',
    words: ['dashboard', 'metric', 'analytics', 'report', 'chart', 'insight', 'kpi'],
  },
  {
    kind: 'code',
    words: [
      'code',
      'build',
      'deploy',
      'test',
      'api',
      'developer',
      'engineering',
      'sdk',
      'repository',
    ],
  },
];

/**
 * Each keyword matches on word boundaries, so "booking" never trips the
 * standalone "book", with an optional plural suffix so "orders" and "dishes"
 * match the singular entry. Everything is case-insensitive.
 */
const MATCHERS = KEYWORD_PRIORITY.map((entry) => ({
  kind: entry.kind,
  pattern: new RegExp(`\\b(?:${entry.words.join('|')})(?:e?s)?\\b`, 'i'),
}));

/** The subject for a brief, or `'abstract'` when nothing in it is recognised. */
export function artForKeywords(text: string): ArtKind {
  for (const matcher of MATCHERS) {
    if (matcher.pattern.test(text)) return matcher.kind;
  }
  return 'abstract';
}

const art = `/**
 * Inline flat-vector illustrations. Every shape is painted in \`currentColor\`
 * over the theme tokens, so the art follows the site's accent and dark mode;
 * restyle it by changing the palette, not this file.
 */
import type { ReactNode } from 'react';

export type ArtKind =
${ART_KINDS.map((kind) => `  | '${kind}'`).join('\n')};

const shapes: Record<ArtKind, ReactNode> = {
  coffee: (
    <>
      <circle cx="200" cy="150" r="108" opacity="0.08" />
      <ellipse cx="192" cy="216" rx="106" ry="18" opacity="0.16" />
      <ellipse cx="192" cy="210" rx="80" ry="13" opacity="0.22" />
      <path d="M258 158c24 0 36 11 36 24s-12 24-36 24" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" opacity="0.5" />
      <path d="M126 142h132l-11 56a56 22 0 0 1-110 0z" opacity="0.9" />
      <ellipse cx="192" cy="142" rx="66" ry="13" opacity="0.5" />
      <ellipse cx="192" cy="142" rx="52" ry="9" opacity="0.85" />
      <g className="text-fg-subtle" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.5">
        <path d="M172 110c-11-13 7-19-2-31" />
        <path d="M202 104c-11-13 7-19-2-31" />
        <path d="M232 112c-9-11 6-16-2-26" />
      </g>
    </>
  ),
  pastry: (
    <>
      <circle cx="200" cy="150" r="108" opacity="0.07" />
      <ellipse cx="144" cy="208" rx="84" ry="15" opacity="0.16" />
      <path d="M78 178c0-34 30-58 66-58s66 24 66 58c0 9-9 13-17 8-14-8-30-12-49-12s-35 4-49 12c-8 5-17 1-17-8z" opacity="0.8" />
      <g className="text-fg-subtle" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.45">
        <path d="M112 136c6 14 6 28 2 40" />
        <path d="M144 126c4 16 4 32 0 46" />
        <path d="M176 136c-6 14-6 28-2 40" />
      </g>
      <ellipse cx="300" cy="206" rx="68" ry="13" opacity="0.18" />
      <path d="M262 196l34-66 36 66z" opacity="0.75" />
      <path d="M274 174h44" stroke="currentColor" strokeWidth="5" opacity="0.35" />
      <circle cx="296" cy="124" r="9" opacity="0.6" />
    </>
  ),
  dining: (
    <>
      <circle cx="200" cy="150" r="110" opacity="0.07" />
      <circle cx="200" cy="150" r="78" opacity="0.2" />
      <circle cx="200" cy="150" r="58" opacity="0.28" />
      <circle cx="200" cy="148" r="30" opacity="0.5" />
      <circle cx="176" cy="174" r="9" opacity="0.4" />
      <circle cx="224" cy="176" r="7" opacity="0.4" />
      <g opacity="0.65">
        <rect x="92" y="78" width="7" height="38" rx="3" />
        <rect x="103" y="78" width="7" height="38" rx="3" />
        <rect x="114" y="78" width="7" height="38" rx="3" />
        <path d="M92 110h29v18a14 14 0 0 1-9 13l-1 83h-9l-1-83a14 14 0 0 1-9-13z" />
        <path d="M292 78c12 11 14 29 12 49l-3 25h-13l-2-29c-1-20 1-34 6-45z" />
        <rect x="291" y="152" width="11" height="72" rx="5" />
      </g>
    </>
  ),
  storefront: (
    <>
      <rect x="56" y="76" width="288" height="26" rx="8" opacity="0.3" />
      <rect x="56" y="96" width="288" height="128" rx="8" opacity="0.14" />
      <path d="M64 110h272v22l-17 12-17-12-17 12-17-12-17 12-17-12-17 12-17-12-17 12-17-12-17 12-17-12-17 12-17-12z" opacity="0.45" />
      <rect x="88" y="160" width="94" height="52" rx="6" opacity="0.4" />
      <path d="M135 160v52" stroke="currentColor" strokeWidth="5" opacity="0.3" />
      <rect x="212" y="150" width="68" height="74" rx="6" opacity="0.6" />
      <circle cx="268" cy="188" r="5" opacity="0.9" />
      <rect x="40" y="224" width="320" height="9" rx="4" opacity="0.22" />
    </>
  ),
  campus: (
    <>
      <rect x="78" y="150" width="72" height="74" rx="4" opacity="0.3" />
      <rect x="250" y="150" width="72" height="74" rx="4" opacity="0.3" />
      <rect x="150" y="110" width="100" height="114" rx="4" opacity="0.5" />
      <path d="M148 112l52-36 52 36z" opacity="0.6" />
      <path d="M200 76V48" stroke="currentColor" strokeWidth="5" opacity="0.6" />
      <path d="M200 48h32l-9 10 9 10h-32z" opacity="0.75" />
      <circle cx="200" cy="146" r="17" opacity="0.9" />
      <g className="text-fg-subtle" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.85">
        <path d="M200 146v-9" />
        <path d="M200 146h7" />
      </g>
      <g opacity="0.55">
        <rect x="94" y="166" width="18" height="22" rx="3" />
        <rect x="120" y="166" width="18" height="22" rx="3" />
        <rect x="262" y="166" width="18" height="22" rx="3" />
        <rect x="288" y="166" width="18" height="22" rx="3" />
        <rect x="176" y="178" width="20" height="26" rx="3" />
        <rect x="204" y="178" width="20" height="26" rx="3" />
      </g>
      <rect x="40" y="224" width="320" height="9" rx="4" opacity="0.22" />
    </>
  ),
  book: (
    <>
      <circle cx="200" cy="168" r="106" opacity="0.07" />
      <path d="M200 112c-26-18-62-24-96-20v110c34-4 70 2 96 20z" opacity="0.32" />
      <path d="M200 112c26-18 62-24 96-20v110c-34-4-70 2-96 20z" opacity="0.45" />
      <rect x="195" y="106" width="10" height="120" rx="5" opacity="0.8" />
      <g className="text-fg-subtle" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.45">
        <path d="M124 144h56" />
        <path d="M124 164h48" />
        <path d="M124 184h56" />
        <path d="M220 144h56" />
        <path d="M220 164h48" />
        <path d="M220 184h56" />
      </g>
      <path d="M232 100v62l15-13 15 13v-66z" opacity="0.6" />
    </>
  ),
  calendar: (
    <>
      <rect x="126" y="60" width="11" height="36" rx="5" opacity="0.7" />
      <rect x="263" y="60" width="11" height="36" rx="5" opacity="0.7" />
      <rect x="78" y="86" width="244" height="156" rx="14" opacity="0.14" />
      <rect x="78" y="86" width="244" height="156" rx="14" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M78 100a14 14 0 0 1 14-14h216a14 14 0 0 1 14 14v26H78z" opacity="0.6" />
      {[0, 1, 2, 3, 4].map((col) =>
        [0, 1, 2].map((row) => (
          <rect key={col + '-' + row} x={104 + col * 44} y={146 + row * 34} width="24" height="20" rx="6" opacity={col === 2 && row === 1 ? 0.9 : 0.25} />
        )),
      )}
    </>
  ),
  health: (
    <>
      <circle cx="200" cy="150" r="110" opacity="0.07" />
      <rect x="118" y="68" width="164" height="164" rx="38" opacity="0.16" />
      <path d="M178 88h44v40h40v44h-40v40h-44v-40h-40v-44h40z" opacity="0.75" />
      <g className="text-fg-subtle" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.5">
        <path d="M94 254h44l16-26 18 48 20-64 18 42h96" />
      </g>
    </>
  ),
  commerce: (
    <>
      <circle cx="200" cy="158" r="108" opacity="0.07" />
      <path d="M164 118v-14a36 36 0 0 1 72 0v14" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.65" />
      <path d="M120 124h160l-12 108a16 16 0 0 1-16 14H148a16 16 0 0 1-16-14z" opacity="0.32" />
      <rect x="110" y="110" width="180" height="24" rx="10" opacity="0.55" />
      <path d="M232 168l44 44-30 30-44-44v-30z" fill="none" stroke="currentColor" strokeWidth="8" opacity="0.85" />
      <circle cx="220" cy="186" r="7" opacity="0.85" />
    </>
  ),
  analytics: (
    <>
      <rect x="68" y="72" width="264" height="168" rx="16" opacity="0.12" />
      <rect x="68" y="72" width="264" height="168" rx="16" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M96 208h208" stroke="currentColor" strokeWidth="4" opacity="0.3" />
      {[34, 62, 48, 80, 100].map((height, index) => (
        <rect key={index} x={104 + index * 44} y={208 - height} width="26" height={height} rx="6" opacity={0.3 + index * 0.08} />
      ))}
      <path d="M117 120l44-22 44 14 44-28 44-16" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.9" />
      {[120, 98, 112, 84, 68].map((y, index) => (
        <circle key={index} cx={117 + index * 44} cy={y} r="6" opacity="0.9" />
      ))}
    </>
  ),
  code: (
    <>
      <rect x="60" y="68" width="280" height="166" rx="14" opacity="0.12" />
      <rect x="60" y="68" width="280" height="166" rx="14" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M60 82a14 14 0 0 1 14-14h252a14 14 0 0 1 14 14v22H60z" opacity="0.3" />
      <g opacity="0.6">
        <circle cx="84" cy="90" r="6" />
        <circle cx="104" cy="90" r="6" />
        <circle cx="124" cy="90" r="6" />
      </g>
      <path d="M84 128l13 11-13 11" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.9" />
      <g className="text-fg-subtle" fill="currentColor">
        <rect x="108" y="134" width="46" height="10" rx="5" opacity="0.55" />
        <rect x="162" y="134" width="70" height="10" rx="5" opacity="0.35" />
        <rect x="124" y="158" width="38" height="10" rx="5" opacity="0.5" />
        <rect x="170" y="158" width="58" height="10" rx="5" opacity="0.3" />
        <rect x="124" y="182" width="62" height="10" rx="5" opacity="0.5" />
        <rect x="194" y="182" width="34" height="10" rx="5" opacity="0.3" />
        <rect x="108" y="206" width="40" height="10" rx="5" opacity="0.45" />
      </g>
      <rect x="156" y="202" width="13" height="18" rx="2" opacity="0.9" />
    </>
  ),
  abstract: (
    <>
      <circle cx="252" cy="168" r="94" opacity="0.1" />
      <circle cx="148" cy="130" r="78" opacity="0.18" />
      <rect x="104" y="166" width="96" height="96" rx="28" opacity="0.3" transform="rotate(-14 152 214)" />
      <path d="M88 240c42-80 90-120 224-152" fill="none" stroke="currentColor" strokeWidth="8" opacity="0.3" />
      <circle cx="268" cy="104" r="34" opacity="0.5" />
      <path d="M312 206v46a46 46 0 0 1-46-46z" opacity="0.45" />
      <circle cx="200" cy="150" r="14" opacity="0.9" />
    </>
  ),
};

/**
 * Resolves through a partial view of the table so an unexpected kind at
 * runtime — a hand-edited prop, stale data — degrades to the abstract
 * composition instead of rendering an empty box.
 */
function shapeFor(kind: ArtKind): ReactNode {
  const known: Partial<Record<ArtKind, ReactNode>> = shapes;
  return known[kind] ?? shapes.abstract;
}

/** A labelled illustration is content; an unlabelled one is decoration. */
export function Art({ kind, label, className }: { kind: ArtKind; label?: string; className?: string }) {
  const described = label !== undefined && label.trim().length > 0;
  const a11y = described
    ? { role: 'img' as const, 'aria-label': label }
    : { role: 'presentation' as const, 'aria-hidden': true };

  return (
    <svg
      {...a11y}
      viewBox="0 0 400 300"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      fill="currentColor"
      className={['text-accent', className ?? ''].join(' ').trim()}
    >
      {shapeFor(kind)}
    </svg>
  );
}
`;

export function emitArt(): GeneratedFile[] {
  return [file('src/components/Art.tsx', 'typescriptreact', art)];
}
