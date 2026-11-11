/**
 * A plain edit changes what was asked for and nothing else, and leaves a
 * record. Enforced on the design object, so a model that blanks a footer
 * while changing a headline cannot reach the project.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  listExecutionEvents,
  listStageUsage,
  publishExecutionEvent,
  useExecutionStore,
} from '../execution-events/execution-events.service.js';
import { createMemoryStore } from '../execution-events/lib/event-store.js';
import type { SiteDesign } from '../frontend-generator/frontend-generator.service.js';
import { enforceDesignScope } from './lib/design-scope.js';
import { EditTimeline } from './lib/edit-timeline.js';

const CURRENT = {
  brand: 'Trattoria',
  tagline: 'Fresh pasta',
  theme: {
    mode: 'light',
    temperature: 'warm',
    corners: 'soft',
    fontId: 'inter',
    palette: { accent: '#aa0000' },
  },
  footerNote: 'Fresh daily pasta and traditional recipes.',
  source: 'ai',
  sections: [
    {
      kind: 'hero',
      id: 'home',
      navLabel: 'Home',
      headline: 'Old headline',
      subheadline: 'Old sub',
      badge: 'Open',
      primaryCta: 'Reserve',
      secondaryCta: 'Menu',
      layout: 'split',
      art: 'dining',
      artLabel: 'A table',
    },
    {
      kind: 'faq',
      id: 'faq',
      navLabel: 'FAQ',
      title: 'Questions',
      subtitle: 'Asked often',
      items: [],
    },
    {
      kind: 'cta',
      id: 'visit',
      navLabel: 'Visit',
      title: 'Come by',
      subtitle: 'We are open',
      label: 'Book',
    },
  ],
} as unknown as SiteDesign;

function propose(
  change: (design: SiteDesign & { sections: Record<string, unknown>[] }) => void,
): SiteDesign {
  const copy = structuredClone(CURRENT) as SiteDesign & { sections: Record<string, unknown>[] };
  change(copy);
  return copy;
}

const HEADLINE = 'Change the hero headline and the primary button label. Change nothing else.';

function hero(design: SiteDesign): Record<string, unknown> {
  return design.sections[0] as unknown as Record<string, unknown>;
}

describe('enforceDesignScope', () => {
  it('restores a footer the proposal blanked', () => {
    const { design, kept } = enforceDesignScope(
      'Make the headline warmer',
      CURRENT,
      propose((next) => {
        next.footerNote = '';
      }),
    );
    assert.equal(design.footerNote, CURRENT.footerNote);
    assert.equal(kept[0]?.field, 'footerNote');
  });

  it('allows a footer to go when that was asked for', () => {
    const { design } = enforceDesignScope(
      'Remove the footer note',
      CURRENT,
      propose((next) => {
        next.footerNote = '';
      }),
    );
    assert.equal(design.footerNote, '');
  });

  it('applies the named fields and holds back the rest of a limited edit', () => {
    const { design, kept } = enforceDesignScope(
      HEADLINE,
      CURRENT,
      propose((next) => {
        const first = next.sections[0] as Record<string, unknown>;
        first.headline = 'New headline';
        first.primaryCta = 'Book now';
        first.subheadline = 'Rewritten';
        (next.sections[2] as Record<string, unknown>).title = 'Rewritten too';
        next.tagline = 'Rewritten as well';
      }),
    );
    assert.equal(hero(design).headline, 'New headline');
    assert.equal(hero(design).primaryCta, 'Book now');
    assert.equal(hero(design).subheadline, 'Old sub');
    assert.deepEqual(design.sections[2], CURRENT.sections[2]);
    assert.equal(design.tagline, CURRENT.tagline);
    assert.deepEqual(kept.map((entry) => entry.field).sort(), [
      'cta',
      'hero.subheadline',
      'tagline',
    ]);
  });

  it('holds the theme back from a limited edit that did not mention it', () => {
    const { design } = enforceDesignScope(
      HEADLINE,
      CURRENT,
      propose((next) => {
        next.theme = { ...next.theme, mode: 'dark' };
      }),
    );
    assert.equal(design.theme.mode, 'light');
  });

  it('puts back a section the proposal dropped, in place', () => {
    const { design, kept } = enforceDesignScope(
      'Make the headline warmer',
      CURRENT,
      propose((next) => {
        next.sections.splice(1, 1);
      }),
    );
    assert.deepEqual(
      design.sections.map((section) => section.kind),
      ['hero', 'faq', 'cta'],
    );
    assert.equal(kept[0]?.field, 'faq');
  });

  it('leaves a broad instruction free to change copy', () => {
    const { design, kept, limitUnenforced } = enforceDesignScope(
      'Rewrite the copy to feel more premium',
      CURRENT,
      propose((next) => {
        next.tagline = 'Handmade every morning';
        (next.sections[0] as Record<string, unknown>).subheadline = 'New sub';
      }),
    );
    assert.equal(design.tagline, 'Handmade every morning');
    assert.equal(hero(design).subheadline, 'New sub');
    assert.deepEqual(kept, []);
    assert.equal(limitUnenforced, false);
  });

  it('says so when a limit names nothing it can match', () => {
    const { limitUnenforced } = enforceDesignScope(
      'Change only the wording about delivery',
      CURRENT,
      propose((next) => {
        next.tagline = 'Delivered';
      }),
    );
    assert.equal(limitUnenforced, true);
  });
});

describe('plain edits in the execution timeline', () => {
  it('records events and usage for an edit job', async () => {
    useExecutionStore(createMemoryStore());
    try {
      const timeline = new EditTimeline('project-1', 'edit-1');
      timeline.emit('job.started', 'Edit started', 'started');
      timeline.replayPlanning(
        [
          {
            promptId: 'edit-site-design',
            provider: 'groq',
            model: 'm',
            inputTokens: 10,
            outputTokens: null,
            costUsd: null,
            durationMs: 5,
            cacheHit: false,
          },
        ],
        '2026-11-09T00:00:00.000Z',
      );
      timeline.enterStage('validating', 'two files');
      timeline.checks({
        checks: [
          { name: 'Build', status: 'PASS', detail: 'ok' },
          { name: 'Type check', status: 'FAIL', detail: 'exit 2' },
          { name: 'Lint', status: 'SKIPPED', detail: 'no script' },
        ],
        startedUp: false,
        frontendUrl: null,
        backendUrl: null,
      });
      timeline.failStage('rejected');
      timeline.emit('job.failed', 'Rejected', 'failed');
      // Publishes are queued per job, so awaiting a later one waits for them all.
      await publishExecutionEvent({
        projectId: 'project-1',
        jobKind: 'ENHANCEMENT',
        jobId: 'edit-1',
        type: 'note',
        message: 'flush',
      });

      const events = (await listExecutionEvents('edit-1')).filter((event) => event.type !== 'note');
      assert.deepEqual(
        events.map((event) => event.type),
        [
          'job.started',
          'model.call',
          'stage.started',
          'verify.check',
          'verify.check',
          'verify.check',
          'stage.failed',
          'job.failed',
        ],
      );
      assert.deepEqual(
        events.filter((event) => event.type === 'verify.check').map((event) => event.status),
        ['succeeded', 'failed', 'skipped'],
      );
      assert.equal(events[0]?.data?.editJob, true);
      assert.equal(events[1]?.data?.replayed, true);

      const usage = await listStageUsage('edit-1');
      assert.equal(usage.length, 1);
      assert.equal(usage[0]?.inputTokens, 10);
      assert.equal(usage[0].outputTokens, null);
    } finally {
      useExecutionStore();
    }
  });
});
