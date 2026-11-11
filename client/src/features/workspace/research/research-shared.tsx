/** Small pieces the research sections, and the execution sources list, have in common. */
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import type { ResearchConfidence, ResearchSource, RetrievalKind } from '@/shared/types/research';
import { hostOf, safeHttpUrl } from './research-links';

/** Anything that fails the check is shown as text: stored URLs came from the open web. */
export function SafeExternalLink({
  href,
  children,
  label,
}: {
  href: string;
  children: ReactNode;
  label?: string;
}) {
  const safe = safeHttpUrl(href);
  if (!safe) return <span className="break-words text-fg-muted">{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      {...(label === undefined ? {} : { 'aria-label': label })}
      className="inline-flex items-center gap-1 break-words text-accent underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
    </a>
  );
}

const CONFIDENCE_VARIANT = { high: 'success', medium: 'accent', low: 'warning' } as const;

export function ConfidenceBadge({ confidence }: { confidence: ResearchConfidence }) {
  return <Badge variant={CONFIDENCE_VARIANT[confidence]}>{confidence} confidence</Badge>;
}

const RETRIEVAL_LABEL: Record<RetrievalKind, string> = {
  'search-snippet': 'Search snippet',
  'extracted-page': 'Extracted page',
  unreachable: 'Unreachable',
};

const RETRIEVAL_VARIANT = {
  'search-snippet': 'neutral',
  'extracted-page': 'success',
  unreachable: 'warning',
} as const;

export function RetrievalBadge({ kind }: { kind: RetrievalKind }) {
  return <Badge variant={RETRIEVAL_VARIANT[kind]}>{RETRIEVAL_LABEL[kind]}</Badge>;
}

export function SourceLinks({ ids, sources }: { ids: string[]; sources: ResearchSource[] }) {
  if (ids.length === 0) {
    return <p className="text-2xs text-fg-subtle">No source recorded for this.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs" aria-label="Sources">
      {ids.map((id) => {
        const source = sources.find((candidate) => candidate.id === id);
        return (
          <li key={id}>
            {source ? (
              <SafeExternalLink
                href={source.url}
                label={`${source.title || hostOf(source.url)} (${RETRIEVAL_LABEL[source.retrievalKind]})`}
              >
                {hostOf(source.url)}
              </SafeExternalLink>
            ) : (
              <span className="text-fg-subtle">Source no longer in this report</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function PlainList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-fg-subtle">{empty}</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-fg-muted">
      {[...new Set(items)].map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
