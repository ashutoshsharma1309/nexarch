/**
 * The words on a generated application's public landing page.
 *
 * A generated project is a website first: it opens on a landing page — hero,
 * features, and, where the request asked for them, pricing, testimonials
 * and an FAQ — with the working application behind it at `/dashboard`.
 *
 * The copy comes from one of two places. With a model configured, the
 * pipeline asks it to write the site for the user's own request
 * (`site-content` prompt); `normalizeSiteContent` then validates and clamps
 * that answer, because model output ends up inside generated source. Without
 * a model, `deriveSiteContent` builds it from the requirement spec — and
 * deliberately leaves pricing and testimonials empty rather than inventing
 * prices or customers nobody gave it. Empty sections are simply not rendered.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';

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

export interface SiteContent {
  brand: string;
  tagline: string;
  headline: string;
  subheadline: string;
  primaryCta: string;
  features: SiteFeature[];
  pricing: SitePricingPlan[];
  testimonials: SiteTestimonial[];
  faq: SiteFaq[];
  closing: { title: string; subtitle: string };
  /** Who wrote the copy — shown nowhere, recorded so the manifest is honest. */
  source: 'ai' | 'derived';
}

const LIMITS = { features: 6, pricing: 3, planFeatures: 6, testimonials: 3, faq: 6 } as const;

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

/** Built from the spec alone: nothing on the page that the request did not say. */
export function deriveSiteContent(spec: RequirementSpec): SiteContent {
  const brand = spec.projectName.trim() || 'Your product';
  const kind = spec.projectType.trim().toLowerCase() || 'application';
  const goal = spec.goal?.trim();
  const capabilities = spec.modules.filter((module) => !CHROME.test(module));
  const functional = (spec.functionalRequirements ?? []).filter((item) => item.trim() !== '');

  const features: SiteFeature[] =
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
    {
      question: `What is ${brand}?`,
      answer: goal ?? `${brand} is a ${kind} application.`,
    },
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

  return {
    brand,
    tagline: sentenceCase(kind),
    headline: goal ? text(goal, brand, 90) : `${brand}, ready when you are`,
    subheadline: goal
      ? `Everything ${brand} offers, in one place.`
      : `A ${kind} application with ${capabilities.slice(0, 3).join(', ').toLowerCase() || 'everything you need'}.`,
    primaryCta: 'Get started',
    features,
    pricing: [],
    testimonials: [],
    faq,
    closing: { title: `Start with ${brand} today`, subtitle: 'Open the app and explore.' },
    source: 'derived',
  };
}

/**
 * The model's answer, trusted only after this: every field type-checked,
 * every string bounded, every list capped. Anything missing or malformed
 * falls back to the spec-derived value for that field.
 */
export function normalizeSiteContent(raw: unknown, fallback: SiteContent): SiteContent {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const features = records(source.features, LIMITS.features)
    .map((f) => ({ title: text(f.title, '', 60), description: text(f.description, '', 220) }))
    .filter((f) => f.title !== '' && f.description !== '');

  const pricing = records(source.pricing, LIMITS.pricing)
    .map((p) => ({
      name: text(p.name, '', 40),
      price: text(p.price, '', 20),
      period: text(p.period, '', 24),
      description: text(p.description, '', 160),
      features: (Array.isArray(p.features) ? p.features : [])
        .map((item) => text(item, '', 80))
        .filter((item) => item !== '')
        .slice(0, LIMITS.planFeatures),
      highlighted: p.highlighted === true,
    }))
    .filter((p) => p.name !== '' && p.price !== '');

  const testimonials = records(source.testimonials, LIMITS.testimonials)
    .map((t) => ({
      quote: text(t.quote, '', 280),
      name: text(t.name, '', 60),
      role: text(t.role, '', 80),
    }))
    .filter((t) => t.quote !== '' && t.name !== '');

  const faq = records(source.faq, LIMITS.faq)
    .map((q) => ({ question: text(q.question, '', 140), answer: text(q.answer, '', 400) }))
    .filter((q) => q.question !== '' && q.answer !== '');

  const closing = (
    typeof source.closing === 'object' && source.closing !== null ? source.closing : {}
  ) as Record<string, unknown>;

  return {
    brand: text(source.brand, fallback.brand, 40),
    tagline: text(source.tagline, fallback.tagline, 60),
    headline: text(source.headline, fallback.headline, 100),
    subheadline: text(source.subheadline, fallback.subheadline, 240),
    primaryCta: text(source.primaryCta, fallback.primaryCta, 28),
    features: features.length > 0 ? features : fallback.features,
    // Only the model — never the fallback — may add prices or customers.
    pricing,
    testimonials,
    faq: faq.length > 0 ? faq : fallback.faq,
    closing: {
      title: text(closing.title, fallback.closing.title, 80),
      subtitle: text(closing.subtitle, fallback.closing.subtitle, 160),
    },
    source: 'ai',
  };
}
