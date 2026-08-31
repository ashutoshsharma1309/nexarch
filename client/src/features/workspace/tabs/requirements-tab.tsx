/**
 * What was asked for, and what the analyzer made of it.
 *
 * The original prompt sits at the top because it is the source of
 * everything below — when a generated schema looks wrong, the prompt is
 * usually why, and burying it makes that hard to see. Re-running analysis
 * means rebuilding, so this tab links to Build rather than offering a
 * second, subtly different way to trigger the same work.
 */
import { MessageSquareQuote, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { JsonViewer } from '@/features/prompt/components/json-viewer';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { PageHeader } from '@/shared/components/page-header';
import { slugify } from '@/shared/lib/slugify';
import { useWorkspace } from '../workspace-context';
import { BuildRequiredState } from './build-required-state';

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{label}</p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-fg-subtle">None identified</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item}>
              <Badge variant="neutral">{item}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RequirementsTab() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const base = `/projects/${workspace.project?.id ?? ''}`;

  if (!workspace.latestRun) return <BuildRequiredState what="the requirements" />;
  if (!workspace.artifacts) {
    return (
      <BuildRequiredState
        what="the requirements"
        missing={workspace.artifactsMissing}
        loading={!workspace.artifactsMissing}
      />
    );
  }

  const spec = workspace.artifacts.requirements;

  return (
    <div className="space-y-5">
      <PageHeader
        variant="section"
        title="Requirements"
        description={`What the analyzer extracted from the prompt that built ${spec.projectName}.`}
        actions={
          <Button
            size="sm"
            icon={<Pencil className="size-3.5" />}
            onClick={() => {
              void navigate(`${base}/build`);
            }}
          >
            Edit &amp; re-run
          </Button>
        }
      />

      <Card>
        <CardContent className="py-4">
          <p className="flex items-center gap-1.5 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
            <MessageSquareQuote className="size-3" />
            Original prompt
          </p>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-muted">
            {workspace.latestRun.prompt}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-5 py-4 sm:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Badge variant="ember">{spec.projectType}</Badge>
            <Badge variant="neutral">{spec.modules.length} modules</Badge>
            <Badge variant="neutral">{spec.database.length} entities</Badge>
            {spec.missingRequirements.length > 0 && (
              <Badge variant="warning">{spec.missingRequirements.length} unspecified</Badge>
            )}
          </div>
          <List label="Users / actors" items={spec.roles} />
          <List label="Features" items={spec.modules} />
          <List label="Screens" items={spec.frontend} />
          <List label="Backend capabilities" items={spec.backend} />
          <List label="Data entities" items={spec.database} />
          <List label="Authentication" items={spec.authentication} />
          <List label="Integrations" items={spec.integrations} />
          <List label="Left unspecified" items={spec.missingRequirements} />
        </CardContent>
      </Card>

      <section>
        <h3 className="mb-2 text-sm font-medium text-fg">Structured specification</h3>
        <JsonViewer value={spec} exportName={slugify(spec.projectName, 'requirement-spec')} />
      </section>
    </div>
  );
}
