/**
 * Emits the generated application's public landing page: a real website at
 * `/` — navigation, hero, features, and pricing / testimonials / FAQ when the
 * content has them — with the working application one click away at
 * `/dashboard`.
 *
 * The copy is data, not code: it is written into `src/content/site.ts` with
 * `JSON.stringify`, so whatever a model wrote can only ever be a string the
 * page renders (React escapes it) and never becomes source. The page itself
 * is fixed, reviewed code that lays out whichever sections have content.
 *
 * It uses the app's own theme tokens (canvas / surface / fg / accent …), so it
 * follows the dark/light setting and looks like the rest of the project.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';
import type { SiteContent } from './site-content.js';

function contentFile(content: SiteContent): string {
  const { source: _source, ...site } = content;
  return `/**
 * The landing page's copy. Edit freely — the page renders whatever is here
 * and hides any section whose list is empty.
 */
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
}

export const site: SiteContent = ${JSON.stringify(site, null, 2)};
`;
}

const landingPage = `import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Layers,
  Menu,
  Rocket,
  Shield,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { site } from '@/content/site';
import { cn } from '@/shared/lib/cn';

const FEATURE_ICONS = [Sparkles, Zap, Shield, Layers, BarChart3, Rocket];

function initials(name: string): string {
  return name
    .split(/\\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  const sections = [
    { id: 'features', label: 'Features', show: site.features.length > 0 },
    { id: 'pricing', label: 'Pricing', show: site.pricing.length > 0 },
    { id: 'testimonials', label: 'Testimonials', show: site.testimonials.length > 0 },
    { id: 'faq', label: 'FAQ', show: site.faq.length > 0 },
  ].filter((section) => section.show);

  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
        <nav
          aria-label="Main"
          className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
        >
          <Link to="/" className="text-lg font-semibold tracking-tight text-fg">
            {site.brand}
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {sections.map((section) => (
              <a
                key={section.id}
                href={'#' + section.id}
                className="text-sm text-fg-muted transition-colors hover:text-fg"
              >
                {section.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/dashboard"
              className="hidden rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover sm:inline-flex"
            >
              Open app
            </Link>
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-md border border-line text-fg-muted md:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => {
                setMenuOpen((open) => !open);
              }}
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </nav>

        {menuOpen && (
          <div id="mobile-menu" className="border-t border-line px-4 pb-4 md:hidden">
            <div className="flex flex-col gap-1 pt-2">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={'#' + section.id}
                  className="rounded-md px-2 py-2 text-sm text-fg-muted hover:bg-surface hover:text-fg"
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                >
                  {section.label}
                </a>
              ))}
              <Link
                to="/dashboard"
                className="mt-2 rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-white"
              >
                Open app
              </Link>
            </div>
          </div>
        )}
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-80 max-w-3xl rounded-full bg-accent-soft blur-3xl"
          />
          <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-fg-muted">
              <Sparkles className="size-3.5 text-accent" />
              {site.tagline}
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {site.headline}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-fg-muted sm:text-lg">
              {site.subheadline}
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                {site.primaryCta}
                <ArrowRight className="size-4" />
              </Link>
              {sections.length > 0 && (
                <a
                  href={'#' + (sections[0]?.id ?? 'features')}
                  className="inline-flex items-center rounded-md border border-line px-5 py-3 text-sm font-medium text-fg transition-colors hover:border-line-strong"
                >
                  Learn more
                </a>
              )}
            </div>
          </div>
        </section>

        {site.features.length > 0 && (
          <section id="features" aria-labelledby="features-title" className="scroll-mt-20 py-20">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <h2 id="features-title" className="text-3xl font-semibold tracking-tight">
                  Everything you need
                </h2>
                <p className="mt-3 text-fg-muted">What {site.brand} does for you.</p>
              </div>
              <div
                className={cn(
                  'mt-12 grid gap-5 sm:grid-cols-2',
                  // Two or four cards read as pairs; three, five or six as rows of three.
                  site.features.length % 2 === 0 && site.features.length < 6
                    ? 'lg:grid-cols-2'
                    : 'lg:grid-cols-3',
                )}
              >
                {site.features.map((feature, index) => {
                  const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length] ?? Sparkles;
                  return (
                    <article
                      key={feature.title}
                      className="rounded-xl border border-line bg-surface p-6 transition-colors hover:border-line-strong"
                    >
                      <span className="inline-flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                        <Icon className="size-5" />
                      </span>
                      <h3 className="mt-4 font-semibold">{feature.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                        {feature.description}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {site.pricing.length > 0 && (
          <section
            id="pricing"
            aria-labelledby="pricing-title"
            className="scroll-mt-20 border-t border-line bg-surface/40 py-20"
          >
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <h2 id="pricing-title" className="text-3xl font-semibold tracking-tight">
                  Simple, transparent pricing
                </h2>
                <p className="mt-3 text-fg-muted">Pick the plan that fits.</p>
              </div>
              <div
                className={cn(
                  'mx-auto mt-12 grid gap-5',
                  site.pricing.length === 1 && 'max-w-md',
                  site.pricing.length === 2 && 'max-w-3xl md:grid-cols-2',
                  site.pricing.length >= 3 && 'md:grid-cols-3',
                )}
              >
                {site.pricing.map((plan) => (
                  <article
                    key={plan.name}
                    className={cn(
                      'relative flex flex-col rounded-xl border bg-canvas p-6',
                      plan.highlighted ? 'border-accent shadow-lg' : 'border-line',
                    )}
                  >
                    {plan.highlighted && (
                      <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-0.5 text-xs font-medium text-white">
                        Most popular
                      </span>
                    )}
                    <h3 className="font-semibold">{plan.name}</h3>
                    <p className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
                      {plan.period !== '' && (
                        <span className="text-sm text-fg-muted">/{plan.period}</span>
                      )}
                    </p>
                    <p className="mt-3 text-sm text-fg-muted">{plan.description}</p>
                    <ul className="mt-6 flex-1 space-y-2.5">
                      {plan.features.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/dashboard"
                      className={cn(
                        'mt-8 inline-flex justify-center rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
                        plan.highlighted
                          ? 'bg-accent text-white hover:bg-accent-hover'
                          : 'border border-line text-fg hover:border-line-strong',
                      )}
                    >
                      Choose {plan.name}
                    </Link>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {site.testimonials.length > 0 && (
          <section
            id="testimonials"
            aria-labelledby="testimonials-title"
            className="scroll-mt-20 border-t border-line py-20"
          >
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <h2
                id="testimonials-title"
                className="text-center text-3xl font-semibold tracking-tight"
              >
                Loved by our customers
              </h2>
              <div className="mt-12 grid gap-5 md:grid-cols-3">
                {site.testimonials.map((item) => (
                  <figure
                    key={item.name + item.quote}
                    className="flex flex-col rounded-xl border border-line bg-surface p-6"
                  >
                    <blockquote className="flex-1 text-sm leading-relaxed">
                      “{item.quote}”
                    </blockquote>
                    <figcaption className="mt-6 flex items-center gap-3">
                      <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                        {initials(item.name)}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{item.name}</span>
                        <span className="block text-xs text-fg-muted">{item.role}</span>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {site.faq.length > 0 && (
          <section
            id="faq"
            aria-labelledby="faq-title"
            className="scroll-mt-20 border-t border-line bg-surface/40 py-20"
          >
            <div className="mx-auto max-w-3xl px-4 sm:px-6">
              <h2 id="faq-title" className="text-center text-3xl font-semibold tracking-tight">
                Frequently asked questions
              </h2>
              <div className="mt-10 divide-y divide-line rounded-xl border border-line bg-canvas">
                {site.faq.map((item) => (
                  <details key={item.question} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                      {item.question}
                      <ChevronDown className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-fg-muted">{item.answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="border-t border-line py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">{site.closing.title}</h2>
            <p className="mt-3 text-fg-muted">{site.closing.subtitle}</p>
            <Link
              to="/dashboard"
              className="mt-8 inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {site.primaryCta}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {site.brand} · {site.tagline.replace(/[.!]+$/, '')}
          </p>
          <div className="flex flex-wrap gap-5">
            {sections.map((section) => (
              <a key={section.id} href={'#' + section.id} className="hover:text-fg">
                {section.label}
              </a>
            ))}
            <Link to="/dashboard" className="hover:text-fg">
              App
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
`;

export function emitLanding(content: SiteContent): GeneratedFile[] {
  return [
    file('src/content/site.ts', 'typescript', contentFile(content)),
    file('src/features/landing/LandingPage.tsx', 'typescriptreact', landingPage),
  ];
}
