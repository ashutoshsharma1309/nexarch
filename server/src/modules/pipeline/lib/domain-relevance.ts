/**
 * Does the website that came out resemble the website that was asked for?
 *
 * A model that writes its own page is also free to quietly ignore half the
 * request: ask for a cafe site with a menu, prices, opening hours, directions
 * and reviews, and a plausible-looking page can come back with none of them.
 * Nothing downstream would notice — the build succeeds, the preview runs, and
 * the omission only surfaces when a person reads the page.
 *
 * So the request is checked against the design, deterministically. Each check
 * is a signal in the user's own words (`"opening hours"`, `"menu"`,
 * `"testimonials"`) paired with the evidence that would satisfy it in the
 * generated design. No model grades its own homework here: a second model
 * saying "looks good" is not evidence, and this file exists precisely because
 * the first one already said that by implication.
 *
 * What it reports is a gap list, and gaps are specific enough to act on — the
 * pipeline hands them straight back to the design stage as the one thing to
 * fix. Checks only fire when the request raised them: a developer dashboard
 * that never mentions opening hours is not missing opening hours.
 */
import type {
  SiteDesign,
  SiteSection,
} from '../../frontend-generator/frontend-generator.service.js';

export type RelevanceStatus = 'PASS' | 'FAIL';

export interface RelevanceCheck {
  id: string;
  /** What the request asked for, in the request's terms. */
  label: string;
  status: RelevanceStatus;
  /** Why it passed, or what is missing — always something a person can read. */
  evidence: string;
}

export interface RelevanceReport {
  status: 'PASS' | 'INCOMPLETE';
  checks: RelevanceCheck[];
  /** One instruction per failure, for a targeted second attempt. */
  gaps: string[];
  /** Checks that applied to this request — the rest were never asked for. */
  applicable: number;
  passed: number;
}

interface Signal {
  id: string;
  label: string;
  /** Raised only when the request says so. */
  asks: RegExp;
  /** What satisfies it in the design. */
  satisfied: (design: SiteDesign) => boolean;
  /** The instruction handed back when it is not satisfied. */
  fix: string;
}

function kinds(design: SiteDesign): Set<SiteSection['kind']> {
  return new Set(design.sections.map((section) => section.kind));
}

/** Every word the page renders, lowercased — the copy as a visitor reads it. */
function copyOf(design: SiteDesign): string {
  const parts: string[] = [design.brand, design.tagline, design.footerNote];
  for (const section of design.sections) {
    if ('title' in section) parts.push(section.title);
    if ('subtitle' in section) parts.push(section.subtitle);
    parts.push(section.navLabel);
    switch (section.kind) {
      case 'hero':
        parts.push(
          section.headline,
          section.subheadline,
          section.badge,
          section.artLabel,
          // The buttons are copy too — "Reserve a table" is the whole point
          // of the request that asked for a reservation.
          section.primaryCta,
          section.secondaryCta,
        );
        break;
      case 'features':
      case 'steps':
        for (const item of section.items) parts.push(item.title, item.description);
        break;
      case 'catalog':
        for (const item of section.items) {
          parts.push(item.name, item.description, item.price, item.tag, item.artLabel);
        }
        break;
      case 'gallery':
        for (const item of section.items) parts.push(item.caption, item.artLabel);
        break;
      case 'hours':
      case 'contact':
        for (const row of section.rows) parts.push(row.label, row.value);
        parts.push(section.note);
        break;
      case 'stats':
        for (const item of section.items) parts.push(item.value, item.label);
        break;
      case 'pricing':
        for (const plan of section.plans) {
          parts.push(plan.name, plan.price, plan.description, ...plan.features);
        }
        break;
      case 'testimonials':
        for (const item of section.items) parts.push(item.quote, item.name, item.role);
        break;
      case 'faq':
        for (const item of section.items) parts.push(item.question, item.answer);
        break;
      case 'cta':
        parts.push(section.label);
        break;
    }
  }
  return parts.join(' ').toLowerCase();
}

function hasPrices(design: SiteDesign): boolean {
  return design.sections.some(
    (section) =>
      (section.kind === 'catalog' && section.items.some((item) => item.price !== '')) ||
      section.kind === 'pricing',
  );
}

function hasArt(design: SiteDesign): boolean {
  return design.sections.some(
    (section) =>
      (section.kind === 'hero' && section.art !== 'abstract') ||
      (section.kind === 'gallery' && section.items.length > 0) ||
      (section.kind === 'catalog' && section.items.some((item) => item.art !== 'abstract')),
  );
}

/**
 * The signals, in the user's vocabulary rather than the generator's.
 *
 * These are deliberately domain-neutral: `catalog` answers "menu", "courses"
 * and "products" alike, so adding a domain needs no entry here. The list
 * grows when a *kind of omission* is found, not when a new industry is.
 */
const SIGNALS: Signal[] = [
  {
    id: 'listing',
    label: 'a list of what is on offer',
    asks: /\b(menu|menus|catalog|catalogue|courses?|classes|products?|dishes|services|treatments|packages|plans|inventory|listings?)\b/i,
    satisfied: (design) => kinds(design).has('catalog') || kinds(design).has('pricing'),
    fix: 'Add a `catalog` section listing what is on offer, with a name and description for each item.',
  },
  {
    id: 'prices',
    label: 'prices',
    asks: /\b(price|prices|pricing|cost|costs|fees?|rates?|tariffs?|\$|£|€)\b/i,
    satisfied: hasPrices,
    fix: 'Give every catalog item a `price`, or add a `pricing` section — the request asks for prices.',
  },
  {
    id: 'hours',
    label: 'opening hours or a schedule',
    asks: /\b(opening hours|open hours|hours|timetable|schedule|timings?|availability)\b/i,
    satisfied: (design) => kinds(design).has('hours'),
    fix: 'Add an `hours` section with one row per day or slot.',
  },
  {
    id: 'location',
    label: 'location or contact details',
    asks: /\b(location|address|directions|find us|contact|phone|map|where we are|visit)\b/i,
    satisfied: (design) => kinds(design).has('contact'),
    fix: 'Add a `contact` section with the address and how to get in touch.',
  },
  {
    id: 'testimonials',
    label: 'testimonials or reviews',
    asks: /\b(testimonials?|reviews?|what customers say|feedback from customers)\b/i,
    satisfied: (design) => kinds(design).has('testimonials'),
    fix: 'Add a `testimonials` section with clearly fictional customer quotes.',
  },
  {
    id: 'faq',
    label: 'frequently asked questions',
    asks: /\b(faqs?|frequently asked|common questions)\b/i,
    satisfied: (design) => kinds(design).has('faq'),
    fix: 'Add a `faq` section with three to six questions and answers.',
  },
  {
    id: 'imagery',
    label: 'imagery',
    asks: /\b(photo|photos|photography|image|images|imagery|gallery|pictures?|visuals?)\b/i,
    satisfied: hasArt,
    fix: 'Choose an `art` kind that matches the subject for the hero and the catalog items, and add a `gallery` section if the request asks to see the place or the work.',
  },
  {
    id: 'booking',
    label: 'booking, reservation or ordering',
    asks: /\b(reservations?|reserve|booking|book a table|appointments?|order online|ordering|enrol|enroll|sign ?up)\b/i,
    satisfied: (design) => {
      const copy = copyOf(design);
      return /\b(reserv|book|appointment|order|enrol|enroll|sign up|table)/.test(copy);
    },
    fix: 'Make the call to action the thing the request asked for — reserving a table, booking an appointment or ordering — in the hero and closing section.',
  },
  {
    id: 'stats',
    label: 'numbers worth showing',
    asks: /\b(statistics|stats|metrics|numbers|progress|results|performance)\b/i,
    satisfied: (design) => kinds(design).has('stats') || kinds(design).has('features'),
    fix: 'Add a `stats` section with the numbers that matter for this product.',
  },
];

/** Words that say nothing about a domain, so they prove nothing about the copy. */
const STOPWORDS = new Set([
  'build',
  'create',
  'make',
  'website',
  'site',
  'web',
  'app',
  'application',
  'platform',
  'system',
  'page',
  'landing',
  'modern',
  'simple',
  'clean',
  'with',
  'and',
  'the',
  'for',
  'that',
  'this',
  'from',
  'into',
  'have',
  'has',
  'including',
  'include',
  'includes',
  'using',
  'use',
  'want',
  'need',
  'please',
  'should',
  'where',
  'which',
  'when',
  'their',
  'there',
  'also',
  'some',
  'full',
  'responsive',
  'interface',
  'design',
  'designs',
  'feature',
  'features',
  'section',
  'sections',
  'information',
  'details',
  'online',
  'user',
  'users',
  'customer',
  'customers',
  'data',
  'management',
  'dashboard',
]);

/** The words in the request that actually name its subject. */
export function subjectWords(prompt: string): string[] {
  const seen = new Set<string>();
  for (const raw of prompt.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    const word = raw.replace(/'s$/, '');
    if (STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/**
 * Compare the design with the request.
 *
 * `aiConfigured` matters because a derived page is a known, reported
 * degradation rather than a relevance failure: saying "this page ignores
 * your request" when the provider was unreachable would be true but useless,
 * and the stage already reports that case honestly.
 */
export function auditDomainRelevance(
  prompt: string,
  design: SiteDesign,
  options: { modelAvailable: boolean } = { modelAvailable: true },
): RelevanceReport {
  const checks: RelevanceCheck[] = [];

  for (const signal of SIGNALS) {
    if (!signal.asks.test(prompt)) continue;
    const ok = signal.satisfied(design);
    checks.push({
      id: signal.id,
      label: signal.label,
      status: ok ? 'PASS' : 'FAIL',
      evidence: ok ? `The request asks for ${signal.label}; the page has it.` : signal.fix,
    });
  }

  // The subject check: a page about the right thing says the right words.
  const copy = copyOf(design);
  const subjects = subjectWords(prompt);
  const mentioned = subjects.filter((word) => copy.includes(word));
  if (subjects.length > 0) {
    const ok = mentioned.length > 0;
    checks.push({
      id: 'subject',
      label: 'the subject of the request',
      status: ok ? 'PASS' : 'FAIL',
      evidence: ok
        ? `The copy speaks about ${mentioned.slice(0, 4).join(', ')}.`
        : `The copy never mentions ${subjects.slice(0, 6).join(', ')} — it reads like a generic product page.`,
    });
  }

  // The template check: the fallback page is recognisable, and shipping it
  // while a provider was available means the design stage silently failed.
  if (options.modelAvailable) {
    const ok = design.source === 'ai';
    checks.push({
      id: 'designed',
      label: 'a page designed for this request',
      status: ok ? 'PASS' : 'FAIL',
      evidence: ok
        ? 'The page was designed for this request.'
        : 'The page fell back to the spec-derived template, which is the same for every project.',
    });
  }

  const failures = checks.filter((check) => check.status === 'FAIL');
  return {
    status: failures.length === 0 ? 'PASS' : 'INCOMPLETE',
    checks,
    gaps: failures.map((check) => check.evidence),
    applicable: checks.length,
    passed: checks.length - failures.length,
  };
}

/** One line for the build log: what was checked and what is still missing. */
export function summarizeRelevance(report: RelevanceReport): string {
  const head = `Domain relevance ${String(report.passed)}/${String(report.applicable)}`;
  if (report.status === 'PASS') return `${head} — the page matches the request.`;
  const missing = report.checks
    .filter((check) => check.status === 'FAIL')
    .map((check) => check.label)
    .join(', ');
  return `${head} — still missing: ${missing}.`;
}
