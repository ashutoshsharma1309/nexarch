/**
 * Enforces, in code, what the site-design prompt only asks for.
 *
 * Every prompt forbids invented people, testimonials, credentials, addresses,
 * phone numbers and prices, and the models write them anyway: real runs came
 * back with named reviewers, a street address and a sourcing claim on pages
 * whose request stated none of those. So what comes back is checked against
 * the only source of business facts there is, the user's own request, and any
 * claim the request does not support is removed before it reaches a file.
 *
 * Removal is reported: the run records what was taken out, so an empty contact
 * section reads as "this was invented and removed", not as a generator gap.
 * Nothing here knows any business or industry; it knows the shapes of claims.
 */
import type { SiteDesign, SiteSection } from './site-content.js';

const PHONE = /(?:\+?\d[\d().\s-]{7,}\d)/g;
const EMAIL = /\b[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;
const STREET =
  /\b\d{1,5}\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Boulevard|Blvd|Drive|Dr|Way|Court|Ct|Place|Pl|Square|Sq)\b\.?/g;
const MONEY =
  /(?:[$€£¥₹]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:usd|eur|gbp|inr)\b|\b\d[\d.,]*\s*(?:\/|per)\s*(?:mo|month|yr|year|user|seat)s?\b)/gi;
const CREDENTIAL =
  /\b(?:award[- ]winning|michelin|accredited|board[- ]certified|certified by|licensed by|\d+\+?\s+years?\b|years? of experience|trusted by|as (?:seen|featured) in|partner(?:s|ed|ing)? with|in partnership with|guaranteed? uptime|\d+(?:\.\d+)?%\s+(?:uptime|satisfaction|of (?:our )?customers))\b/gi;
const PERSON =
  /\b(?:(?:Dr|Prof|Professor|Chef|Mr|Mrs|Ms|Mx)\.?\s+[A-Z][a-z]+|[A-Z][a-z]+\s+[A-Z][a-z]+,\s*(?:CEO|CTO|COO|CFO|Co-?Founder|Founder|Head|Director|Manager|Owner|Chef|Lead)\b|(?:founded|led|run|owned|created|started)\s+by\s+[A-Z][a-z]+\s+[A-Z][a-z]+)/g;
const CONTACT_LABEL =
  /\b(address|location|find us|visit|phone|tel|telephone|mobile|e-?mail|contact)\b/i;

const CLAIMS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: PHONE, what: 'a phone number' },
  { pattern: EMAIL, what: 'an email address' },
  { pattern: STREET, what: 'a street address' },
  { pattern: MONEY, what: 'a price' },
  { pattern: CREDENTIAL, what: 'a credential or endorsement' },
  { pattern: PERSON, what: 'a named person' },
];

function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$€£¥₹%@.+-]+/g, ' ')
    .trim();
}

function digitsOf(text: string): string {
  return text.replace(/\D+/g, '');
}

function matchesOf(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0].trim());
}

/** The claim holds when the request itself states it, in any punctuation. */
function supportedBy(request: string, claim: string): boolean {
  const body = normalized(request);
  const stated = normalized(claim);
  if (stated !== '' && body.includes(stated)) return true;
  const digits = digitsOf(claim);
  return digits.length >= 7 && digitsOf(request).includes(digits);
}

export function unsupportedClaims(
  text: string,
  request: string,
): { claim: string; what: string }[] {
  const found: { claim: string; what: string }[] = [];
  for (const { pattern, what } of CLAIMS) {
    for (const claim of matchesOf(text, pattern)) {
      // A bare run of digits is a number in code, not a phone number in copy.
      if (what === 'a phone number' && (digitsOf(claim).length < 8 || /^\d+$/.test(claim)))
        continue;
      if (!supportedBy(request, claim)) found.push({ claim, what });
    }
  }
  return found;
}

const SENTENCE_END = /(?<=[.!?])\s+/;

/** The text with every sentence carrying an unsupported claim taken out. */
function withoutClaims(text: string, request: string, removed: string[]): string {
  if (text === '' || unsupportedClaims(text, request).length === 0) return text;
  const kept = text.split(SENTENCE_END).filter((sentence) => {
    const claims = unsupportedClaims(sentence, request);
    for (const { claim, what } of claims) removed.push(`${what}: "${claim}"`);
    return claims.length === 0;
  });
  return kept.join(' ').trim();
}

function amountIn(value: string): boolean {
  return /\d/.test(value);
}

function statedPrice(price: string, request: string, removed: string[]): string {
  if (price === '' || !amountIn(price) || supportedBy(request, price)) return price;
  removed.push(`a price: "${price}"`);
  return '';
}

function isContactRow(label: string, value: string): boolean {
  return CONTACT_LABEL.test(label) || CONTACT_LABEL.test(value);
}

type Section = SiteSection;

function cleanSection(section: Section, request: string, removed: string[]): Section | null {
  const clean = (value: string): string => withoutClaims(value, request, removed);
  switch (section.kind) {
    case 'hero':
      return {
        ...section,
        headline: clean(section.headline) || section.navLabel,
        subheadline: clean(section.subheadline),
        badge: clean(section.badge),
      };
    case 'features':
    case 'steps': {
      const items = section.items
        .filter((item) => clean(item.title) !== '')
        .map((item) => ({ ...item, description: clean(item.description) }));
      return items.length === 0 ? null : { ...section, items };
    }
    case 'catalog':
      return {
        ...section,
        subtitle: clean(section.subtitle),
        items: section.items.map((item) => ({
          ...item,
          description: clean(item.description),
          tag: clean(item.tag),
          price: statedPrice(item.price, request, removed),
        })),
      };
    case 'gallery':
      return { ...section, items: section.items.filter((item) => clean(item.caption) !== '') };
    case 'hours':
    case 'contact': {
      const rows = section.rows.filter((row) => {
        if (section.kind === 'hours') return true;
        const invented = isContactRow(row.label, row.value) && !supportedBy(request, row.value);
        if (invented) removed.push(`contact detail "${row.label}: ${row.value}"`);
        return !invented;
      });
      if (rows.length === 0) return null;
      return { ...section, rows, subtitle: clean(section.subtitle), note: clean(section.note) };
    }
    case 'stats': {
      const items = section.items.filter((item) => {
        const invented = amountIn(item.value) && !supportedBy(request, item.value);
        if (invented) removed.push(`statistic "${item.value} ${item.label}"`);
        return !invented;
      });
      return items.length === 0 ? null : { ...section, items };
    }
    case 'pricing':
      return {
        ...section,
        subtitle: clean(section.subtitle),
        plans: section.plans.map((plan) => {
          const price = statedPrice(plan.price, request, removed);
          return {
            ...plan,
            // Plans stay so the shape of the offer still shows; the invented
            // amount does not.
            price: price === '' ? 'To be confirmed' : price,
            period: price === '' ? '' : plan.period,
            description: clean(plan.description),
            features: plan.features.filter((feature) => clean(feature) !== ''),
          };
        }),
      };
    case 'testimonials': {
      const items = section.items.filter((item) => {
        const stated = supportedBy(request, item.quote) && supportedBy(request, item.name);
        if (!stated) removed.push(`testimonial attributed to "${item.name}"`);
        return stated;
      });
      return items.length === 0 ? null : { ...section, items };
    }
    case 'faq': {
      const items = section.items
        .map((item) => ({ ...item, answer: clean(item.answer) }))
        .filter((item) => item.answer !== '');
      return items.length === 0 ? null : { ...section, items };
    }
    case 'cta':
      return {
        ...section,
        title: clean(section.title) || section.navLabel,
        subtitle: clean(section.subtitle),
      };
  }
}

export interface FactEnforcement {
  design: SiteDesign;
  removed: string[];
}

/**
 * The design with everything the request does not support removed.
 * `removed` names each thing taken out, for the run's record.
 */
export function enforceSiteFacts(design: SiteDesign, request: string): FactEnforcement {
  const removed: string[] = [];
  const sections = design.sections
    .map((section) => cleanSection(section, request, removed))
    .filter((section): section is Section => section !== null);
  return {
    design: {
      ...design,
      tagline: withoutClaims(design.tagline, request, removed),
      footerNote: withoutClaims(design.footerNote, request, removed),
      sections,
    },
    removed: [...new Set(removed)].slice(0, 40),
  };
}

const PLACEHOLDER_EMAIL = /(example|test|company|your|domain|email|acme|sample)/i;
/** Code is full of words like "certified"; only hard facts are checked there. */
const SOURCE_CLAIMS = new Set([
  'a phone number',
  'an email address',
  'a street address',
  'a price',
]);

/** Claims a generated source file adds that the request does not support. */
export function inventedClaimsInSource(
  content: string,
  baseline: string | undefined,
  request: string,
): string[] {
  const seen = new Set<string>();
  for (const { claim, what } of unsupportedClaims(content, request)) {
    if (!SOURCE_CLAIMS.has(what)) continue;
    if (what === 'an email address' && PLACEHOLDER_EMAIL.test(claim)) continue;
    if (what === 'a price' && !/[1-9]/.test(claim)) continue;
    if (baseline?.includes(claim) === true) continue;
    seen.add(`${what} (${claim})`);
  }
  const testimonial = /\btestimonial/i.test(content);
  const quoted = /\bname:\s*['"`][A-Z][a-z]+\s+[A-Z][a-z]+['"`]/.exec(content);
  if (testimonial && quoted && baseline?.includes(quoted[0]) !== true) {
    seen.add(`a named testimonial (${quoted[0]})`);
  }
  return [...seen];
}

const SERVICE_CLAIM =
  /\b(?:[Pp]owered by|[Bb]uilt (?:on|with)|[Ii]ntegrates? with|[Cc]onnects? to|[Dd]ata (?:from|by))\s+([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*)?)/g;

export interface ServiceClaimCheck {
  design: SiteDesign;
  /** old text -> new text, for the same strings in the emitted content file. */
  replacements: { from: string; to: string }[];
  removed: string[];
}

/**
 * Removes "powered by X" claims about a service the application never calls.
 *
 * Copy is written before the code exists, so this runs after implementation
 * and looks at the code: a footer that names a service is true only when the
 * delivered source really contains a call to it.
 */
export function withoutUnbackedServiceClaims(
  design: SiteDesign,
  callsService: (name: string) => boolean,
): ServiceClaimCheck {
  const replacements: ServiceClaimCheck['replacements'] = [];
  const removed: string[] = [];
  const check = (value: string): string => {
    const unbacked = [...value.matchAll(SERVICE_CLAIM)].filter(
      (match) => match[1] !== undefined && !callsService(match[1]),
    );
    if (unbacked.length === 0) return value;
    const next = value
      .split(SENTENCE_END)
      .filter((sentence) => !unbacked.some((match) => sentence.includes(match[0])))
      .join(' ')
      .trim();
    if (next !== value) {
      replacements.push({ from: value, to: next });
      removed.push(...unbacked.map((match) => `an unbacked service claim: "${match[0]}"`));
    }
    return next;
  };
  const walk = <T>(value: T): T => {
    if (typeof value === 'string') return check(value) as T;
    if (Array.isArray(value)) return value.map(walk) as T;
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, walk(entry as unknown)]),
      ) as T;
    }
    return value;
  };
  const { source, theme, ...content } = design;
  return {
    design: { ...walk(content), source, theme },
    replacements,
    removed: [...new Set(removed)],
  };
}
