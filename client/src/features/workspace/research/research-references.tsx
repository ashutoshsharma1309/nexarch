/** What real renders of reference sites measured, including the ones that could not be read. */
import { Badge } from '@/shared/components/ui/badge';
import type { ReferenceAnalysis, ReferenceViewportMeasurements } from '@/shared/types/research';
import { SafeExternalLink, Section } from './research-shared';

const DESCRIPTIONS = [
  ['Structure', 'structure'],
  ['Typography', 'typography'],
  ['Colour', 'colour'],
  ['Spacing', 'spacing'],
  ['Imagery', 'imagery'],
  ['Navigation', 'navigation'],
  ['Interactions', 'interactions'],
  ['Responsive', 'responsive'],
] as const;

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-2xs text-fg-subtle sm:w-28">{term}</dt>
      <dd className="min-w-0 text-xs break-words text-fg-muted">{children}</dd>
    </div>
  );
}

function Viewport({ title, data }: { title: string; data: ReferenceViewportMeasurements }) {
  const heading = data.headings[0];
  return (
    <div>
      <h5 className="mb-2 text-xs font-medium text-fg">
        {title} ({data.viewportWidth} x {data.viewportHeight})
      </h5>
      <dl className="space-y-1.5">
        <Row term="Page height">{data.pageHeight.toLocaleString()} px</Row>
        <Row term="Sections">{data.sections.join(', ') || 'None detected'}</Row>
        <Row term="Navigation">
          {data.nav.pattern}, {data.nav.items} items{data.nav.pinned ? ', pinned' : ''}
        </Row>
        <Row term="Largest heading">
          {heading ? `${String(heading.sizePx)} px, ${heading.fontKind}` : 'None detected'}
        </Row>
        <Row term="Body text">
          {data.body ? `${String(data.body.sizePx)} px, ${data.body.fontKind}` : 'Not measured'}
        </Row>
        <Row term="Spacing">
          {data.spacing.baseUnitPx === null
            ? 'No base unit found'
            : `${String(data.spacing.baseUnitPx)} px base unit`}
        </Row>
        <Row term="Images">
          {data.images.count}, covering {Math.round(data.images.areaShare * 100)}% of the page
        </Row>
        <Row term="Hero">
          {data.hero ? `${data.hero.layout}, ${String(data.hero.heightVh)} vh` : 'None detected'}
        </Row>
        <Row term="Columns">{data.maxColumns} at most</Row>
        <Row term="Motion">
          {data.motion.transitions} transitions, {data.motion.animations} animations
        </Row>
        <Row term="Overflow">{data.horizontalOverflow ? 'Scrolls sideways' : 'None'}</Row>
        <Row term="Palette">
          <span className="flex flex-wrap gap-2">
            {data.palette.map((swatch) => (
              <span key={`${swatch.role}-${swatch.hex}`} className="inline-flex items-center gap-1">
                {/^#[0-9a-f]{3,8}$/i.test(swatch.hex) && (
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-sm border border-line"
                    style={{ backgroundColor: swatch.hex }}
                  />
                )}
                <span className="font-mono text-2xs">
                  {swatch.hex} {swatch.role}
                </span>
              </span>
            ))}
          </span>
        </Row>
      </dl>
    </div>
  );
}

function Reference({ reference }: { reference: ReferenceAnalysis }) {
  const described = DESCRIPTIONS.filter(([, key]) => reference[key].trim() !== '');
  const { measurements } = reference;
  return (
    <li className="space-y-2 border-b border-line pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <SafeExternalLink href={reference.url}>{reference.url}</SafeExternalLink>
        <Badge variant={reference.accessible ? 'success' : 'warning'}>
          {reference.accessible ? 'Accessed' : 'Not accessible'}
        </Badge>
        {reference.origin && (
          <Badge>{reference.origin === 'user' ? 'You provided this' : 'Found in research'}</Badge>
        )}
      </div>
      {reference.limitation && (
        <p className="text-xs leading-relaxed text-warning">{reference.limitation}</p>
      )}
      {described.length > 0 && (
        <dl className="space-y-1.5">
          {described.map(([term, key]) => (
            <Row key={key} term={term}>
              {reference[key]}
            </Row>
          ))}
        </dl>
      )}
      {measurements ? (
        <details>
          <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
            Measured layout
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Viewport title="Desktop" data={measurements.desktop} />
            {measurements.mobile ? (
              <Viewport title="Phone" data={measurements.mobile} />
            ) : (
              <p className="text-xs text-fg-subtle">The phone-width render did not succeed.</p>
            )}
          </div>
        </details>
      ) : (
        reference.accessible && (
          <p className="text-2xs text-fg-subtle">No rendered measurements for this reference.</p>
        )
      )}
    </li>
  );
}

export function ResearchReferences({ references }: { references: ReferenceAnalysis[] }) {
  return (
    <Section
      title="Reference sites"
      description="Measured from real renders. A site that could not be read says so here."
    >
      {references.length === 0 ? (
        <p className="text-xs text-fg-subtle">No reference sites were analysed.</p>
      ) : (
        <ul className="space-y-4">
          {references.map((reference) => (
            <Reference key={reference.url} reference={reference} />
          ))}
        </ul>
      )}
    </Section>
  );
}
