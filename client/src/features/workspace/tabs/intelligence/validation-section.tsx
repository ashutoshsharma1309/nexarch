/**
 * Validation — what actually happened when the generated project ran.
 *
 * Everything on this screen is execution evidence: exit codes, ports,
 * status codes, test results. The gate banner leads with its *reason*,
 * because a verdict without its rule is a score asking to be trusted.
 * Raw command output stays behind an expansion — the evidence line is the
 * default view, the log tail is there when someone needs it.
 */
import { Check, ChevronRight, CircleDashed, PlayCircle, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';
import { EmptyState } from '@/shared/components/ui/empty-state';
import { Spinner } from '@/shared/components/ui/spinner';
import { useValidation } from '@/shared/hooks/use-engineering-review';
import { cn } from '@/shared/lib/cn';
import { useWorkspace } from '../../workspace-context';
import type { CheckStatus, ValidationGate, ValidationTestCase } from '@/shared/types/api';

const GATE_TONE: Record<ValidationGate, string> = {
  PASSED: 'border-success/40 text-success',
  PASSED_WITH_WARNINGS: 'border-warning/40 text-warning',
  FAILED: 'border-danger/40 text-danger',
  BLOCKED: 'border-warning/40 text-warning',
  VALIDATING: 'border-line text-fg-muted',
  NOT_VALIDATED: 'border-line text-fg-subtle',
};

function StatusIcon({ status }: { status: CheckStatus | ValidationTestCase['status'] }) {
  switch (status) {
    case 'PASS':
    case 'PASSED':
      return <Check className="size-3.5 text-success" />;
    case 'FAIL':
    case 'FAILED':
      return <X className="size-3.5 text-danger" />;
    case 'BLOCKED':
      return <CircleDashed className="size-3.5 text-warning" />;
    default:
      return <CircleDashed className="size-3.5 text-fg-subtle" />;
  }
}

function TestRow({ testCase }: { testCase: ValidationTestCase }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-2" data-test={testCase.name} data-status={testCase.status}>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="-mx-1 flex w-full items-center gap-2 rounded px-1 text-left hover:bg-raised"
      >
        <ChevronRight
          className={cn('size-3 shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')}
        />
        <StatusIcon status={testCase.status} />
        <span
          className={cn(
            'min-w-0 flex-1 text-xs',
            testCase.status === 'FAILED' ? 'text-fg' : 'text-fg-muted',
          )}
        >
          {testCase.name}
        </span>
        <Badge variant="neutral">{testCase.type}</Badge>
        {testCase.duration !== null && (
          <span className="font-mono text-2xs text-fg-subtle tabular-nums">
            {testCase.duration}ms
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 ml-5 space-y-2 border-l border-line pl-3">
          <ol className="space-y-0.5 text-2xs text-fg-muted">
            {testCase.steps.map((step) => (
              <li key={step.action}>
                <span className="font-mono">{step.action}</span>
                <span className="text-fg-subtle"> → {step.expect}</span>
              </li>
            ))}
          </ol>
          <p className="text-2xs text-fg-subtle">{testCase.expectedResult}</p>
          {testCase.evidence && (
            <p className="font-mono text-2xs break-all text-fg-muted">{testCase.evidence}</p>
          )}
          {testCase.error && <p className="text-2xs text-danger">{testCase.error}</p>}
        </div>
      )}
    </li>
  );
}

function CommandRow({
  command,
}: {
  command: NonNullable<ReturnType<typeof useValidation>['data']>['runtime'] extends infer R
    ? R extends { commands: (infer C)[] }
      ? C
      : never
    : never;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-1.5">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="-mx-1 flex w-full items-center gap-2 rounded px-1 text-left hover:bg-raised"
      >
        <StatusIcon status={command.status} />
        <span className="font-mono text-2xs text-fg-muted">
          {command.command} <span className="text-fg-subtle">({command.area})</span>
        </span>
        <span className="ml-auto font-mono text-2xs text-fg-subtle tabular-nums">
          exit {command.exitCode} · {(command.durationMs / 1000).toFixed(1)}s
        </span>
      </button>
      {open && command.outputTail && (
        <pre className="mt-1 ml-5 overflow-x-auto rounded border border-line bg-raised/40 p-2 text-2xs text-fg-subtle">
          {command.outputTail}
        </pre>
      )}
    </li>
  );
}

export function ValidationSection() {
  const workspace = useWorkspace();
  const projectId = workspace.project?.id;
  const validation = useValidation(projectId);

  if (validation.isPending) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-fg-muted">
        <Spinner className="size-3.5" /> Loading validation…
      </div>
    );
  }

  if (validation.isError) {
    return (
      <EmptyState
        icon={<PlayCircle className="size-4" />}
        title="No validation yet"
        description="Run the agents from the Build tab — the runtime, integration and test engineers execute the generated project as its final phase."
      />
    );
  }

  const { summary, runtime, integration, tests } = validation.data;

  return (
    <div className="space-y-4">
      {/* The gate, with its reason in the same breath. */}
      <Card>
        <CardContent className={cn('border-l-2 py-3', GATE_TONE[summary.gate])}>
          <p className="font-mono text-sm font-semibold">{summary.gate.replace(/_/g, ' ')}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{summary.gateReason}</p>
        </CardContent>
      </Card>

      {/* The rows Step 29 asks for: real status only. */}
      <Card>
        <ul className="divide-y divide-line" aria-label="Validation checks">
          {summary.rows.map((row) => (
            <li key={row.name} className="flex items-center gap-2 px-4 py-2">
              <StatusIcon status={row.status} />
              <span className="w-24 text-xs font-medium text-fg">{row.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-subtle">
                {row.detail}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {runtime && runtime.commands.length > 0 && (
        <Card>
          <p className="border-b border-line px-4 py-2 font-mono text-2xs text-fg-subtle">
            commands ·{' '}
            {runtime.processes
              .map((p) => `${p.kind} ${p.status}${p.port ? ` :${String(p.port)}` : ''}`)
              .join(' · ')}
          </p>
          <ul className="divide-y divide-line">
            {runtime.commands.map((command) => (
              <CommandRow key={`${command.area}-${command.command}`} command={command} />
            ))}
          </ul>
        </Card>
      )}

      {integration && (
        <Card>
          <p className="border-b border-line px-4 py-2 font-mono text-2xs text-fg-subtle">
            integration · {integration.endpoints.length} endpoints probed live
          </p>
          <ul className="divide-y divide-line">
            {integration.checks.map((check) => (
              <li key={check.name} className="px-4 py-2">
                <p className="flex items-center gap-2 text-xs text-fg-muted">
                  <StatusIcon status={check.status} />
                  {check.name}
                </p>
                <p className="mt-0.5 ml-5 font-mono text-2xs break-all text-fg-subtle">
                  {check.evidence}
                </p>
                {check.error && <p className="mt-0.5 ml-5 text-2xs text-danger">{check.error}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tests && tests.cases.length > 0 && (
        <Card>
          <p className="border-b border-line px-4 py-2 font-mono text-2xs text-fg-subtle">
            tests · {summary.tests.passed}/{summary.tests.total} passed · {summary.tests.failed}{' '}
            failed · {summary.tests.blocked} blocked
          </p>
          <ul className="divide-y divide-line" aria-label="Test cases">
            {tests.cases.map((testCase) => (
              <TestRow key={testCase.id} testCase={testCase} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
