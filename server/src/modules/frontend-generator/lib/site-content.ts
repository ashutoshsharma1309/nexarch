/**
 * The design of a generated application's public website.
 *
 * A generated project is a website first: it opens on a page built for the
 * thing the user asked for, with the working application behind it at
 * `/dashboard`.
 *
 * This module exists because of a real defect. The landing page used to be a
 * fixed sequence — hero, features, pricing, testimonials, FAQ — in a fixed
 * dark palette, and the only thing a model could write was about a dozen
 * strings inside it. So a cafe, a hospital and a developer tool all came out
 * as the same dark SaaS page with different nouns in it. The request was
 * never the authority; the template was.
 *
 * The fix is to let the request decide the *shape* of the page, not just its
 * words. A model answers with a `SiteDesign`: a theme (mode, palette
 * temperature, accent, type, corners) and an ordered list of typed sections
 * chosen from a domain-neutral vocabulary — a cafe asks for a menu with
 * prices, opening hours and a location; a college portal for courses, stats
 * and steps; a developer tool for features and a changelog of sorts. Nothing
 * here knows what a cafe is: it knows what a `catalog` section is, and the
 * request decides whether the project needs one.
 *
 * Everything the model sends is validated and clamped before it goes near a
 * generated file: colours must be hex, fonts and illustrations must name
 * something this platform actually ships, sections must be a known kind, and
 * every string is bounded. Without a model, `deriveSiteDesign` builds an
 * honest, smaller page from the requirement spec alone — and still refuses to
 * invent prices or customers nobody asked for.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { ART_KINDS, artForKeywords, isArtKind, type ArtKind } from './art-kit.js';

export interface SiteFeature {
  title: string;
  description: string;
}

export interface SitePricingPlan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlighted: boolean;
}

export interface SiteTestimonial {
  quote: string;
  name: string;
  role: string;
}

export interface SiteFaq {
  question: string;
  answer: string;
}

export interface SiteCatalogItem {
  name: string;
  description: string;
  /** A display string ("£3.20", "Free", "From $29") — never a number. */
  price: string;
  tag: string;
  art: ArtKind;
  artLabel: string;
}

export interface SiteStat {
  value: string;
  label: string;
}

export interface SiteRow {
  label: string;
  value: string;
}

export interface SiteStep {
  title: string;
  description: string;
}

export interface SiteGalleryItem {
  caption: string;
  art: ArtKind;
  artLabel: string;
}

/**
 * The page vocabulary. Every kind is domain-neutral on purpose: `catalog`
 * is a menu in a cafe, a course list in a college and a product grid in a
 * shop, and the generator never needs to know which.
 */
export type SiteSection =
  | {
      kind: 'hero';
      id: string;
      navLabel: string;
      headline: string;
      subheadline: string;
      badge: string;
      primaryCta: string;
      secondaryCta: string;
      art: ArtKind;
      artLabel: string;
    }
  | {
      kind: 'features';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      items: SiteFeature[];
    }
  | {
      kind: 'catalog';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      items: SiteCatalogItem[];
    }
  | {
      kind: 'gallery';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      items: SiteGalleryItem[];
    }
  | {
      kind: 'hours';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      rows: SiteRow[];
      note: string;
    }
  | {
      kind: 'contact';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      rows: SiteRow[];
      note: string;
    }
  | { kind: 'stats'; id: string; navLabel: string; title: string; items: SiteStat[] }
  | {
      kind: 'steps';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      items: SiteStep[];
    }
  | {
      kind: 'pricing';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      plans: SitePricingPlan[];
    }
  | {
      kind: 'testimonials';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      items: SiteTestimonial[];
    }
  | {
      kind: 'faq';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      items: SiteFaq[];
    }
  | { kind: 'cta'; id: string; navLabel: string; title: string; subtitle: string; label: string };

export type SectionKind = SiteSection['kind'];

export const SECTION_KINDS: readonly SectionKind[] = [
  'hero',
  'features',
  'catalog',
  'gallery',
  'hours',
  'contact',
  'stats',
  'steps',
  'pricing',
  'testimonials',
  'faq',
  'cta',
];

export type ThemeMode = 'light' | 'dark';
/** How the neutrals are tinted — the difference between a cafe and a CLI. */
export type ThemeTemperature = 'warm' | 'cool' | 'neutral';
export type ThemeCorners = 'sharp' | 'soft' | 'round';

export interface SiteFont {
  id: string;
  /** The CSS font stack written into the generated theme. */
  stack: string;
  /** The Google Fonts family + weights, or null for a system stack. */
  googleFamily: string | null;
}

/**
 * The type choices a model may make. A short allowlist, because the family
 * name ends up in a stylesheet and in a stylesheet URL: an open list would
 * be an injection surface and a 404 waiting to happen.
 */
export const SITE_FONTS: readonly SiteFont[] = [
  { id: 'inter', stack: "'Inter'", googleFamily: 'Inter:wght@400;500;600;700' },
  { id: 'manrope', stack: "'Manrope'", googleFamily: 'Manrope:wght@400;500;600;800' },
  {
    id: 'space-grotesk',
    stack: "'Space Grotesk'",
    googleFamily: 'Space+Grotesk:wght@400;500;600;700',
  },
  { id: 'dm-sans', stack: "'DM Sans'", googleFamily: 'DM+Sans:opsz,wght@9..40,400;9..40,500' },
  { id: 'nunito', stack: "'Nunito'", googleFamily: 'Nunito:wght@400;600;700;800' },
  { id: 'fraunces', stack: "'Fraunces'", googleFamily: 'Fraunces:opsz,wght@9..144,400;9..144,600' },
  {
    id: 'playfair',
    stack: "'Playfair Display'",
    googleFamily: 'Playfair+Display:wght@400;500;600;700',
  },
  {
    id: 'source-serif',
    stack: "'Source Serif 4'",
    googleFamily: 'Source+Serif+4:wght@400;600;700',
  },
  { id: 'ibm-plex', stack: "'IBM Plex Sans'", googleFamily: 'IBM+Plex+Sans:wght@400;500;600;700' },
  { id: 'system', stack: 'ui-sans-serif', googleFamily: null },
];

export interface SitePalette {
  canvas: string;
  surface: string;
  raised: string;
  inset: string;
  line: string;
  lineStrong: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  /** Text drawn on the accent — black or white, whichever stays readable. */
  accentFg: string;
  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;
}

export interface SiteTheme {
  mode: ThemeMode;
  temperature: ThemeTemperature;
  corners: ThemeCorners;
  fontId: string;
  /** The model picks an accent; the rest of the ramp is derived from it. */
  palette: SitePalette;
}

export interface SiteDesign {
  brand: string;
  tagline: string;
  theme: SiteTheme;
  /** Rendered top to bottom, in this order. The first hero leads the page. */
  sections: SiteSection[];
  footerNote: string;
  /** Who designed the page — shown nowhere, recorded so the manifest is honest. */
  source: 'ai' | 'derived';
}

/** The old name, kept because the pipeline, manifest and tests all speak it. */
export type SiteContent = SiteDesign;

const LIMITS = {
  sections: 9,
  features: 6,
  catalog: 8,
  gallery: 6,
  rows: 8,
  stats: 4,
  steps: 4,
  pricing: 3,
  planFeatures: 6,
  testimonials: 3,
  faq: 6,
} as const;

/** Chrome modules describe the app's plumbing, not what a visitor gets. */
const CHROME = /^(authentication|dashboard|settings|notifications|reports|analytics)$/i;

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  // Collapse whitespace, strip control characters, keep it one readable run.
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return fallback;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

function records(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .slice(0, max);
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? fallback : cleaned.slice(0, 32);
}

// ── Theme ────────────────────────────────────────────────────────────────

/**
 * Neutral ramps per mode and temperature.
 *
 * The accent is the model's; the neutrals are not, because getting eleven
 * related greys right is exactly what a model is unreliable at and exactly
 * what makes a page look broken when it is wrong. Warm and cool are real
 * ramps, hand-picked at the same contrast as the platform's own.
 */
type Neutrals = Omit<
  SitePalette,
  | 'accent'
  | 'accentHover'
  | 'accentSoft'
  | 'accentFg'
  | 'success'
  | 'warning'
  | 'danger'
  | 'dangerSoft'
>;

/**
 * Status colours are not a design choice. Success/warning/danger carry
 * meaning a user has learnt elsewhere, and a model picking "on-brand" ones
 * is how a destructive button ends up mint green.
 */
const SEMANTIC: Record<
  ThemeMode,
  Pick<SitePalette, 'success' | 'warning' | 'danger' | 'dangerSoft'>
> = {
  dark: {
    success: '#55b083',
    warning: '#d0a04a',
    danger: '#d96a6a',
    dangerSoft: '#d96a6a24',
  },
  light: {
    success: '#2f8a62',
    warning: '#b07d28',
    danger: '#c04747',
    dangerSoft: '#c047471a',
  },
};

const NEUTRALS: Record<ThemeMode, Record<ThemeTemperature, Neutrals>> = {
  dark: {
    cool: {
      canvas: '#0b0c0e',
      surface: '#101114',
      raised: '#16181c',
      inset: '#0e0f11',
      line: '#24262b',
      lineStrong: '#34373e',
      fg: '#edeef0',
      fgMuted: '#a2a5ab',
      fgSubtle: '#6c6f76',
    },
    warm: {
      canvas: '#14100d',
      surface: '#1b1612',
      raised: '#221c17',
      inset: '#120e0b',
      line: '#2e2620',
      lineStrong: '#443931',
      fg: '#f4ece4',
      fgMuted: '#bfb0a3',
      fgSubtle: '#8b7d71',
    },
    neutral: {
      canvas: '#0c0c0c',
      surface: '#121212',
      raised: '#181818',
      inset: '#0f0f0f',
      line: '#262626',
      lineStrong: '#363636',
      fg: '#ededed',
      fgMuted: '#a3a3a3',
      fgSubtle: '#6e6e6e',
    },
  },
  light: {
    cool: {
      canvas: '#f6f6f7',
      surface: '#ffffff',
      raised: '#ffffff',
      inset: '#eeeef0',
      line: '#e2e3e6',
      lineStrong: '#cbccd1',
      fg: '#191b1f',
      fgMuted: '#5c5f66',
      fgSubtle: '#8b8e96',
    },
    warm: {
      canvas: '#faf5ef',
      surface: '#fffdfa',
      raised: '#ffffff',
      inset: '#f2e9df',
      line: '#e7dbcd',
      lineStrong: '#d2c0ad',
      fg: '#221913',
      fgMuted: '#6a594c',
      fgSubtle: '#96867a',
    },
    neutral: {
      canvas: '#f7f7f7',
      surface: '#ffffff',
      raised: '#ffffff',
      inset: '#efefef',
      line: '#e4e4e4',
      lineStrong: '#cdcdcd',
      fg: '#1a1a1a',
      fgMuted: '#5e5e5e',
      fgSubtle: '#8d8d8d',
    },
  },
};

const DEFAULT_ACCENT: Record<ThemeMode, string> = { dark: '#7d8ae8', light: '#4f5cc4' };

function hex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(cleaned)) return cleaned;
  // `#abc` is valid CSS and a plausible answer; expand it rather than refuse.
  if (/^#[0-9a-f]{3}$/.test(cleaned)) {
    const [, r, g, b] = /^#(.)(.)(.)$/.exec(cleaned) ?? [];
    return `#${r ?? '0'}${r ?? '0'}${g ?? '0'}${g ?? '0'}${b ?? '0'}${b ?? '0'}`;
  }
  return fallback;
}

function channels(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

/** Relative luminance, the WCAG one — used to keep the accent legible. */
function luminance(value: string): number {
  const srgb = channels(value).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (srgb[0] ?? 0) + 0.7152 * (srgb[1] ?? 0) + 0.0722 * (srgb[2] ?? 0);
}

function mix(value: string, towards: string, amount: number): string {
  const from = channels(value);
  const to = channels(towards);
  const blended = from.map((channel, index) =>
    Math.round(channel + ((to[index] ?? channel) - channel) * amount),
  );
  return `#${blended.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Keep the accent readable on its own canvas.
 *
 * A model asked for a warm cafe will happily answer `#4a2c1a`, which is
 * invisible on a dark canvas and unreadable as a button. Rather than refuse
 * the colour — it is the right hue, just the wrong weight — lift or deepen
 * it until it clears a contrast floor against the canvas it sits on.
 */
function legibleAccent(accent: string, canvas: string, mode: ThemeMode): string {
  const target = mode === 'dark' ? '#ffffff' : '#000000';
  let current = accent;
  for (let step = 0; step < 8; step += 1) {
    const ratio =
      (Math.max(luminance(current), luminance(canvas)) + 0.05) /
      (Math.min(luminance(current), luminance(canvas)) + 0.05);
    if (ratio >= 3.2) return current;
    current = mix(current, target, 0.14);
  }
  return current;
}

function buildTheme(raw: Record<string, unknown>, fallback: SiteTheme): SiteTheme {
  const mode: ThemeMode = raw.mode === 'light' || raw.mode === 'dark' ? raw.mode : fallback.mode;
  const temperature: ThemeTemperature =
    raw.temperature === 'warm' || raw.temperature === 'cool' || raw.temperature === 'neutral'
      ? raw.temperature
      : fallback.temperature;
  const corners: ThemeCorners =
    raw.corners === 'sharp' || raw.corners === 'soft' || raw.corners === 'round'
      ? raw.corners
      : fallback.corners;
  const fontId = SITE_FONTS.some((font) => font.id === raw.fontId)
    ? (raw.fontId as string)
    : fallback.fontId;

  // `{ accent }` is what the contract asks for, but a model that mirrors the
  // rendered theme back answers `{ palette: { accent } }`. Both name the same
  // colour, and refusing the second would silently discard a real choice.
  const nested = (
    typeof raw.palette === 'object' && raw.palette !== null ? raw.palette : {}
  ) as Record<string, unknown>;
  const accent = raw.accent ?? nested.accent;

  return { mode, temperature, corners, fontId, palette: paletteFor(mode, temperature, accent) };
}

export function paletteFor(
  mode: ThemeMode,
  temperature: ThemeTemperature,
  rawAccent: unknown,
): SitePalette {
  const neutrals = NEUTRALS[mode][temperature];
  const accent = legibleAccent(hex(rawAccent, DEFAULT_ACCENT[mode]), neutrals.canvas, mode);
  return {
    ...neutrals,
    ...SEMANTIC[mode],
    accent,
    accentHover: mix(accent, mode === 'dark' ? '#ffffff' : '#000000', 0.16),
    accentSoft: `${accent}${mode === 'dark' ? '24' : '1a'}`,
    // A pale accent with white text on it is unreadable; pick the side that
    // wins against the accent itself, not against the page.
    accentFg: luminance(accent) > 0.45 ? '#10100f' : '#ffffff',
  };
}

/** The chosen face. `inter` is the floor: the allowlist is never empty. */
export function fontOf(theme: SiteTheme): SiteFont {
  const chosen = SITE_FONTS.find((font) => font.id === theme.fontId) ?? SITE_FONTS[0];
  return chosen ?? { id: 'inter', stack: "'Inter'", googleFamily: 'Inter:wght@400;500;600;700' };
}

// ── Sections ─────────────────────────────────────────────────────────────

/**
 * A button label that does not promise a sign-in.
 *
 * These applications have no accounts — the request for them says so — and
 * the button goes straight to the dashboard. A model asked for a student
 * portal will still write "Login" out of habit, and a button labelled Login
 * that logs nobody in is a lie the page tells on first sight. Asking the
 * model not to do it was not enough, so it is enforced here.
 */
const AUTH_LABEL =
  /\b(log\s?in|login|sign\s?in|signin|sign\s?up|signup|register|create account|my account)\b/i;

function ctaLabel(value: unknown, fallback: string): string {
  const label = text(value, fallback, 28);
  return AUTH_LABEL.test(label) ? fallback : label;
}

function art(value: unknown, fallbackText: string): ArtKind {
  return isArtKind(value) ? value : artForKeywords(fallbackText);
}

function features(value: unknown): SiteFeature[] {
  return records(value, LIMITS.features)
    .map((item) => ({
      title: text(item.title, '', 60),
      description: text(item.description, '', 220),
    }))
    .filter((item) => item.title !== '' && item.description !== '');
}

function catalogItems(value: unknown): SiteCatalogItem[] {
  return records(value, LIMITS.catalog)
    .map((item) => {
      const name = text(item.name, '', 70);
      return {
        name,
        description: text(item.description, '', 180),
        price: text(item.price, '', 24),
        tag: text(item.tag, '', 24),
        art: art(item.art, `${name} ${text(item.description, '', 80)}`),
        artLabel: text(item.artLabel, name, 90),
      };
    })
    .filter((item) => item.name !== '');
}

function galleryItems(value: unknown): SiteGalleryItem[] {
  return records(value, LIMITS.gallery)
    .map((item) => {
      const caption = text(item.caption, '', 90);
      return {
        caption,
        art: art(item.art, caption),
        artLabel: text(item.artLabel, caption, 90),
      };
    })
    .filter((item) => item.caption !== '');
}

function rows(value: unknown): SiteRow[] {
  return records(value, LIMITS.rows)
    .map((item) => ({ label: text(item.label, '', 60), value: text(item.value, '', 120) }))
    .filter((item) => item.label !== '' && item.value !== '');
}

function stats(value: unknown): SiteStat[] {
  return records(value, LIMITS.stats)
    .map((item) => ({ value: text(item.value, '', 16), label: text(item.label, '', 60) }))
    .filter((item) => item.value !== '' && item.label !== '');
}

function steps(value: unknown): SiteStep[] {
  return records(value, LIMITS.steps)
    .map((item) => ({
      title: text(item.title, '', 60),
      description: text(item.description, '', 200),
    }))
    .filter((item) => item.title !== '');
}

function pricingPlans(value: unknown): SitePricingPlan[] {
  return records(value, LIMITS.pricing)
    .map((plan) => ({
      name: text(plan.name, '', 40),
      price: text(plan.price, '', 20),
      period: text(plan.period, '', 24),
      description: text(plan.description, '', 160),
      features: (Array.isArray(plan.features) ? plan.features : [])
        .map((item) => text(item, '', 80))
        .filter((item) => item !== '')
        .slice(0, LIMITS.planFeatures),
      highlighted: plan.highlighted === true,
    }))
    .filter((plan) => plan.name !== '' && plan.price !== '');
}

function testimonialItems(value: unknown): SiteTestimonial[] {
  return records(value, LIMITS.testimonials)
    .map((item) => ({
      quote: text(item.quote, '', 280),
      name: text(item.name, '', 60),
      role: text(item.role, '', 80),
    }))
    .filter((item) => item.quote !== '' && item.name !== '');
}

function faqItems(value: unknown): SiteFaq[] {
  return records(value, LIMITS.faq)
    .map((item) => ({ question: text(item.question, '', 140), answer: text(item.answer, '', 400) }))
    .filter((item) => item.question !== '' && item.answer !== '');
}

/**
 * One section, validated.
 *
 * Returns null when the section carries nothing to render — an empty menu or
 * a testimonials block with no testimonials is worse than no section at all,
 * and dropping it here keeps the page honest without the renderer guessing.
 */
function buildSection(raw: Record<string, unknown>, index: number): SiteSection | null {
  const kind = SECTION_KINDS.find((candidate) => candidate === raw.kind);
  if (!kind) return null;

  const title = text(raw.title, '', 90);
  const subtitle = text(raw.subtitle, '', 200);
  const id = slug(text(raw.id, '', 32) || kind, `section-${String(index)}`);
  const navLabel = text(raw.navLabel, title, 24);

  switch (kind) {
    case 'hero': {
      const headline = text(raw.headline, '', 110);
      if (headline === '') return null;
      return {
        kind,
        id,
        navLabel,
        headline,
        subheadline: text(raw.subheadline, '', 260),
        badge: text(raw.badge, '', 40),
        primaryCta: ctaLabel(raw.primaryCta, 'Get started'),
        secondaryCta: ctaLabel(raw.secondaryCta, ''),
        art: art(raw.art, `${headline} ${text(raw.subheadline, '', 120)}`),
        artLabel: text(raw.artLabel, headline, 110),
      };
    }
    case 'features': {
      const items = features(raw.items);
      return items.length === 0 ? null : { kind, id, navLabel, title, subtitle, items };
    }
    case 'catalog': {
      const items = catalogItems(raw.items);
      return items.length === 0 ? null : { kind, id, navLabel, title, subtitle, items };
    }
    case 'gallery': {
      const items = galleryItems(raw.items);
      return items.length === 0 ? null : { kind, id, navLabel, title, subtitle, items };
    }
    case 'hours':
    case 'contact': {
      const list = rows(raw.rows);
      return list.length === 0
        ? null
        : { kind, id, navLabel, title, subtitle, rows: list, note: text(raw.note, '', 160) };
    }
    case 'stats': {
      const items = stats(raw.items);
      return items.length === 0 ? null : { kind, id, navLabel, title, items };
    }
    case 'steps': {
      const items = steps(raw.items);
      return items.length === 0 ? null : { kind, id, navLabel, title, subtitle, items };
    }
    case 'pricing': {
      const plans = pricingPlans(raw.plans);
      return plans.length === 0 ? null : { kind, id, navLabel, title, subtitle, plans };
    }
    case 'testimonials': {
      const items = testimonialItems(raw.items);
      return items.length === 0 ? null : { kind, id, navLabel, title, subtitle, items };
    }
    case 'faq': {
      const items = faqItems(raw.items);
      return items.length === 0 ? null : { kind, id, navLabel, title, subtitle, items };
    }
    case 'cta': {
      if (title === '') return null;
      return { kind, id, navLabel, title, subtitle, label: ctaLabel(raw.label, 'Open the app') };
    }
  }
}

/** Anchors have to be unique: two `catalog` sections would collide otherwise. */
function withUniqueIds(sections: SiteSection[]): SiteSection[] {
  const seen = new Set<string>();
  return sections.map((section) => {
    let id = section.id;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${section.id}-${String(suffix)}`;
      suffix += 1;
    }
    seen.add(id);
    return { ...section, id };
  });
}

// ── Derivation (no model) ────────────────────────────────────────────────

export function defaultTheme(): SiteTheme {
  return {
    mode: 'dark',
    temperature: 'cool',
    corners: 'soft',
    fontId: 'inter',
    palette: paletteFor('dark', 'cool', DEFAULT_ACCENT.dark),
  };
}

/**
 * Built from the spec alone: nothing on the page the request did not say.
 *
 * This runs when no model is configured or its answer failed. It is a
 * smaller page on purpose — hero, what the app does, and an FAQ built out of
 * the spec — and it still refuses to invent prices or customers.
 */
export function deriveSiteDesign(spec: RequirementSpec): SiteDesign {
  const brand = spec.projectName.trim() || 'Your product';
  const kind = spec.projectType.trim().toLowerCase() || 'application';
  const goal = spec.goal?.trim();
  const capabilities = spec.modules.filter((module) => !CHROME.test(module));
  const functional = (spec.functionalRequirements ?? []).filter((item) => item.trim() !== '');

  const featureItems: SiteFeature[] =
    functional.length > 0
      ? functional.slice(0, LIMITS.features).map((item, index) => ({
          title: capabilities[index] ?? sentenceCase(item.split(/[,.;:]/)[0] ?? item).slice(0, 48),
          description: sentenceCase(item),
        }))
      : capabilities.slice(0, LIMITS.features).map((module) => ({
          title: module,
          description: `${module} built into ${brand} from day one.`,
        }));

  const faq: SiteFaq[] = [
    { question: `What is ${brand}?`, answer: goal ?? `${brand} is a ${kind} application.` },
  ];
  if (capabilities.length > 0) {
    faq.push({
      question: `What can I do with ${brand}?`,
      answer: `${capabilities.slice(0, -1).join(', ')}${capabilities.length > 1 ? ' and ' : ''}${capabilities.at(-1) ?? ''}.`,
    });
  }
  if (spec.roles.length > 0) {
    faq.push({
      question: `Who is ${brand} for?`,
      answer: `It is built for ${spec.roles.join(', ').toLowerCase()} users.`,
    });
  }

  const subject = `${kind} ${capabilities.join(' ')}`;
  const sections: SiteSection[] = [
    {
      kind: 'hero',
      id: 'top',
      navLabel: 'Home',
      headline: goal ? text(goal, brand, 90) : `${brand}, ready when you are`,
      subheadline: goal
        ? `Everything ${brand} offers, in one place.`
        : `A ${kind} application with ${capabilities.slice(0, 3).join(', ').toLowerCase() || 'everything you need'}.`,
      badge: sentenceCase(kind),
      primaryCta: 'Get started',
      secondaryCta: 'Learn more',
      art: artForKeywords(subject),
      artLabel: `${brand} illustration`,
    },
  ];
  if (featureItems.length > 0) {
    sections.push({
      kind: 'features',
      id: 'features',
      navLabel: 'Features',
      title: 'Everything you need',
      subtitle: `What ${brand} does for you.`,
      items: featureItems,
    });
  }
  sections.push({
    kind: 'faq',
    id: 'faq',
    navLabel: 'FAQ',
    title: 'Frequently asked questions',
    subtitle: '',
    items: faq,
  });
  sections.push({
    kind: 'cta',
    id: 'start',
    navLabel: '',
    title: `Start with ${brand} today`,
    subtitle: 'Open the app and explore.',
    label: 'Open the app',
  });

  return {
    brand,
    tagline: sentenceCase(kind),
    theme: defaultTheme(),
    sections: withUniqueIds(sections),
    footerNote: '',
    source: 'derived',
  };
}

/**
 * The model's answer, trusted only after this: every colour a real hex, every
 * font and illustration one this platform ships, every section a known kind,
 * every string bounded, every list capped. A design with no usable sections
 * falls back to the derived one rather than emitting an empty page.
 */
export function normalizeSiteDesign(raw: unknown, fallback: SiteDesign): SiteDesign {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const themeRaw = (
    typeof source.theme === 'object' && source.theme !== null ? source.theme : {}
  ) as Record<string, unknown>;

  const sections = withUniqueIds(
    records(source.sections, LIMITS.sections)
      .map((section, index) => buildSection(section, index))
      .filter((section): section is SiteSection => section !== null),
  );

  if (sections.length === 0) return fallback;

  return {
    brand: text(source.brand, fallback.brand, 40),
    tagline: text(source.tagline, fallback.tagline, 60),
    theme: buildTheme(themeRaw, fallback.theme),
    sections,
    footerNote: text(source.footerNote, '', 120),
    source: 'ai',
  };
}

/** The art every illustration in this design uses — for manifests and tests. */
export function artKindsOf(design: SiteDesign): ArtKind[] {
  const used = new Set<ArtKind>();
  for (const section of design.sections) {
    if (section.kind === 'hero') used.add(section.art);
    if (section.kind === 'catalog' || section.kind === 'gallery') {
      for (const item of section.items) used.add(item.art);
    }
  }
  return [...used].filter((kind) => ART_KINDS.includes(kind));
}

/** Legacy names: the pipeline and its tests were written against these. */
export const deriveSiteContent = deriveSiteDesign;
export const normalizeSiteContent = normalizeSiteDesign;
