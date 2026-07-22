import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import { useCurrentArtifacts } from '@/shared/hooks/use-current-artifacts';
import { useProjects } from '@/shared/hooks/use-projects';
import { cn } from '@/shared/lib/cn';
import { navigation } from '@/shared/nav-items';
import { useUiStore } from '@/shared/store/ui.store';

interface Result {
  id: string;
  group: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

/**
 * Global search: always includes navigation and projects; additionally
 * surfaces API endpoints, frontend pages, and components from whatever the
 * pipeline currently has cached (`useCurrentArtifacts`) — the same
 * "search what's already loaded, don't fabricate a new index" scope every
 * other Phase 10 cross-cutting feature uses.
 */
export function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const projects = useProjects();
  const { artifacts } = useCurrentArtifacts();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, setOpen]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && node.open) node.close();
  }, [open]);

  const close = (): void => {
    setOpen(false);
  };

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (label: string): boolean =>
      needle === '' || label.toLowerCase().includes(needle);

    const list: Result[] = [];

    for (const item of navigation) {
      if (matches(item.label)) {
        list.push({
          id: `nav:${item.to}`,
          group: 'Go to',
          label: item.label,
          onSelect: () => {
            void navigate(item.to);
          },
        });
      }
    }

    for (const project of projects.data ?? []) {
      if (matches(project.name)) {
        list.push({
          id: `project:${project.id}`,
          group: 'Projects',
          label: project.name,
          hint: project.status,
          onSelect: () => {
            void navigate(`/projects/${project.id}`);
          },
        });
      }
    }

    for (const route of artifacts?.backend?.routes.slice(0, 200) ?? []) {
      const label = `${route.method} ${route.path}`;
      if (matches(label)) {
        list.push({
          id: `endpoint:${label}`,
          group: 'Endpoints',
          label,
          onSelect: () => {
            void navigate('/api');
          },
        });
      }
    }

    for (const page of artifacts?.frontend?.pages.slice(0, 200) ?? []) {
      if (matches(page.name)) {
        list.push({
          id: `page:${page.route}`,
          group: 'Frontend pages',
          label: page.name,
          hint: page.route,
          onSelect: () => {
            void navigate('/frontend');
          },
        });
      }
    }

    for (const component of artifacts?.frontend?.components.slice(0, 200) ?? []) {
      if (matches(component)) {
        list.push({
          id: `component:${component}`,
          group: 'Components',
          label: component,
          onSelect: () => {
            void navigate('/frontend');
          },
        });
      }
    }

    return list.slice(0, 40);
  }, [query, navigate, projects.data, artifacts]);

  const activate = (result: Result | undefined): void => {
    if (!result) return;
    result.onSelect();
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(results[activeIndex]);
    }
  };

  let lastGroup = '';

  return (
    <dialog
      ref={dialogRef}
      onClose={close}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      className="w-full max-w-lg rounded-lg border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-canvas/70"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-fg-subtle" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search projects, pages, endpoints, components…"
          aria-label="Global search"
          className="h-12 flex-1 bg-transparent text-[0.8125rem] text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <ul role="listbox" className="max-h-80 overflow-y-auto py-2">
        {results.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-fg-subtle">No matches</li>
        )}
        {results.map((result, index) => {
          const showGroup = result.group !== lastGroup;
          lastGroup = result.group;
          return (
            <div key={result.id}>
              {showGroup && (
                <p className="px-4 pt-2 pb-1 font-mono text-2xs tracking-widest text-fg-subtle uppercase">
                  {result.group}
                </p>
              )}
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    activate(result);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-4 py-1.5 text-left text-xs',
                    index === activeIndex ? 'bg-raised text-fg' : 'text-fg-muted',
                  )}
                >
                  <span className="truncate">{result.label}</span>
                  {result.hint && (
                    <span className="shrink-0 font-mono text-2xs text-fg-subtle">
                      {result.hint}
                    </span>
                  )}
                </button>
              </li>
            </div>
          );
        })}
      </ul>
    </dialog>
  );
}
