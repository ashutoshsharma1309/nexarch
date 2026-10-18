/**
 * Step two of an edit: the plan, before anything has happened.
 *
 * A plan is a proposal and nothing more — the project on disk is exactly as
 * it was — so the panel says that first and keeps saying it. Everything else
 * here exists to make "apply" a decision rather than a leap: the files that
 * will be rewritten, the areas that will not, what the graph says depends on
 * them, what the image was actually read as, and the commands that will run.
 *
 * The honesty rules this screen keeps: an unread image is reported as
 * unread, and an unavailable dependency graph is reported as unavailable.
 * Rendering "no dependencies" when the truth is "we don't know" would turn a
 * missing graph into a safety claim.
 */
import {
  AlertTriangle,
  Eye,
  EyeOff,
  FileDiff,
  Lock,
  Network,
  ShieldQuestion,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { formatBytes } from '@/shared/lib/format';
import type { EditPlan, ImageKind, ImpactedByEdit, VisualReading } from '@/shared/types/api';

const IMAGE_KIND_LABEL: Record<ImageKind, string> = {
  reference: 'reference screenshot',
  mockup: 'design mockup',
  asset: 'app asset',
};

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 font-mono text-2xs tracking-wide text-fg-subtle uppercase">
      {icon}
      {children}
    </p>
  );
}

/**
 * What the model saw, or why it saw nothing.
 *
 * The two halves are deliberately different shapes. An available reading
 * shows the swatches and names the model that produced them, so the claim
 * can be checked; an unavailable one shows the reason and no fields at all,
 * because empty layout and typography rows next to the word "reading" read
 * as "we looked and found nothing".
 */
function ImageReading({ reading }: { reading: VisualReading }) {
  if (!reading.available) {
    return (
      <div className="rounded-md border border-line bg-inset px-3 py-2.5">
        <SectionTitle icon={<EyeOff className="size-3" />}>No image was read</SectionTitle>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
          {reading.unavailableReason ?? 'No reason was given.'}
        </p>
        <p className="mt-1 text-2xs text-fg-subtle">
          This plan was written from the instruction alone.
        </p>
      </div>
    );
  }

  const rows: { label: string; value: string }[] = [
    { label: 'layout', value: reading.layout },
    { label: 'typography', value: reading.typography },
    { label: 'spacing', value: reading.spacing },
    { label: 'mood', value: reading.mood },
  ].filter((row) => row.value !== '');

  return (
    <div className="rounded-md border border-line bg-inset px-3 py-2.5">
      <SectionTitle icon={<Eye className="size-3" />}>What the image showed</SectionTitle>

      {reading.palette.length > 0 && (
        <ul
          className="mt-2 flex flex-wrap items-center gap-2"
          aria-label="Palette read from the image"
        >
          {reading.palette.map((colour) => (
            <li key={colour} className="flex items-center gap-1.5">
              <span
                className="size-4 rounded border border-line"
                style={{ backgroundColor: colour }}
                aria-hidden="true"
              />
              <span className="font-mono text-2xs text-fg-muted">{colour}</span>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt className="font-mono text-2xs text-fg-subtle">{row.label}</dt>
              <dd className="text-xs leading-relaxed text-fg-muted">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {reading.components.length > 0 && (
        <p className="mt-2 text-xs text-fg-muted">
          <span className="font-mono text-2xs text-fg-subtle">components · </span>
          {reading.components.join(', ')}
        </p>
      )}

      {reading.notes !== '' && (
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{reading.notes}</p>
      )}

      <p className="mt-2 font-mono text-2xs text-fg-subtle">
        read by {reading.model ?? 'an unnamed model'}
      </p>
    </div>
  );
}

/** Dependents shallowest first: depth 1 is what touches the changed file. */
function groupByDepth(nodes: ImpactedByEdit[]): { depth: number; nodes: ImpactedByEdit[] }[] {
  const groups = new Map<number, ImpactedByEdit[]>();
  for (const node of nodes) {
    const bucket = groups.get(node.depth);
    if (bucket) bucket.push(node);
    else groups.set(node.depth, [node]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([depth, grouped]) => ({ depth, nodes: grouped }));
}

function ImpactedList({ nodes }: { nodes: ImpactedByEdit[] }) {
  return (
    <div className="space-y-2">
      {groupByDepth(nodes).map((group) => (
        <div key={group.depth}>
          <p className="font-mono text-2xs text-fg-subtle">
            depth {group.depth} · {group.nodes.length}
          </p>
          <ul className="mt-1 space-y-1">
            {group.nodes.map((node) => (
              <li key={node.nodeId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs text-fg">{node.name}</span>
                <Badge variant="neutral">{node.type}</Badge>
                <span className="font-mono text-2xs text-fg-subtle">
                  via {node.via.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="text-2xs text-fg-muted">{node.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function EditPlanReview({
  plan,
  applying,
  onApply,
  onDiscard,
}: {
  plan: EditPlan;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { impact } = plan;

  return (
    <div className="space-y-4">
      <Card className="border-accent/40">
        <CardContent className="py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <ShieldQuestion className="size-3.5" />
            Nothing has changed yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            This is a plan. The project still has every file it had before, and it stays that way
            until you apply the edit.
          </p>
        </CardContent>
      </Card>

      <div>
        <SectionTitle icon={<Wand2 className="size-3" />}>What this edit does</SectionTitle>
        <p className="mt-1.5 text-sm leading-relaxed text-fg">{plan.summary}</p>
        <p className="mt-1 text-xs text-fg-muted italic">“{plan.instruction}”</p>
        {plan.image && (
          <p className="mt-1 font-mono text-2xs text-fg-subtle">
            {IMAGE_KIND_LABEL[plan.image.kind]} · {plan.image.name} ·{' '}
            {formatBytes(plan.image.bytes)} · {plan.image.width}×{plan.image.height}
          </p>
        )}
      </div>

      {plan.risks.length > 0 && (
        <Card className="border-warning/50">
          <CardContent className="py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle className="size-3.5" />
              {plan.risks.length === 1 ? 'One thing to decide first' : 'Things to decide first'}
            </p>
            <ul className="mt-2 space-y-1.5">
              {plan.risks.map((risk) => (
                <li key={risk} className="text-xs leading-relaxed text-fg">
                  {risk}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ImageReading reading={plan.reading} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle icon={<FileDiff className="size-3" />}>
            Files that will change · {plan.changes.length}
          </SectionTitle>
          {plan.changes.length > 0 ? (
            <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
              {plan.changes.map((change) => (
                <li key={change.path} className="px-3 py-1.5">
                  <p className="font-mono text-2xs break-all text-fg">{change.path}</p>
                  <p className="text-2xs text-fg-subtle">{change.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-fg-muted">
              No file differs from what is already built, so applying this would rewrite nothing.
            </p>
          )}
        </div>

        <div>
          <SectionTitle icon={<Lock className="size-3" />}>What stays untouched</SectionTitle>
          {plan.preserved.length > 0 ? (
            <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
              {plan.preserved.map((area) => (
                <li
                  key={area.label}
                  className="flex items-center justify-between gap-3 px-3 py-1.5"
                >
                  <span className="text-xs text-fg">{area.label}</span>
                  <span className="font-mono text-2xs text-fg-subtle tabular-nums">
                    {area.fileCount} files
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-fg-muted">The plan names no area it leaves alone.</p>
          )}
        </div>
      </div>

      <div>
        <SectionTitle icon={<Network className="size-3" />}>Impact</SectionTitle>
        <div className="mt-1.5 space-y-3 rounded-md border border-line px-3 py-2.5">
          <div>
            <p className="font-mono text-2xs text-fg-subtle">
              directly rewritten · {impact.direct.length}
            </p>
            {impact.direct.length > 0 ? (
              <ul className="mt-1">
                {impact.direct.map((path) => (
                  <li key={path} className="font-mono text-2xs break-all text-fg-muted">
                    {path}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-fg-muted">No file is rewritten by this edit.</p>
            )}
          </div>

          {impact.graphUnavailable ? (
            <div className="rounded border border-warning/40 bg-raised/40 px-2.5 py-2">
              <p className="text-xs font-medium text-warning">
                What depends on these files is unknown
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                {impact.graphUnavailableReason ??
                  'The knowledge graph gave no reason for being unavailable.'}
              </p>
            </div>
          ) : (
            <>
              <div>
                <p className="font-mono text-2xs text-fg-subtle">
                  dependents the graph knows of · {impact.dependents.length}
                </p>
                {impact.dependents.length > 0 ? (
                  <div className="mt-1">
                    <ImpactedList nodes={impact.dependents} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-fg-muted">
                    The graph holds no edge into these files from anywhere else.
                  </p>
                )}
              </div>
              <div>
                <p className="font-mono text-2xs text-fg-subtle">
                  tests the graph links · {impact.tests.length}
                </p>
                {impact.tests.length > 0 ? (
                  <div className="mt-1">
                    <ImpactedList nodes={impact.tests} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-fg-muted">
                    No test in the graph is linked to these files.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <SectionTitle icon={<ShieldQuestion className="size-3" />}>
          What applying will run
        </SectionTitle>
        <ol className="mt-1.5 space-y-1">
          {plan.validationPlan.map((step, index) => (
            <li key={step} className="flex gap-2 text-xs text-fg-muted">
              <span className="font-mono text-2xs text-fg-subtle tabular-nums">{index + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button variant="primary" loading={applying} onClick={onApply}>
          Apply edit
        </Button>
        <Button
          variant="ghost"
          disabled={applying}
          icon={<Trash2 className="size-3.5" />}
          onClick={onDiscard}
        >
          Discard
        </Button>
        <p className="text-2xs text-fg-subtle">
          Applying takes one to two minutes. Discarding costs nothing — the plan is only a plan.
        </p>
      </div>
    </div>
  );
}
