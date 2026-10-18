/**
 * The relevance gate is the check that would have caught the defect that
 * caused all of this: a generated site that ignores half the request and
 * still reports success. So these tests are written around that failure —
 * a page that is missing what was asked for must come back INCOMPLETE, with
 * gaps specific enough to hand back to the design stage, and a page that is
 * simply about something else must not pass merely because it has sections.
 *
 * The other half is restraint. A check that fires when the request never
 * raised it teaches people to ignore the whole report, so every signal here
 * is proven to stay quiet when the request is silent about it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auditDomainRelevance, subjectWords } from './lib/domain-relevance.js';
import { deriveSiteDesign } from '../frontend-generator/frontend-generator.service.js';
import type { SiteDesign, SiteSection } from '../frontend-generator/frontend-generator.service.js';

const CAFE_REQUEST =
  'Build a modern cafe website with coffee and pastry imagery, a menu with prices, opening hours, location information, customer testimonials, and a reservation interaction.';

function design(sections: SiteSection[], source: 'ai' | 'derived' = 'ai'): SiteDesign {
  return {
    brand: 'Bean Lane',
    tagline: 'Neighbourhood coffee',
    theme: {
      mode: 'light',
      temperature: 'warm',
      corners: 'round',
      fontId: 'fraunces',
      palette: {
        canvas: '#faf5ef',
        surface: '#fffdfa',
        raised: '#ffffff',
        inset: '#f2e9df',
        line: '#e7dbcd',
        lineStrong: '#d2c0ad',
        fg: '#221913',
        fgMuted: '#6a594c',
        fgSubtle: '#96867a',
        accent: '#b4581f',
        accentHover: '#c4713a',
        accentSoft: '#b4581f1a',
        accentFg: '#ffffff',
        success: '#2f8a62',
        warning: '#b07d28',
        danger: '#c04747',
        dangerSoft: '#c047471a',
      },
    },
    sections,
    footerNote: '',
    source,
  };
}

const hero: SiteSection = {
  kind: 'hero',
  id: 'top',
  navLabel: 'Home',
  headline: 'Coffee worth the walk',
  subheadline: 'Pastries baked each morning on Bean Lane.',
  badge: 'Open daily',
  primaryCta: 'Reserve a table',
  secondaryCta: 'See the menu',
  art: 'coffee',
  artLabel: 'A flat white on a saucer',
};

const menu: SiteSection = {
  kind: 'catalog',
  id: 'menu',
  navLabel: 'Menu',
  title: 'On the menu',
  subtitle: '',
  items: [
    {
      name: 'Flat white',
      description: 'Double ristretto.',
      price: '£3.20',
      tag: '',
      art: 'coffee',
      artLabel: 'A flat white',
    },
  ],
};

const hours: SiteSection = {
  kind: 'hours',
  id: 'hours',
  navLabel: 'Hours',
  title: 'Opening hours',
  subtitle: '',
  rows: [{ label: 'Monday', value: '7am – 6pm' }],
  note: '',
};

const contact: SiteSection = {
  kind: 'contact',
  id: 'find-us',
  navLabel: 'Find us',
  title: 'Find us',
  subtitle: '',
  rows: [{ label: 'Address', value: '14 Bean Lane' }],
  note: '',
};

const testimonials: SiteSection = {
  kind: 'testimonials',
  id: 'loved',
  navLabel: '',
  title: 'Regulars',
  subtitle: '',
  items: [{ quote: 'The best flat white nearby.', name: 'Ada Park', role: 'Regular' }],
};

describe('domain relevance', () => {
  it('passes a page that answers everything the request asked for', () => {
    const report = auditDomainRelevance(
      CAFE_REQUEST,
      design([hero, menu, hours, contact, testimonials]),
    );
    assert.equal(report.status, 'PASS');
    assert.equal(report.passed, report.applicable);
    assert.deepEqual(report.gaps, []);
  });

  it('names what is missing, specifically enough to fix', () => {
    const report = auditDomainRelevance(CAFE_REQUEST, design([hero, menu]));
    assert.equal(report.status, 'INCOMPLETE');

    const failed = report.checks
      .filter((check) => check.status === 'FAIL')
      .map((check) => check.id);
    assert.deepEqual(failed.sort(), ['hours', 'location', 'testimonials']);
    // The gaps are instructions, not labels: they are fed back to the model.
    assert.ok(report.gaps.some((gap) => gap.includes('`hours`')));
    assert.ok(report.gaps.some((gap) => gap.includes('`contact`')));
  });

  it('stays quiet about what the request never raised', () => {
    const request = 'Build a developer productivity dashboard with build history and test results.';
    const report = auditDomainRelevance(request, design([hero, menu]));
    const raised = report.checks.map((check) => check.id);

    // No one asked this dashboard for opening hours or a cafe's address.
    assert.equal(raised.includes('hours'), false);
    assert.equal(raised.includes('location'), false);
    assert.equal(raised.includes('testimonials'), false);
  });

  it('catches the original defect: a page about something else entirely', () => {
    const generic: SiteSection = {
      ...hero,
      headline: 'NovaStack, ready when you are',
      subheadline: 'A platform application with everything you need.',
      primaryCta: 'Get started',
      secondaryCta: '',
      badge: 'Platform',
      art: 'abstract',
      artLabel: 'Abstract shapes',
    };
    // The brand and tagline are generic too: this is the page the generator
    // used to produce for every request, whatever the request said.
    const report = auditDomainRelevance(
      'Build a cafe website with coffee and pastry photography and a menu.',
      { ...design([generic]), brand: 'NovaStack', tagline: 'Platform' },
    );

    const subject = report.checks.find((check) => check.id === 'subject');
    assert.equal(subject?.status, 'FAIL');
    assert.match(subject.evidence, /never mentions/);
    const imagery = report.checks.find((check) => check.id === 'imagery');
    assert.equal(imagery?.status, 'FAIL', 'abstract art is not cafe imagery');
  });

  it('reports a fallback page as a failure only when a model was available', () => {
    const fallback = design([hero], 'derived');
    assert.equal(
      auditDomainRelevance(CAFE_REQUEST, fallback, { modelAvailable: false }).checks.some(
        (check) => check.id === 'designed',
      ),
      false,
      'an unreachable provider is reported by the stage, not blamed on the page',
    );
    assert.equal(
      auditDomainRelevance(CAFE_REQUEST, fallback, { modelAvailable: true }).checks.find(
        (check) => check.id === 'designed',
      )?.status,
      'FAIL',
    );
  });

  it('judges the derived page honestly — it is the template this gate exists to catch', () => {
    const derived = deriveSiteDesign({
      projectName: 'Bean Lane',
      projectType: 'cafe',
      roles: ['Admin', 'User'],
      modules: ['Orders', 'Menu'],
      frontend: [],
      backend: [],
      database: ['Orders'],
      authentication: [],
      integrations: [],
      missingRequirements: [],
    });
    const report = auditDomainRelevance(CAFE_REQUEST, derived, { modelAvailable: true });
    assert.equal(report.status, 'INCOMPLETE');
    assert.ok(report.gaps.length > 0);
  });

  it('ignores words that name no domain', () => {
    const words = subjectWords('Build a modern responsive website application for a bakery');
    assert.ok(words.includes('bakery'));
    for (const noise of ['build', 'modern', 'responsive', 'website', 'application']) {
      assert.equal(words.includes(noise), false, `${noise} proves nothing about a domain`);
    }
  });
});
