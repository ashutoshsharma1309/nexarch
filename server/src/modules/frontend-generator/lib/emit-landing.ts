/**
 * Emits the generated application's public website at `/` — the page a
 * visitor actually lands on, with the working application one click away at
 * `/dashboard`.
 *
 * The page used to be a fixed sequence: hero, features, pricing,
 * testimonials, FAQ, always in that order, always in the same dark palette,
 * with about a dozen model-written strings poured into it. That is why a
 * cafe and a developer tool came out looking like the same product. The
 * request chose the nouns; the template chose everything else.
 *
 * Now the design chooses. `SiteDesign` carries an ordered list of typed
 * sections, and this file renders them in that order — a menu with prices,
 * opening hours and a map note for one project; features, stats and steps
 * for another. Each section kind is one reviewed component; the design picks
 * which appear, in what order, and what they say.
 *
 * Two properties are worth keeping as you edit. First, the copy is data, not
 * code: it is written into `src/content/site.ts` with `JSON.stringify`, so
 * whatever a model wrote can only ever be a string React escapes, never
 * source. Second, the page reads the app's own theme tokens, so it follows
 * the palette the design asked for and stays consistent with the rest of the
 * generated project.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';
import type { SiteDesign } from './site-content.js';

/** The section data, as a module the page imports. */
function contentFile(design: SiteDesign): string {
  const { source: _source, theme: _theme, ...site } = design;
  return `/**
 * This website's content. Edit freely — the page renders the sections in the
 * order they appear here, and a section with no items simply does not render.
 */
export interface SiteFeature {
  title: string;
  description: string;
}

export interface SiteCatalogItem {
  name: string;
  description: string;
  price: string;
  tag: string;
  art: ArtKind;
  artLabel: string;
}

export interface SiteGalleryItem {
  caption: string;
  art: ArtKind;
  artLabel: string;
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

export interface SiteRow {
  label: string;
  value: string;
}

export type ArtKind =
  | 'coffee'
  | 'pastry'
  | 'dining'
  | 'storefront'
  | 'campus'
  | 'book'
  | 'calendar'
  | 'health'
  | 'commerce'
  | 'analytics'
  | 'code'
  | 'abstract';

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
  | {
      kind: 'stats';
      id: string;
      navLabel: string;
      title: string;
      items: { value: string; label: string }[];
    }
  | {
      kind: 'steps';
      id: string;
      navLabel: string;
      title: string;
      subtitle: string;
      items: SiteFeature[];
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

export interface SiteContent {
  brand: string;
  tagline: string;
  sections: SiteSection[];
  footerNote: string;
}

export const site: SiteContent = ${JSON.stringify(site, null, 2)};
`;
}

const landingPage = `import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, Menu, X } from 'lucide-react';

import { Art } from '@/components/Art';
import { site } from '@/content/site';
import type { SiteSection } from '@/content/site';

/**
 * The public website. Every section comes from \`src/content/site.ts\` and is
 * rendered in the order it appears there.
 */

function Container({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={\`mx-auto w-full max-w-6xl px-5 sm:px-8 \${className}\`}>{children}</div>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  if (!title) return null;
  return (
    <div className="mb-10 max-w-2xl">
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {subtitle ? <p className="mt-3 text-base text-fg-muted">{subtitle}</p> : null}
    </div>
  );
}

function Hero({ section }: { section: Extract<SiteSection, { kind: 'hero' }> }) {
  return (
    <section id={section.id} className="relative overflow-hidden border-b border-line">
      <div className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-accent-soft blur-3xl" />
      <Container className="relative grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-2">
        <div>
          {section.badge ? (
            <span className="inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-fg-muted">
              {section.badge}
            </span>
          ) : null}
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            {section.headline}
          </h1>
          {section.subheadline ? (
            <p className="mt-5 max-w-xl text-pretty text-lg text-fg-muted">{section.subheadline}</p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              {section.primaryCta}
              <ArrowRight className="size-4" />
            </Link>
            {section.secondaryCta ? (
              <a
                href={\`#\${site.sections[1]?.id ?? 'top'}\`}
                className="inline-flex items-center rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-line-strong"
              >
                {section.secondaryCta}
              </a>
            ) : null}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-surface text-accent shadow-sm">
          <Art kind={section.art} label={section.artLabel} className="h-64 w-full sm:h-80" />
        </div>
      </Container>
    </section>
  );
}

function Features({ section }: { section: Extract<SiteSection, { kind: 'features' | 'steps' }> }) {
  const numbered = section.kind === 'steps';
  return (
    <section id={section.id} className="border-b border-line py-20">
      <Container>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {section.items.map((item, index) => (
            <div key={item.title} className="rounded-lg border border-line bg-surface p-6">
              {numbered ? (
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  {index + 1}
                </span>
              ) : null}
              <h3 className={\`font-medium \${numbered ? 'mt-4' : ''}\`}>{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{item.description}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Catalog({ section }: { section: Extract<SiteSection, { kind: 'catalog' }> }) {
  return (
    <section id={section.id} className="border-b border-line py-20">
      <Container>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {section.items.map((item) => (
            <article
              key={item.name}
              className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface"
            >
              <div className="h-40 w-full bg-inset text-accent">
                <Art kind={item.art} label={item.artLabel} className="h-full w-full" />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">{item.name}</h3>
                  {item.price ? (
                    <span className="shrink-0 text-sm font-semibold text-accent">{item.price}</span>
                  ) : null}
                </div>
                {item.description ? (
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">
                    {item.description}
                  </p>
                ) : null}
                {item.tag ? (
                  <span className="mt-4 inline-flex w-fit rounded-full border border-line px-2.5 py-0.5 text-2xs uppercase tracking-wide text-fg-subtle">
                    {item.tag}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Gallery({ section }: { section: Extract<SiteSection, { kind: 'gallery' }> }) {
  return (
    <section id={section.id} className="border-b border-line py-20">
      <Container>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {section.items.map((item) => (
            <figure key={item.caption} className="overflow-hidden rounded-lg border border-line">
              <div className="h-44 bg-surface text-accent">
                <Art kind={item.art} label={item.artLabel} className="h-full w-full" />
              </div>
              <figcaption className="border-t border-line bg-surface px-4 py-3 text-sm text-fg-muted">
                {item.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      </Container>
    </section>
  );
}

function RowList({ section }: { section: Extract<SiteSection, { kind: 'hours' | 'contact' }> }) {
  return (
    <section id={section.id} className="border-b border-line py-20">
      <Container>
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHeading title={section.title} subtitle={section.subtitle} />
          <div>
            <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {section.rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 px-5 py-3.5">
                  <dt className="text-sm text-fg-muted">{row.label}</dt>
                  <dd className="text-sm font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
            {section.note ? <p className="mt-4 text-sm text-fg-subtle">{section.note}</p> : null}
          </div>
        </div>
      </Container>
    </section>
  );
}

function Stats({ section }: { section: Extract<SiteSection, { kind: 'stats' }> }) {
  return (
    <section id={section.id} className="border-b border-line py-16">
      <Container>
        {section.title ? (
          <h2 className="mb-8 text-2xl font-semibold tracking-tight">{section.title}</h2>
        ) : null}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {section.items.map((item) => (
            <div key={item.label} className="rounded-lg border border-line bg-surface p-6">
              <p className="text-3xl font-semibold tracking-tight text-accent">{item.value}</p>
              <p className="mt-1 text-sm text-fg-muted">{item.label}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Pricing({ section }: { section: Extract<SiteSection, { kind: 'pricing' }> }) {
  return (
    <section id={section.id} className="border-b border-line py-20">
      <Container>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <div className="grid gap-6 lg:grid-cols-3">
          {section.plans.map((plan) => (
            <div
              key={plan.name}
              className={\`flex flex-col rounded-lg border bg-surface p-6 \${
                plan.highlighted ? 'border-accent shadow-sm' : 'border-line'
              }\`}
            >
              {plan.highlighted ? (
                <span className="mb-4 inline-flex w-fit rounded-full bg-accent-soft px-2.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-accent">
                  Most popular
                </span>
              ) : null}
              <h3 className="font-medium">{plan.name}</h3>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                {plan.period ? <span className="text-sm text-fg-subtle">{plan.period}</span> : null}
              </p>
              {plan.description ? (
                <p className="mt-3 text-sm text-fg-muted">{plan.description}</p>
              ) : null}
              <ul className="mt-5 flex-1 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm text-fg-muted">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                to="/dashboard"
                className={\`mt-6 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors \${
                  plan.highlighted
                    ? 'bg-accent text-accent-fg hover:bg-accent-hover'
                    : 'border border-line hover:border-line-strong'
                }\`}
              >
                Choose {plan.name}
              </Link>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Testimonials({ section }: { section: Extract<SiteSection, { kind: 'testimonials' }> }) {
  return (
    <section id={section.id} className="border-b border-line py-20">
      <Container>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <div className="grid gap-6 lg:grid-cols-3">
          {section.items.map((item) => (
            <figure key={item.name} className="rounded-lg border border-line bg-surface p-6">
              <blockquote className="text-sm leading-relaxed text-fg-muted">
                “{item.quote}”
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {item.name
                    .split(' ')
                    .map((part) => part.charAt(0))
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span>
                  <span className="block text-sm font-medium">{item.name}</span>
                  {item.role ? (
                    <span className="block text-xs text-fg-subtle">{item.role}</span>
                  ) : null}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Faq({ section }: { section: Extract<SiteSection, { kind: 'faq' }> }) {
  return (
    <section id={section.id} className="border-b border-line py-20">
      <Container>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {section.items.map((item) => (
            <details key={item.question} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium">
                {item.question}
                <ChevronDown className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-5 pb-4 text-sm leading-relaxed text-fg-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Cta({ section }: { section: Extract<SiteSection, { kind: 'cta' }> }) {
  return (
    <section id={section.id} className="py-20">
      <Container>
        <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight">{section.title}</h2>
          {section.subtitle ? (
            <p className="mx-auto mt-3 max-w-xl text-base text-fg-muted">{section.subtitle}</p>
          ) : null}
          <Link
            to="/dashboard"
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            {section.label}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </Container>
    </section>
  );
}

function Section({ section }: { section: SiteSection }) {
  switch (section.kind) {
    case 'hero':
      return <Hero section={section} />;
    case 'features':
    case 'steps':
      return <Features section={section} />;
    case 'catalog':
      return <Catalog section={section} />;
    case 'gallery':
      return <Gallery section={section} />;
    case 'hours':
    case 'contact':
      return <RowList section={section} />;
    case 'stats':
      return <Stats section={section} />;
    case 'pricing':
      return <Pricing section={section} />;
    case 'testimonials':
      return <Testimonials section={section} />;
    case 'faq':
      return <Faq section={section} />;
    case 'cta':
      return <Cta section={section} />;
  }
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = site.sections.filter((section) => section.navLabel !== '');

  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
        <Container className="flex h-16 items-center justify-between gap-4">
          <a href="#top" className="text-base font-semibold tracking-tight">
            {site.brand}
          </a>

          <nav className="hidden items-center gap-7 md:flex">
            {navItems.map((section) => (
              <a
                key={section.id}
                href={\`#\${section.id}\`}
                className="text-sm text-fg-muted transition-colors hover:text-fg"
              >
                {section.navLabel}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/dashboard"
              className="hidden rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover sm:inline-flex"
            >
              Open app
            </Link>
            <button
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen((open) => !open); }}
              className="inline-flex size-9 items-center justify-center rounded-md border border-line md:hidden"
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </Container>

        {menuOpen ? (
          <div className="border-t border-line bg-canvas md:hidden">
            <Container className="flex flex-col gap-1 py-4">
              {navItems.map((section) => (
                <a
                  key={section.id}
                  href={\`#\${section.id}\`}
                  onClick={() => { setMenuOpen(false); }}
                  className="rounded-md px-2 py-2 text-sm text-fg-muted hover:bg-inset hover:text-fg"
                >
                  {section.navLabel}
                </a>
              ))}
              <Link
                to="/dashboard"
                className="mt-2 rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-accent-fg"
              >
                Open app
              </Link>
            </Container>
          </div>
        ) : null}
      </header>

      <main id="top">
        {site.sections.map((section) => (
          <Section key={section.id} section={section} />
        ))}
      </main>

      <footer className="border-t border-line py-10">
        <Container className="flex flex-col items-center justify-between gap-3 text-sm text-fg-subtle sm:flex-row">
          <p>
            © {new Date().getFullYear()} {site.brand}
            {site.footerNote ? \` · \${site.footerNote}\` : ''}
          </p>
          <Link to="/dashboard" className="transition-colors hover:text-fg">
            Open app
          </Link>
        </Container>
      </footer>
    </div>
  );
}
`;

export function emitLanding(design: SiteDesign): GeneratedFile[] {
  return [
    file('src/content/site.ts', 'typescript', contentFile(design)),
    file('src/features/landing/LandingPage.tsx', 'typescriptreact', landingPage),
  ];
}
