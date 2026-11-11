import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideProduct,
  scopePlan,
  scopeRequirements,
  summarizeDecision,
} from './product-decision.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

const on = { appAuthEnabled: true };

const spec: RequirementSpec = {
  projectName: 'Thing',
  projectType: 'cafe',
  roles: ['Admin'],
  modules: ['Authentication', 'Products', 'Payments'],
  frontend: ['Home'],
  backend: [],
  database: ['Users', 'Products', 'Payments'],
  authentication: ['Email and password'],
  integrations: ['Stripe', 'Google Maps'],
  missingRequirements: [],
};

describe('product decision', () => {
  it('builds no backend for a website that describes nothing to store', () => {
    const decision = decideProduct('A website for my cafe with our story and photos.', on);
    assert.equal(decision.backend, false);
    assert.equal(decision.database.needed, false);
    assert.equal(decision.authentication.needed, false);
    assert.ok(decision.database.signals.includes('website'));
  });

  it('keeps the database when a website also has to collect something', () => {
    const decision = decideProduct('A website for my cafe with a table booking form.', on);
    assert.equal(decision.backend, true);
    assert.ok(decision.database.signals.length > 0);
  });

  it('assumes a database and says so when the request is ambiguous', () => {
    const decision = decideProduct('Something nice for my neighbourhood group to enjoy.', on);
    assert.equal(decision.database.needed, true);
    assert.match(decision.database.reason, /^Assumed/);
    assert.deepEqual(decision.database.signals, []);
  });

  it('needs sign-in and payment only when the request says so', () => {
    const quiet = decideProduct('A student management system with courses.', on);
    assert.equal(quiet.authentication.needed, false);
    assert.equal(quiet.payments.needed, false);
    const loud = decideProduct('A shop with user accounts, login and Stripe checkout.', on);
    assert.equal(loud.authentication.needed, true);
    assert.equal(loud.payments.needed, true);
    assert.ok(loud.payments.signals.includes('stripe'));
  });

  for (const prompt of [
    'A landing page for my yoga studio that tells customers about our classes',
    'A portfolio website showing my design work and a contact form',
    'A website for my bakery with our history, customer reviews and a contact form',
    'A marketing website for our SaaS platform',
    'A site for my bakery',
  ]) {
    it(`builds no backend for brochure copy: ${prompt}`, () => {
      const decision = decideProduct(prompt, on);
      assert.equal(decision.backend, false);
      assert.equal(decision.database.needed, false);
    });
  }

  it('phrases a weak signal as an assumption', () => {
    const decision = decideProduct('A simple tool for our team.', on);
    assert.equal(decision.database.needed, true);
    assert.match(decision.database.reason, /^Assumed: "tool"/);
  });

  it('does not read a work site as a website', () => {
    const decision = decideProduct('A site inspection tool for our crews', on);
    assert.equal(decision.backend, true);
  });

  it('does not read an early access sign-up form as accounts', () => {
    const decision = decideProduct('A landing page with an early access sign-up form.', on);
    assert.equal(decision.authentication.needed, false);
    assert.equal(decideProduct('An app with sign up and login.', on).authentication.needed, true);
  });

  it('says a requested payment or integration was not built', () => {
    const decision = decideProduct('A shop with Stripe checkout and Twilio SMS alerts', on);
    assert.match(decision.limitations.join(' '), /no payment provider/);
    assert.match(decision.limitations.join(' '), /"twilio".*not built/);
    assert.match(summarizeDecision(decision), /payments requested, not built/);
    assert.match(summarizeDecision(decision), /external APIs requested, not built/);
  });

  it('reports sign-in it could not build rather than implying it exists', () => {
    const decision = decideProduct('A portal with login for staff.', { appAuthEnabled: false });
    assert.equal(decision.authentication.needed, true);
    assert.match(decision.limitations[0] ?? '', /sign-in/);
  });
});

describe('scoping', () => {
  it('removes payment and integrations the request never asked for', () => {
    const prompt = 'A student management system with courses.';
    const scoped = scopeRequirements(spec, decideProduct(prompt, on), prompt);
    assert.deepEqual(scoped.modules, ['Authentication', 'Products']);
    assert.deepEqual(scoped.database, ['Users', 'Products']);
    assert.deepEqual(scoped.integrations, []);
    assert.deepEqual(scoped.authentication, []);
  });

  it('keeps an integration the request names', () => {
    const prompt = 'A delivery tracking system that uses Google Maps.';
    const scoped = scopeRequirements(spec, decideProduct(prompt, on), prompt);
    assert.deepEqual(scoped.integrations, ['Google Maps']);
  });

  it('empties the spec for a website', () => {
    const prompt = 'A landing page for a band.';
    const scoped = scopeRequirements(spec, decideProduct(prompt, on), prompt);
    assert.deepEqual(scoped.database, []);
    assert.deepEqual(scoped.modules, []);
  });

  it('takes the API and tables out of a website plan', () => {
    const prompt = 'A landing page for a band.';
    const plan = {
      folderStructure: [],
      apiModules: [{ module: 'Authentication', basePath: '/auth', endpoints: [] }],
      frontend: { pages: [], layouts: [] },
      database: { entities: [{ name: 'Users' }] },
      services: [{ module: 'Authentication' }],
      middleware: [],
      security: {},
      dependencyGraph: { nodes: [], edges: [] },
    } as unknown as ArchitecturePlan;
    const scoped = scopePlan(plan, decideProduct(prompt, on));
    assert.deepEqual(scoped.apiModules, []);
    assert.deepEqual(scoped.database.entities, []);
  });
});
