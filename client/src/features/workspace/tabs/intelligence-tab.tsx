/**
 * Intelligence: what NexArch knows about the project beyond its source.
 *
 * Its sections are real nested routes rather than local state, so the
 * Engineering Graph is linkable — `/intelligence/graph?view=database&node=…`
 * restores an exact view. That matters more here than elsewhere: a graph
 * view worth showing someone is a graph view worth being able to send.
 */
import { NavLink, Outlet } from 'react-router-dom';

import { cn } from '@/shared/lib/cn';
import { useWorkspace } from '../workspace-context';
import { BuildRequiredState } from './build-required-state';

const SECTIONS = [
  { to: '', label: 'Engineering Review', end: true },
  { to: 'validation', label: 'Validation' },
  { to: 'repairs', label: 'Self-Repair' },
  { to: 'security', label: 'Security' },
  { to: 'dependencies', label: 'Dependencies' },
  { to: 'graph', label: 'Engineering Graph' },
];

export function IntelligenceTab() {
  const workspace = useWorkspace();
  const base = `/projects/${workspace.project?.id ?? ''}/intelligence`;

  if (!workspace.latestRun) return <BuildRequiredState what="this project’s analysis" />;
  if (!workspace.artifacts) {
    return (
      <BuildRequiredState
        what="this project’s analysis"
        missing={workspace.artifactsMissing}
        loading={!workspace.artifactsMissing}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="-mx-1 flex gap-1 overflow-x-auto px-1"
        role="navigation"
        aria-label="Intelligence sections"
      >
        {SECTIONS.map((section) => (
          <NavLink
            key={section.label}
            to={section.to ? `${base}/${section.to}` : base}
            end={section.end ?? false}
            className={({ isActive }) =>
              cn(
                'shrink-0 rounded-md border px-2.5 py-1 text-xs whitespace-nowrap transition-colors',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                isActive
                  ? 'border-ember font-medium text-fg'
                  : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
              )
            }
          >
            {section.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
