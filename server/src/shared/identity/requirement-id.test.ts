/**
 * Requirement identity (`npm test`).
 *
 * `requirementId` is only useful if it agrees with the thing that already
 * stores requirement identity: `GraphNode.canonicalName`. If the two ever
 * drift, every id computed at a finding or a construction site points at a
 * requirement that does not exist in `graph_nodes`, and nothing fails
 * loudly — the links just stop resolving. These tests are the guard against
 * that drift, so they check the agreement against the real graph builder
 * rather than against a copy of the rules.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requirementId } from './requirement-id.js';
import { buildGraph } from '../../modules/engineering-graph/lib/graph-builder.js';
import type { RequirementSpec } from '../types/requirement.js';

const spec: RequirementSpec = {
  projectName: 'Course Platform',
  projectType: 'saas',
  roles: ['Admin', 'Student'],
  modules: ['Course Management', 'Enrollments', 'Payment Processing'],
  frontend: ['react'],
  backend: ['express'],
  database: ['Course', 'Enrollment'],
  authentication: ['Email and Password'],
  integrations: ['Stripe Billing'],
  missingRequirements: [],
};

describe('requirementId', () => {
  it('returns the same id for the same text', () => {
    assert.equal(requirementId('Email Notifications'), requirementId('Email Notifications'));
  });

  it('folds the spellings one requirement arrives in', () => {
    const id = requirementId('Course Management');
    assert.equal(requirementId('Courses'), id);
    assert.equal(requirementId('course'), id);
    assert.equal(requirementId('CourseService'), id);
  });

  it('never returns an empty id, so a key is always derivable', () => {
    assert.notEqual(requirementId(''), '');
    assert.notEqual(requirementId('   '), '');
  });

  it('keeps genuinely different requirements apart', () => {
    assert.notEqual(requirementId('Enrollments'), requirementId('Payment Processing'));
  });

  it('matches the canonicalName the graph stores for a REQUIREMENT node', () => {
    const draft = buildGraph({ requirements: spec });
    const stored = new Set(
      draft.nodes.filter((node) => node.type === 'REQUIREMENT').map((node) => node.canonicalName),
    );

    assert.ok(stored.size > 0, 'the builder produced no REQUIREMENT nodes to compare against');
    for (const item of [...spec.modules, ...spec.authentication, ...spec.integrations]) {
      assert.ok(
        stored.has(requirementId(item)),
        `no REQUIREMENT node named ${requirementId(item)} for "${item}"`,
      );
    }
  });
});
