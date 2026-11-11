/**
 * Turns research evidence into a design system and a page specification.
 *
 * Deterministic on purpose: each value is a measurement, a sourced decision, a
 * word in the request, or one of research's uncited suggestions, and `basis`
 * says which of the first three. `direction` and `uxPatterns` are the fourth
 * and the brief labels them so. The model that writes the page reads this as
 * a brief and does the creative work.
 *
 * Reference sites contribute proportions only — scale ratios, spacing and
 * layout habits. Their colours, wording and fonts by name stay out, so what
 * comes back cannot become a copy of someone else's brand.
 */
import type {
  ReferenceViewportMeasurements,
  ResearchArtifact,
} from '../../web-research/web-research.types.js';
import type { ProductDecision } from './product-decision.js';

export interface PageSectionSpec {
  kind: string;
  purpose: string;
  /** `request` when the user's words called for it, otherwise `research`. */
  basis: 'request' | 'research' | 'convention';
  sourceIds: string[];
}

export interface DesignSystemSpec {
  direction: string[];
  typography: {
    typeScaleRatio: number | null;
    bodySizePx: number | null;
    lineHeightRatio: number | null;
    headingFontKind: string | null;
  };
  spacing: { baseUnitPx: number | null; sectionGapPx: number | null };
  canvas: 'light' | 'dark' | null;
  navigationPattern: string | null;
  uxPatterns: string[];
}

export interface DesignIntelligence {
  basis: 'research' | 'requirement-only';
  /** How many rendered references the numbers came from. */
  measuredReferences: number;
  designSystem: DesignSystemSpec;
  pageSpec: PageSectionSpec[];
  limitations: string[];
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) return null;
  return sorted.length % 2 === 1
    ? middle
    : (middle + (sorted[sorted.length / 2 - 1] ?? middle)) / 2;
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function present<T>(values: readonly (T | null | undefined)[]): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}

function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return (
    (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255
  );
}

function measuredSystem(
  measured: readonly ReferenceViewportMeasurements[],
): Pick<DesignSystemSpec, 'typography' | 'spacing' | 'canvas' | 'navigationPattern'> {
  const backgrounds = present(
    measured.map((page) => {
      const background = page.palette.find((entry) => entry.role === 'background');
      return background ? luminance(background.hex) : null;
    }),
  );
  const canvasLight = median(backgrounds);
  return {
    typography: {
      typeScaleRatio: median(present(measured.map((page) => page.typeScaleRatio))),
      bodySizePx: median(present(measured.map((page) => page.body?.sizePx))),
      lineHeightRatio: median(present(measured.map((page) => page.body?.lineHeightRatio))),
      headingFontKind: mostCommon(present(measured.map((page) => page.headings[0]?.fontKind))),
    },
    spacing: {
      baseUnitPx: median(present(measured.map((page) => page.spacing.baseUnitPx))),
      sectionGapPx: median(present(measured.map((page) => page.spacing.sectionGapPx))),
    },
    canvas: canvasLight === null ? null : canvasLight >= 0.5 ? 'light' : 'dark',
    navigationPattern: mostCommon(measured.map((page) => page.nav.pattern)),
  };
}

const SECTION_RULES: readonly {
  kind: string;
  purpose: string;
  /** Only the request can ask for these; research never adds them. */
  requestOnly?: boolean;
  words: RegExp;
}[] = [
  {
    kind: 'catalog',
    purpose: 'What is on offer, with real names and any prices given.',
    words: /\b(menus?|products?|services?|treatments?|courses?|catalog\w*|collection|range)\b/i,
  },
  {
    kind: 'gallery',
    purpose: 'Show the place or the work.',
    words: /\b(gallery|galleries|photos?|portfolio|showcase)\b/i,
  },
  {
    kind: 'steps',
    purpose: 'How it works, in order.',
    words: /\b(how it works|process|steps?)\b/i,
  },
  {
    kind: 'hours',
    purpose: 'When the place is open.',
    words: /\b(hours|opening times?|open from)\b/i,
  },
  {
    kind: 'contact',
    purpose: 'How to reach or find them.',
    words: /\b(contact|locations?|address|directions?|find us)\b/i,
  },
  {
    kind: 'faq',
    purpose: 'Answer what visitors ask before acting.',
    words: /\b(faqs?|frequently asked|questions)\b/i,
  },
  {
    kind: 'pricing',
    purpose: 'Plans the request described.',
    requestOnly: true,
    words: /\b(pricing|plans|subscriptions?)\b/i,
  },
  {
    kind: 'testimonials',
    purpose: 'Quotes the request asked for.',
    requestOnly: true,
    words: /\b(testimonials?)\b/i,
  },
];

function buildPageSpec(prompt: string, research: ResearchArtifact | undefined): PageSectionSpec[] {
  const evidence = research
    ? [
        ...research.decisions.map((d) => ({
          text: `${d.decision} ${d.rationale}`,
          ids: d.sourceIds,
        })),
        ...research.findings.map((f) => ({ text: f.statement, ids: f.sourceIds })),
      ]
    : [];

  const middle: PageSectionSpec[] = [];
  for (const rule of SECTION_RULES) {
    if (rule.words.test(prompt)) {
      middle.push({ kind: rule.kind, purpose: rule.purpose, basis: 'request', sourceIds: [] });
      continue;
    }
    if (rule.requestOnly) continue;
    const backing = evidence.filter((entry) => rule.words.test(entry.text));
    if (backing.length === 0) continue;
    middle.push({
      kind: rule.kind,
      purpose: rule.purpose,
      basis: 'research',
      sourceIds: [...new Set(backing.flatMap((entry) => entry.ids))].slice(0, 5),
    });
  }

  return [
    {
      kind: 'hero',
      purpose: 'Say what this is and what to do next.',
      basis: 'convention',
      sourceIds: [],
    },
    ...middle.slice(0, 5),
    { kind: 'cta', purpose: 'The closing invitation.', basis: 'convention', sourceIds: [] },
  ];
}

export function buildDesignIntelligence(
  prompt: string,
  research: ResearchArtifact | undefined,
  decision: ProductDecision,
): DesignIntelligence {
  const measured = (research?.referenceAnalyses ?? []).flatMap((analysis) =>
    analysis.measurements ? [analysis.measurements.desktop] : [],
  );
  const hasEvidence = research ? research.findings.length + research.decisions.length > 0 : false;
  const limitations: string[] = [];
  if (!research) limitations.push('Web research did not run for this build.');
  else if (!hasEvidence) limitations.push('Web research produced no verified findings.');
  if (measured.length === 0) {
    limitations.push('No reference site was rendered, so type and spacing values are unset.');
  }
  if (research && research.visualDirection.length + research.uxPatterns.length > 0) {
    limitations.push(
      'Visual direction and UX patterns are model suggestions, not traced to a source.',
    );
  }
  if (!decision.backend)
    limitations.push('This is a website only: there is no application behind it.');

  return {
    basis: hasEvidence || measured.length > 0 ? 'research' : 'requirement-only',
    measuredReferences: measured.length,
    designSystem: {
      direction: research?.visualDirection.slice(0, 6) ?? [],
      uxPatterns: research?.uxPatterns.slice(0, 6) ?? [],
      ...measuredSystem(measured),
    },
    pageSpec: buildPageSpec(prompt, research),
    limitations,
  };
}

/** Evidence-derived, so it travels as untrusted data alongside the research brief. */
export function formatDesignBrief(intelligence: DesignIntelligence): string {
  const { designSystem: system, pageSpec } = intelligence;
  const facts = present([
    system.canvas && `Canvas seen on references: ${system.canvas}`,
    system.typography.typeScaleRatio && `Type scale ratio: ${system.typography.typeScaleRatio}`,
    system.typography.bodySizePx && `Body size: ${system.typography.bodySizePx}px`,
    system.typography.headingFontKind && `Heading style: ${system.typography.headingFontKind}`,
    system.spacing.sectionGapPx && `Section gap: ${system.spacing.sectionGapPx}px`,
    system.navigationPattern && `Navigation: ${system.navigationPattern}`,
  ]);
  return [
    `Design brief (basis: ${intelligence.basis}, ${intelligence.measuredReferences} reference(s) measured).`,
    ...(facts.length > 0 ? ['Measured proportions:', ...facts.map((fact) => `- ${fact}`)] : []),
    ...(system.direction.length > 0
      ? [
          'Visual direction (model suggestion, not sourced):',
          ...system.direction.map((d) => `- ${d}`),
        ]
      : []),
    ...(system.uxPatterns.length > 0
      ? ['UX patterns (model suggestion, not sourced):', ...system.uxPatterns.map((p) => `- ${p}`)]
      : []),
    'Page specification, in order:',
    ...pageSpec.map((section) => `- ${section.kind} (${section.basis}): ${section.purpose}`),
  ].join('\n');
}
