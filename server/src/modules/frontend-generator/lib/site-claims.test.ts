import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  enforceSiteFacts,
  inventedClaimsInSource,
  unsupportedClaims,
  withoutUnbackedServiceClaims,
} from './site-claims.js';
import type { SiteDesign, SiteSection, SiteTheme } from './site-content.js';

const THEME = {} as SiteTheme;

function designOf(sections: SiteSection[], overrides: Partial<SiteDesign> = {}): SiteDesign {
  return {
    brand: 'Brand',
    tagline: 'A tagline.',
    theme: THEME,
    footerNote: '',
    source: 'ai',
    sections,
    ...overrides,
  };
}

const request = 'A website for my bakery. Our phone is 020 7946 0999 and a loaf is £4.50.';

describe('enforceSiteFacts', () => {
  it('removes testimonials the request does not give', () => {
    const section: SiteSection = {
      kind: 'testimonials',
      id: 't',
      navLabel: 'Reviews',
      title: 'Reviews',
      subtitle: '',
      items: [{ quote: 'Lovely.', name: 'Elena Rostova', role: 'Customer' }],
    };
    const { design, removed } = enforceSiteFacts(designOf([section]), request);
    assert.equal(design.sections.length, 0);
    assert.match(removed[0] ?? '', /Elena Rostova/);
  });

  it('keeps contact details the request states and drops the rest', () => {
    const section: SiteSection = {
      kind: 'contact',
      id: 'c',
      navLabel: 'Contact',
      title: 'Contact',
      subtitle: '',
      note: '',
      rows: [
        { label: 'Phone', value: '020 7946 0999' },
        { label: 'Address', value: '42 Elmwood Street' },
        { label: 'Email', value: 'hello@bakery.example' },
      ],
    };
    const result = enforceSiteFacts(designOf([section]), request);
    const kept = result.design.sections[0];
    assert.ok(kept?.kind === 'contact');
    assert.deepEqual(
      kept.rows.map((row) => row.label),
      ['Phone'],
    );
    assert.ok(result.removed.some((entry) => entry.includes('42 Elmwood Street')));
  });

  it('clears invented prices and leaves stated ones', () => {
    const section: SiteSection = {
      kind: 'catalog',
      id: 'm',
      navLabel: 'Menu',
      title: 'Menu',
      subtitle: '',
      layout: 'menu',
      items: [
        { name: 'Loaf', description: '', price: '£4.50', tag: '', art: 'pastry', artLabel: 'Loaf' },
        { name: 'Bun', description: '', price: '£2.20', tag: '', art: 'pastry', artLabel: 'Bun' },
      ],
    };
    const { design } = enforceSiteFacts(designOf([section]), request);
    const catalog = design.sections[0];
    assert.ok(catalog?.kind === 'catalog');
    assert.equal(catalog.items[0]?.price, '£4.50');
    assert.equal(catalog.items[1]?.price, '');
  });

  it('keeps pricing plans but not an amount nobody stated', () => {
    const section: SiteSection = {
      kind: 'pricing',
      id: 'p',
      navLabel: 'Pricing',
      title: 'Pricing',
      subtitle: '',
      plans: [
        {
          name: 'Pro',
          price: 'From $9',
          period: '/mo',
          description: '',
          features: [],
          highlighted: false,
        },
      ],
    };
    const { design } = enforceSiteFacts(designOf([section]), request);
    const pricing = design.sections[0];
    assert.ok(pricing?.kind === 'pricing');
    assert.equal(pricing.plans[0]?.price, 'To be confirmed');
    assert.equal(pricing.plans[0].period, '');
  });

  it('takes credentials and named people out of copy, sentence by sentence', () => {
    const section: SiteSection = {
      kind: 'hero',
      id: 'top',
      navLabel: 'Home',
      headline: 'Fresh bread',
      subheadline: 'Baked every morning. Run by Chef Marco, award-winning since 2010.',
      badge: '',
      primaryCta: 'Order',
      secondaryCta: '',
      layout: 'split',
      art: 'pastry',
      artLabel: 'Bread',
    };
    const { design } = enforceSiteFacts(designOf([section]), request);
    const hero = design.sections[0];
    assert.ok(hero?.kind === 'hero');
    assert.equal(hero.subheadline, 'Baked every morning.');
  });

  it('drops a statistic the request does not state', () => {
    const section: SiteSection = {
      kind: 'stats',
      id: 's',
      navLabel: 'Stats',
      title: 'Stats',
      items: [{ value: '10k+', label: 'happy customers' }],
    };
    const { design } = enforceSiteFacts(designOf([section]), request);
    assert.equal(design.sections.length, 0);
  });
});

describe('unsupportedClaims', () => {
  it('ignores a claim the request itself makes, in any punctuation', () => {
    assert.deepEqual(unsupportedClaims('Call 020-7946-0999', request), []);
  });

  it('does not take a code number for a phone', () => {
    assert.deepEqual(unsupportedClaims('const limit = 100000000', request), []);
  });
});

describe('inventedClaimsInSource', () => {
  it('flags an invented phone added to a page', () => {
    const added = '<p>Call us on +1 (415) 555-0132</p>';
    assert.match(inventedClaimsInSource(added, '', request)[0] ?? '', /phone/);
  });

  it('ignores a claim already in the baseline file', () => {
    const baseline = 'call 415-555-0132';
    assert.deepEqual(inventedClaimsInSource(baseline, baseline, request), []);
  });

  it('ignores placeholder emails', () => {
    assert.deepEqual(
      inventedClaimsInSource('<input placeholder="you@company.com" />', undefined, request),
      [],
    );
  });
});

describe('withoutUnbackedServiceClaims', () => {
  const design = designOf([], { footerNote: 'Fresh daily. Powered by Acme Maps.' });

  it('removes the claim when nothing calls the service', () => {
    const checked = withoutUnbackedServiceClaims(design, () => false);
    assert.equal(checked.design.footerNote, 'Fresh daily.');
    assert.equal(checked.replacements.length, 1);
  });

  it('keeps it when the code really calls the service', () => {
    const checked = withoutUnbackedServiceClaims(design, () => true);
    assert.equal(checked.design.footerNote, design.footerNote);
    assert.equal(checked.replacements.length, 0);
  });
});
