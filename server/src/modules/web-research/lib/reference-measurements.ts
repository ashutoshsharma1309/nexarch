/**
 * Validates what a rendered page reported and states it as design facts.
 *
 * Everything entering here came from a script running inside a possibly hostile
 * page, so it is rebuilt field by field: numbers are clamped, categories come
 * from fixed lists, colours must parse, and a font name survives only if it is
 * a widely licensed typeface. No string the page chose can reach a later prompt.
 */
import type {
  ReferenceAnalysis,
  ReferenceFontKind,
  ReferenceHeroLayout,
  ReferenceMeasurements,
  ReferenceNavPattern,
  ReferenceSectionKind,
  ReferenceViewportMeasurements,
} from '../web-research.types.js';

const SECTION_KINDS: readonly ReferenceSectionKind[] = [
  'header',
  'hero',
  'media-grid',
  'card-grid',
  'split-media',
  'media-band',
  'text-block',
  'form',
  'footer',
  'other',
];
const NAV_PATTERNS: readonly ReferenceNavPattern[] = [
  'horizontal-bar',
  'vertical-list',
  'hamburger',
  'none',
];
const HERO_LAYOUTS: readonly ReferenceHeroLayout[] = [
  'text-over-media',
  'split',
  'stacked',
  'text-only',
  'media-only',
];

const SERIF = 'serif';
const SANS = 'sans-serif';
const MONO = 'monospace';

/** Open or system faces: naming one says nothing about whose site this is. */
const PUBLIC_TYPEFACES: Readonly<Record<string, ReferenceFontKind>> = {
  arial: SANS,
  helvetica: SANS,
  'helvetica neue': SANS,
  verdana: SANS,
  tahoma: SANS,
  georgia: SERIF,
  'times new roman': SERIF,
  inter: SANS,
  roboto: SANS,
  'open sans': SANS,
  lato: SANS,
  montserrat: SANS,
  poppins: SANS,
  'source sans pro': SANS,
  'source sans 3': SANS,
  'noto sans': SANS,
  nunito: SANS,
  'work sans': SANS,
  'dm sans': SANS,
  manrope: SANS,
  raleway: SANS,
  rubik: SANS,
  oswald: SANS,
  'plus jakarta sans': SANS,
  'space grotesk': SANS,
  outfit: SANS,
  'playfair display': SERIF,
  merriweather: SERIF,
  lora: SERIF,
  'eb garamond': SERIF,
  'cormorant garamond': SERIF,
  'libre baskerville': SERIF,
  'dm serif display': SERIF,
  'source serif pro': SERIF,
  'noto serif': SERIF,
  'jetbrains mono': MONO,
  'fira code': MONO,
  'ibm plex mono': MONO,
  'space mono': MONO,
  'ibm plex sans': SANS,
  'ibm plex serif': SERIF,
  'dancing script': 'script',
  pacifico: 'script',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function int(value: unknown, max: number): number {
  return Math.round(clamp(value, 0, max) ?? 0);
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface FontInfo {
  fontKind: ReferenceFontKind;
  fontName: string | null;
}

function fontInfo(raw: unknown): FontInfo {
  const stack =
    typeof raw === 'string'
      ? raw
          .slice(0, 400)
          .split(',')
          .map((part) =>
            part
              .trim()
              .replace(/^["']|["']$/g, '')
              .toLowerCase(),
          )
      : [];
  const first = stack[0] ?? '';
  const named = PUBLIC_TYPEFACES[first];
  if (named !== undefined) {
    const fontName = first.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    return { fontKind: named, fontName };
  }
  // A custom face still declares what it falls back to, which is the useful part.
  for (const family of stack) {
    const kind = PUBLIC_TYPEFACES[family];
    if (kind !== undefined) return { fontKind: kind, fontName: null };
    if (family === 'serif' || family === 'ui-serif') return { fontKind: 'serif', fontName: null };
    if (family === 'monospace' || family === 'ui-monospace') {
      return { fontKind: 'monospace', fontName: null };
    }
    if (family === 'cursive') return { fontKind: 'script', fontName: null };
    if (family === 'sans-serif' || family === 'system-ui' || family === 'ui-sans-serif') {
      return { fontKind: 'sans-serif', fontName: null };
    }
  }
  return { fontKind: 'unknown', fontName: null };
}

/** `#rrggbb` from a computed colour, or null for anything else. */
function hexOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^rgba?\((\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/.exec(raw);
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function headingsOf(raw: unknown): ReferenceViewportMeasurements['headings'] {
  if (!Array.isArray(raw)) return [];
  const byLevel = new Map<number, Record<string, unknown>[]>();
  for (const item of raw.slice(0, 40)) {
    if (!isRecord(item)) continue;
    const level = int(item.level, 6);
    if (level < 1) continue;
    byLevel.set(level, [...(byLevel.get(level) ?? []), item]);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, samples]) => ({
      level,
      ...fontInfo(samples[0]?.family),
      sizePx: round(median(samples.map((sample) => clamp(sample.size, 6, 400) ?? 0)), 1),
      weight: Math.round(median(samples.map((sample) => clamp(sample.weight, 100, 1000) ?? 400))),
    }))
    .filter((heading) => heading.sizePx > 0);
}

function typeScale(
  headings: ReferenceViewportMeasurements['headings'],
  bodySize: number | null,
): number | null {
  // By size, not level: sites often use an h1 smaller than their h2s.
  const sizes = headings.map((heading) => heading.sizePx).sort((a, b) => b - a);
  const largest = sizes[0];
  const smallest = sizes[sizes.length - 1];
  if (largest === undefined || smallest === undefined) return null;
  const spread = sizes.length >= 2 ? largest / smallest : largest / (bodySize ?? largest);
  const steps = sizes.length >= 2 ? sizes.length - 1 : 1;
  if (spread <= 1) return null;
  return round(spread ** (1 / steps), 2);
}

function bodyOf(raw: unknown): ReferenceViewportMeasurements['body'] {
  if (!isRecord(raw)) return null;
  const sizePx = clamp(raw.size, 6, 64);
  if (sizePx === null || sizePx === 0) return null;
  const ratio = clamp(raw.lineHeightRatio, 0.8, 4);
  const measure = clamp(raw.measure, 0, 4000);
  return {
    ...fontInfo(raw.family),
    sizePx: round(sizePx, 1),
    lineHeightRatio: ratio === null ? null : round(ratio, 2),
    measurePx: measure === null || measure === 0 ? null : Math.round(measure),
  };
}

function paletteOf(raw: unknown): ReferenceViewportMeasurements['palette'] {
  if (!isRecord(raw)) return [];
  const palette: ReferenceViewportMeasurements['palette'] = [];
  for (const role of ['background', 'text', 'accent'] as const) {
    const entries = Array.isArray(raw[role]) ? (raw[role] as unknown[]).slice(0, 6) : [];
    const parsed = entries
      .filter(isRecord)
      .map((entry) => ({ hex: hexOf(entry.colour), weight: clamp(entry.weight, 0, 1e12) ?? 0 }))
      .filter((entry): entry is { hex: string; weight: number } => entry.hex !== null);
    const total = parsed.reduce((sum, entry) => sum + entry.weight, 0);
    if (total === 0) continue;
    for (const entry of parsed.slice(0, role === 'text' ? 2 : 3)) {
      palette.push({ hex: entry.hex, role, share: round(entry.weight / total, 2) });
    }
  }
  return palette;
}

function spacingOf(raw: unknown): ReferenceViewportMeasurements['spacing'] {
  const empty = { commonPx: [], baseUnitPx: null, sectionGapPx: null };
  if (!isRecord(raw) || !isRecord(raw.counts)) return empty;
  const counts = Object.entries(raw.counts)
    .slice(0, 300)
    .flatMap(([key, value]): [number, number][] => {
      const count = clamp(value, 0, 1e6);
      return /^\d{1,3}$/.test(key) && count !== null && count > 0 ? [[Number(key), count]] : [];
    });
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  const shareOfMultiples = (unit: number): number =>
    total === 0
      ? 0
      : counts.reduce((sum, [px, count]) => sum + (px % unit === 0 ? count : 0), 0) / total;
  let baseUnitPx: number | null = null;
  if (shareOfMultiples(8) >= 0.6) baseUnitPx = 8;
  else if (shareOfMultiples(4) >= 0.7) baseUnitPx = 4;
  const gap = clamp(raw.sectionGap, 0, 600);
  return {
    commonPx: [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([px]) => px)
      .sort((a, b) => a - b),
    baseUnitPx,
    sectionGapPx: gap === null ? null : Math.round(gap),
  };
}

function heroOf(raw: unknown, viewportHeight: number): ReferenceViewportMeasurements['hero'] {
  if (!isRecord(raw)) return null;
  const layout = member(raw.layout, HERO_LAYOUTS);
  if (layout === null) return null;
  const align = raw.align === 'start' ? 'left' : raw.align === 'end' ? 'right' : raw.align;
  return {
    layout,
    heightVh: round(int(raw.height, 20_000) / Math.max(viewportHeight, 1), 2),
    align: member(align, ['left', 'center', 'right'] as const),
    callsToAction: int(raw.cta, 50),
  };
}

export interface SanitizedRender {
  measurement: ReferenceViewportMeasurements;
  /** The page is an anti-bot interstitial, so its measurements describe nothing. */
  challenge: boolean;
  renderedElements: number;
}

/** Null when the page returned something other than the collector's shape. */
export function sanitizeMeasurement(raw: unknown): SanitizedRender | null {
  if (!isRecord(raw) || !isRecord(raw.viewport)) return null;
  const viewportWidth = int(raw.viewport.width, 8000);
  const viewportHeight = int(raw.viewport.height, 8000);
  if (viewportWidth === 0 || viewportHeight === 0) return null;
  const landmarks = isRecord(raw.landmarks) ? raw.landmarks : {};
  const nav = isRecord(raw.nav) ? raw.nav : {};
  const images = isRecord(raw.images) ? raw.images : {};
  const motion = isRecord(raw.motion) ? raw.motion : {};
  const headings = headingsOf(raw.headings);
  const body = bodyOf(raw.body);
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .slice(0, 24)
        .map((kind) => member(kind, SECTION_KINDS))
        .filter((kind): kind is ReferenceSectionKind => kind !== null)
    : [];
  return {
    challenge: raw.challenge === true,
    renderedElements: int(raw.renderedElements, 1_000_000),
    measurement: {
      viewportWidth,
      viewportHeight,
      pageHeight: int(raw.pageHeight, 200_000),
      sections,
      landmarks: {
        header: int(landmarks.header, 50),
        nav: int(landmarks.nav, 50),
        main: int(landmarks.main, 50),
        aside: int(landmarks.aside, 50),
        footer: int(landmarks.footer, 50),
      },
      nav: {
        items: int(nav.items, 400),
        pattern: member(nav.pattern, NAV_PATTERNS) ?? 'none',
        pinned: nav.pinned === true,
      },
      headings,
      typeScaleRatio: typeScale(headings, body?.sizePx ?? null),
      body,
      palette: paletteOf(raw.colours),
      spacing: spacingOf(raw.spacing),
      images: {
        count: int(images.count, 5000),
        areaShare: round(clamp(images.areaShare, 0, 1) ?? 0, 2),
      },
      hero: heroOf(raw.hero, viewportHeight),
      motion: {
        transitions: int(motion.transitions, 5000),
        animations: int(motion.animations, 5000),
        pinnedElements: int(motion.pinnedElements, 5000),
        smoothScroll: motion.smoothScroll === true,
      },
      maxColumns: Math.max(1, int(raw.maxColumns, 24)),
      horizontalOverflow: raw.horizontalOverflow === true,
    },
  };
}

function fontLabel(font: FontInfo): string {
  return font.fontName ?? `custom ${font.fontKind} face`;
}

function describeStructure(m: ReferenceViewportMeasurements): string {
  const sequence = m.sections.length > 0 ? m.sections.join(' > ') : 'no clear section blocks';
  const landmarks = (['header', 'nav', 'main', 'aside', 'footer'] as const)
    .filter((name) => m.landmarks[name] > 0)
    .map((name) => (m.landmarks[name] > 1 ? `${name} x${m.landmarks[name]}` : name));
  const hero = m.hero
    ? `Hero is ${m.hero.layout}, ${m.hero.heightVh} viewport heights tall, ${m.hero.align ?? 'unset'}-aligned, with ${m.hero.callsToAction} call(s) to action.`
    : 'No identifiable hero.';
  return `Sequence: ${sequence}. Landmarks: ${landmarks.join(', ') || 'none'}. ${hero} Up to ${m.maxColumns} columns; page is ${m.pageHeight}px tall at ${m.viewportWidth}px wide.`;
}

function describeTypography(m: ReferenceViewportMeasurements): string {
  const heading = m.headings[0];
  const headingPart = heading
    ? `Headings in ${fontLabel(heading)}: ${m.headings.map((h) => `h${h.level} ${h.sizePx}px/${h.weight}`).join(', ')}`
    : 'No visible headings';
  const scale =
    m.typeScaleRatio === null ? 'scale ratio unknown' : `scale ratio ${m.typeScaleRatio}`;
  const bodyPart = m.body
    ? `body ${fontLabel(m.body)} ${m.body.sizePx}px, line height ${m.body.lineHeightRatio ?? 'unknown'}, text width ${m.body.measurePx ?? 'unknown'}px`
    : 'no body text sampled';
  return `${headingPart}; ${scale}; ${bodyPart}.`;
}

function describeColour(m: ReferenceViewportMeasurements): string {
  if (m.palette.length === 0) return 'No colours could be measured.';
  const role = (name: 'background' | 'text' | 'accent'): string =>
    m.palette
      .filter((entry) => entry.role === name)
      .map((entry) => `${entry.hex} (${Math.round(entry.share * 100)}%)`)
      .join(', ') || 'none measured';
  return `Backgrounds ${role('background')}; text ${role('text')}; accents ${role('accent')}.`;
}

function describeSpacing(m: ReferenceViewportMeasurements): string {
  const unit =
    m.spacing.baseUnitPx === null
      ? 'no consistent base unit'
      : `${m.spacing.baseUnitPx}px base unit`;
  const gap =
    m.spacing.sectionGapPx === null
      ? 'section padding unknown'
      : `section padding about ${m.spacing.sectionGapPx}px`;
  return `Common values ${m.spacing.commonPx.join(', ') || 'none'}px; ${unit}; ${gap}.`;
}

function describeImagery(m: ReferenceViewportMeasurements): string {
  return `${m.images.count} images or media elements covering ${Math.round(m.images.areaShare * 100)}% of the page area.`;
}

function describeNavigation(m: ReferenceViewportMeasurements): string {
  return `${m.nav.pattern} with ${m.nav.items} item(s), ${m.nav.pinned ? 'pinned while scrolling' : 'not pinned'}.`;
}

function describeInteractions(m: ReferenceViewportMeasurements): string {
  return `${m.motion.transitions} elements declare a transition, ${m.motion.animations} an animation, ${m.motion.pinnedElements} are pinned; smooth scrolling ${m.motion.smoothScroll ? 'on' : 'off'}. Hover and scripted behaviour were not exercised.`;
}

function describeResponsive(
  desktop: ReferenceViewportMeasurements,
  mobile: ReferenceViewportMeasurements | null,
): string {
  if (mobile === null) return 'Not measured at phone width.';
  const h1 = (m: ReferenceViewportMeasurements): string =>
    m.headings[0] ? `${m.headings[0].sizePx}px` : 'none';
  const overflow = mobile.horizontalOverflow ? 'scrolls sideways' : 'no sideways scroll';
  return `At ${mobile.viewportWidth}px: columns ${desktop.maxColumns} to ${mobile.maxColumns}, navigation ${desktop.nav.pattern} to ${mobile.nav.pattern}, top heading ${h1(desktop)} to ${h1(mobile)}, sections ${desktop.sections.length} to ${mobile.sections.length}, ${overflow}.`;
}

export type ReferenceOrigin = NonNullable<ReferenceAnalysis['origin']>;

export function measuredAnalysis(
  url: string,
  origin: ReferenceOrigin,
  measurements: ReferenceMeasurements,
  limitation: string | null,
): ReferenceAnalysis {
  const { desktop, mobile } = measurements;
  return {
    url,
    accessible: true,
    limitation,
    origin,
    structure: describeStructure(desktop),
    typography: describeTypography(desktop),
    colour: describeColour(desktop),
    spacing: describeSpacing(desktop),
    imagery: describeImagery(desktop),
    navigation: describeNavigation(desktop),
    interactions: describeInteractions(desktop),
    responsive: describeResponsive(desktop, mobile),
    measurements,
  };
}

export function inaccessibleAnalysis(
  url: string,
  origin: ReferenceOrigin,
  reason: string,
): ReferenceAnalysis {
  const notMeasured = 'Not measured.';
  return {
    url,
    accessible: false,
    limitation: reason,
    origin,
    structure: notMeasured,
    typography: notMeasured,
    colour: notMeasured,
    spacing: notMeasured,
    imagery: notMeasured,
    navigation: notMeasured,
    interactions: notMeasured,
    responsive: notMeasured,
  };
}
