/**
 * Holding a proposed design to what the instruction asked for.
 *
 * The prompt tells the model to copy everything else through unchanged, and a
 * model will still blank a footer while changing a headline. So the promise is
 * kept here, on the validated object, where it can be checked: nothing the
 * person did not ask to remove is removed, and an instruction that limits
 * itself ("change nothing else") limits the fields that may differ.
 */
import type { SiteDesign } from '../../frontend-generator/frontend-generator.service.js';

type Section = SiteDesign['sections'][number];
type SectionKind = Section['kind'];

export interface KeptField {
  field: string;
  reason: string;
}

const EXCLUSIVE =
  /\b(only|nothing else|everything else|no other|leave the rest|keep the rest|just (the|change|update|edit|replace)|(do not|don'?t) (change|touch|alter|modify))\b/i;
const REMOVAL = /\b(remove|delete|drop|clear|blank|hide|get rid of|without)\b/i;
const THEME_TERMS =
  /\b(colou?rs?|palette|accent|theme|dark|light mode|fonts?|typograph\w*|corners?|rounded)\b/i;

const TOP_LEVEL_TERMS = {
  brand: /\b(brand|site name|business name|rename)\b/i,
  tagline: /\b(tagline|slogan)\b/i,
  footerNote: /\bfooter\b/i,
} as const;

const SECTION_TERMS: Record<SectionKind, RegExp> = {
  hero: /\b(hero|headline|heading|banner|masthead|primary button|main button|secondary button)\b/i,
  features: /\b(features?|benefits?)\b/i,
  catalog: /\b(menu|catalog(ue)?|products?|dishes|services|offerings?)\b/i,
  gallery: /\b(gallery|photos?)\b/i,
  hours: /\b(hours|opening times?)\b/i,
  contact: /\b(contact|address|phone|email)\b/i,
  stats: /\b(stats?|statistics|metrics)\b/i,
  steps: /\b(steps?|how it works|process)\b/i,
  pricing: /\b(pricing|prices?|plans?)\b/i,
  testimonials: /\b(testimonials?|reviews?|quotes?)\b/i,
  faq: /\b(faqs?|questions?)\b/i,
  cta: /\b(cta|call[- ]to[- ]action|closing section)\b/i,
};

/** Which words name which field inside a section, for field-level limits. */
const FIELD_TERMS: Record<string, RegExp> = {
  headline: /\b(headline|heading|main title)\b/i,
  title: /\b(title|heading)\b/i,
  subheadline: /\b(sub-?headline|sub-?heading|subtitle|description)\b/i,
  subtitle: /\b(subtitle|sub-?heading|description)\b/i,
  badge: /\b(badge|eyebrow)\b/i,
  primaryCta: /\b(primary (button|cta|action)|main button|button label|button text)\b/i,
  secondaryCta: /\bsecondary (button|cta|action)\b/i,
  label: /\b(button|label)\b/i,
  note: /\bnote\b/i,
};

function isBlank(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sectionNamed(instruction: string, section: Section): boolean {
  if (SECTION_TERMS[section.kind].test(instruction)) return true;
  const lowered = instruction.toLowerCase();
  const title = 'title' in section ? section.title.toLowerCase() : '';
  const label = section.navLabel.toLowerCase();
  return (label !== '' && lowered.includes(label)) || (title !== '' && lowered.includes(title));
}

function asksToRemove(instruction: string, term: RegExp): boolean {
  return REMOVAL.test(instruction) && term.test(instruction);
}

function sectionTerm(section: Section): RegExp {
  return SECTION_TERMS[section.kind];
}

/** Restores what this section was not asked to change, field by field. */
function scopeSection(
  instruction: string,
  before: Section,
  proposed: Section,
  exclusive: boolean,
  kept: KeptField[],
): Section {
  const next = { ...proposed } as Record<string, unknown>;
  const original = before as unknown as Record<string, unknown>;
  const named = Object.keys(original).filter((key) => FIELD_TERMS[key]?.test(instruction) === true);
  for (const [key, value] of Object.entries(original)) {
    if (key === 'kind' || key === 'id' || same(next[key], value)) continue;
    const name = `${before.kind}.${key}`;
    if (!isBlank(value) && isBlank(next[key]) && !asksToRemove(instruction, sectionTerm(before))) {
      next[key] = value;
      kept.push({ field: name, reason: 'the proposal blanked it and it was not asked to' });
    } else if (exclusive && named.length > 0 && !named.includes(key)) {
      next[key] = value;
      kept.push({ field: name, reason: 'the instruction limited the change to other fields' });
    }
  }
  return next as unknown as Section;
}

/**
 * The design that may actually be applied, and every field held back.
 *
 * `scoped` is false when the instruction limited itself but named nothing this
 * can match, so the reader can be told the limit could not be enforced.
 */
export function enforceDesignScope(
  instruction: string,
  current: SiteDesign,
  proposed: SiteDesign,
): { design: SiteDesign; kept: KeptField[]; limitUnenforced: boolean } {
  const kept: KeptField[] = [];
  const sectionsNamed = current.sections.some((section) => sectionNamed(instruction, section));
  const topNamed = Object.values(TOP_LEVEL_TERMS).some((term) => term.test(instruction));
  const themeNamed = THEME_TERMS.test(instruction);
  const limits = EXCLUSIVE.test(instruction);
  const exclusive = limits && (sectionsNamed || topNamed || themeNamed);
  const design: SiteDesign = { ...proposed };

  for (const key of ['brand', 'tagline', 'footerNote'] as const) {
    const term = TOP_LEVEL_TERMS[key];
    if (design[key] === current[key]) continue;
    if (
      current[key].trim() !== '' &&
      design[key].trim() === '' &&
      !asksToRemove(instruction, term)
    ) {
      design[key] = current[key];
      kept.push({ field: key, reason: 'the proposal blanked it and it was not asked to' });
    } else if (exclusive && !term.test(instruction)) {
      design[key] = current[key];
      kept.push({ field: key, reason: 'the instruction did not ask to change it' });
    }
  }

  if (exclusive && !themeNamed && !same(design.theme, current.theme)) {
    design.theme = current.theme;
    kept.push({ field: 'theme', reason: 'the instruction did not ask to change it' });
  }

  const byId = new Map(proposed.sections.map((section) => [section.id, section]));
  const consumed = new Set<Section>();
  const matched = current.sections.map((section) => {
    const hit =
      byId.get(section.id) ??
      proposed.sections.find((c) => c.kind === section.kind && !consumed.has(c));
    if (hit?.kind !== section.kind) return null;
    consumed.add(hit);
    return hit;
  });

  const sections: Section[] = [];
  for (const proposal of proposed.sections) {
    if (consumed.has(proposal)) {
      const index = matched.indexOf(proposal);
      const before = current.sections[index];
      if (before === undefined) continue;
      if (exclusive && !sectionNamed(instruction, before)) {
        if (!same(proposal, before)) {
          kept.push({
            field: before.kind,
            reason: 'the instruction did not ask to change this section',
          });
        }
        sections.push(before);
      } else {
        sections.push(scopeSection(instruction, before, proposal, exclusive, kept));
      }
    } else if (!exclusive || sectionNamed(instruction, proposal)) {
      sections.push(proposal);
    } else {
      kept.push({
        field: proposal.kind,
        reason: 'the instruction did not ask to add this section',
      });
    }
  }

  // Put back what vanished, at its old position, unless removing it was asked.
  current.sections.forEach((section, index) => {
    if (matched[index] !== null && matched[index] !== undefined) return;
    if (asksToRemove(instruction, sectionTerm(section))) return;
    sections.splice(Math.min(index, sections.length), 0, section);
    kept.push({ field: section.kind, reason: 'the proposal removed it and it was not asked to' });
  });

  design.sections = sections;
  return { design, kept, limitUnenforced: limits && !exclusive };
}
