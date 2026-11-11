import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDesignIntelligence, formatDesignBrief } from './design-intelligence.js';
import { decideProduct } from './product-decision.js';
import type {
  ReferenceViewportMeasurements,
  ResearchArtifact,
} from '../../web-research/web-research.types.js';

const decision = decideProduct('A website for a clinic.', { appAuthEnabled: true });

function research(overrides: Partial<ResearchArtifact> = {}): ResearchArtifact {
  return {
    findings: [],
    decisions: [],
    visualDirection: [],
    uxPatterns: [],
    referenceAnalyses: [],
    ...overrides,
  } as unknown as ResearchArtifact;
}

function page(typeScaleRatio: number, background: string): ReferenceViewportMeasurements {
  return {
    typeScaleRatio,
    body: { sizePx: 16, lineHeightRatio: 1.5 },
    headings: [{ fontKind: 'serif' }],
    spacing: { baseUnitPx: 8, sectionGapPx: 96 },
    palette: [{ hex: background, role: 'background', share: 0.8 }],
    nav: { pattern: 'horizontal-bar' },
  } as unknown as ReferenceViewportMeasurements;
}

describe('design intelligence', () => {
  it('admits when research gave it nothing', () => {
    const none = buildDesignIntelligence('A website for a clinic.', undefined, decision);
    assert.equal(none.basis, 'requirement-only');
    assert.equal(none.designSystem.typography.typeScaleRatio, null);
    assert.equal(none.designSystem.canvas, null);
    assert.match(none.limitations.join(' '), /did not run/);

    const empty = buildDesignIntelligence('A website for a clinic.', research(), decision);
    assert.equal(empty.basis, 'requirement-only');
    assert.match(empty.limitations.join(' '), /no verified findings/);
  });

  it('takes the median of what was really measured', () => {
    const result = buildDesignIntelligence(
      'A website for a clinic.',
      research({
        referenceAnalyses: [1.2, 1.25, 1.5].map((ratio) => ({
          measurements: { desktop: page(ratio, '#ffffff'), mobile: null },
        })) as unknown as ResearchArtifact['referenceAnalyses'],
      }),
      decision,
    );
    assert.equal(result.basis, 'research');
    assert.equal(result.measuredReferences, 3);
    assert.equal(result.designSystem.typography.typeScaleRatio, 1.25);
    assert.equal(result.designSystem.canvas, 'light');
    assert.equal(result.designSystem.typography.headingFontKind, 'serif');
  });

  it('cites research only for sections research supports', () => {
    const result = buildDesignIntelligence(
      'A website for a clinic.',
      research({
        findings: [
          { statement: 'Clinics list treatments.', sourceIds: ['s1'], confidence: 'high' },
        ],
      }),
      decision,
    );
    const catalog = result.pageSpec.find((section) => section.kind === 'catalog');
    assert.equal(catalog?.basis, 'research');
    assert.deepEqual(catalog.sourceIds, ['s1']);
  });

  it('never lets research add testimonials or pricing', () => {
    const result = buildDesignIntelligence(
      'A website for a clinic.',
      research({
        findings: [
          {
            statement: 'Clinics show testimonials and pricing plans.',
            sourceIds: ['s1'],
            confidence: 'high',
          },
        ],
      }),
      decision,
    );
    const kinds = result.pageSpec.map((section) => section.kind);
    assert.ok(!kinds.includes('testimonials'));
    assert.ok(!kinds.includes('pricing'));
  });

  it('adds them when the request asks, opens on a hero and closes on a cta', () => {
    const result = buildDesignIntelligence(
      'A site with testimonials and pricing.',
      research(),
      decision,
    );
    const kinds = result.pageSpec.map((section) => section.kind);
    assert.equal(kinds[0], 'hero');
    assert.equal(kinds.at(-1), 'cta');
    assert.ok(kinds.includes('testimonials'));
  });

  it('carries proportions, never a reference colour, into the brief', () => {
    const result = buildDesignIntelligence(
      'A website for a clinic.',
      research({
        referenceAnalyses: [
          { measurements: { desktop: page(1.25, '#123456'), mobile: null } },
        ] as unknown as ResearchArtifact['referenceAnalyses'],
      }),
      decision,
    );
    const brief = formatDesignBrief(result);
    assert.match(brief, /Type scale ratio: 1\.25/);
    assert.doesNotMatch(brief, /#123456/);
  });
});
