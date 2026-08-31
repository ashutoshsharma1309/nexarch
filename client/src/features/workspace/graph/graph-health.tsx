/**
 * What Phase 3's validator found.
 *
 * Severity is preserved rather than flattened: an error means a traversal
 * through that edge is wrong, a warning means the shape is worth a look.
 * Collapsing both into "problems" would make a clean graph with two orphan
 * leaves look broken.
 *
 * Issues that name a node are clickable and focus it on the canvas — a
 * report you cannot act on from is just a list.
 */
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { Card, CardContent } from '@/shared/components/ui/card';
import { cn } from '@/shared/lib/cn';
import type { EngGraphValidationReport } from '@/shared/types/api';

export function GraphHealth({
  report,
  onFocusNode,
}: {
  report: EngGraphValidationReport;
  onFocusNode: (nodeId: string) => void;
}) {
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const warnings = report.issues.filter((issue) => issue.severity !== 'error');

  return (
    <Card className={errors.length > 0 ? 'border-danger/40' : undefined}>
      <CardContent className="py-3">
        <div className="flex items-start gap-2.5">
          {errors.length === 0 ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg">
              Graph health — {report.checkedNodes} nodes, {report.checkedEdges} relationships
              checked
            </p>
            <p className="mt-0.5 text-2xs text-fg-subtle">
              {errors.length === 0
                ? warnings.length === 0
                  ? 'No structural issues.'
                  : `No errors · ${warnings.length} worth a look`
                : `${errors.length} error${errors.length === 1 ? '' : 's'}`}
            </p>

            {report.issues.length > 0 && (
              <ul className="mt-2 space-y-1">
                {report.issues.slice(0, 8).map((issue, index) => {
                  const target = issue.nodeIds[0];
                  const content = (
                    <>
                      <span
                        className={cn(
                          'shrink-0 font-mono',
                          issue.severity === 'error' ? 'text-danger' : 'text-warning',
                        )}
                      >
                        {issue.kind}
                      </span>{' '}
                      <span className="text-fg-muted">{issue.message}</span>
                    </>
                  );
                  return (
                    <li key={index} className="text-2xs">
                      {target ? (
                        <button
                          type="button"
                          onClick={() => {
                            onFocusNode(target);
                          }}
                          className="rounded-sm text-left transition-colors hover:brightness-125 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                        >
                          {content}
                        </button>
                      ) : (
                        <span>{content}</span>
                      )}
                    </li>
                  );
                })}
                {report.issues.length > 8 && (
                  <li className="text-2xs text-fg-subtle">+{report.issues.length - 8} more</li>
                )}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
