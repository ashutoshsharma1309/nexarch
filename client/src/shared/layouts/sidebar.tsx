/**
 * The one navigation in the product.
 *
 * Four destinations at the top; inside a project the same column continues
 * with that project's sections. A separate top bar and a thirteen-tab strip
 * would spend two rows on navigation and hide most of the sections on a laptop,
 * so there is one rail and the content gets the rest of the window.
 *
 * Which project comes from the URL rather than from data, so the rail renders
 * the moment the route does, and needs no project loaded to be correct.
 */
import { Search, X } from 'lucide-react';
import { useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { NavLink, useMatch } from 'react-router-dom';

import { Logo } from '@/shared/components/logo';
import { Kbd } from '@/shared/components/ui/kbd';
import { cn } from '@/shared/lib/cn';
import { navigation } from '@/shared/nav-items';
import { useUiStore } from '@/shared/store/ui.store';
import { WORKSPACE_SECTION_GROUPS, workspaceSectionPath } from './workspace-sections';

interface RailLinkProps {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean | undefined;
  onNavigate?: (() => void) | undefined;
}

function RailLink({ to, label, icon: Icon, end, onNavigate }: RailLinkProps) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 type-ui transition-colors duration-100 pointer-coarse:h-10',
          isActive
            ? 'bg-raised font-medium text-fg before:absolute before:inset-y-1.5 before:-left-3 before:w-0.5 before:rounded-r-sm before:bg-accent'
            : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
        )
      }
    >
      <Icon className="size-4 shrink-0 text-fg-subtle group-hover:text-fg-muted group-aria-[current=page]:text-accent" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function RailContents({ onNavigate }: { onNavigate?: () => void }) {
  const projectMatch = useMatch('/projects/:projectId/*');
  const projectId = projectMatch?.params.projectId;

  return (
    <div className="flex-1 overflow-y-auto px-3 pb-3">
      <nav className="flex flex-col gap-0.5" aria-label="Primary">
        {navigation.map((item) => (
          <RailLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            end={item.end}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {projectId && (
        <nav aria-label="Project sections" className="mt-4 border-t border-line pt-3">
          {WORKSPACE_SECTION_GROUPS.map((group) => (
            <div key={group.label} className="mb-3 last:mb-0">
              <p className="mb-1 px-2.5 text-2xs font-medium text-fg-subtle">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {group.sections.map((section) => (
                  <RailLink
                    key={section.slug}
                    to={workspaceSectionPath(projectId, section.slug)}
                    label={section.label}
                    icon={section.icon}
                    end={section.slug === ''}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}

function SearchButton() {
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  return (
    <div className="px-3 pb-3">
      <button
        type="button"
        onClick={() => {
          setCommandPaletteOpen(true);
        }}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-inset px-2.5 text-xs text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span className="flex-1 text-left">Search</span>
        <Kbd>⌘K</Kbd>
      </button>
    </div>
  );
}

function RailFooter({ utilities }: { utilities?: ReactNode }) {
  return (
    <div className="border-t border-line px-3 py-2.5">
      {utilities && <div className="mb-2 flex items-center justify-between gap-1">{utilities}</div>}
      <a
        href="https://www.linkedin.com/in/ashutoshsharma1309/"
        target="_blank"
        rel="noreferrer"
        className="block px-1 text-2xs text-fg-subtle transition-colors hover:text-fg-muted"
      >
        Made by Ashutosh Sharma
      </a>
    </div>
  );
}

export function Sidebar({ utilities }: { utilities?: ReactNode }) {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const close = (): void => {
    setMobileNavOpen(false);
  };

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileNavOpen, setMobileNavOpen]);

  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-13 items-center px-5">
          <Logo />
        </div>
        <SearchButton />
        <RailContents />
        <RailFooter utilities={utilities} />
      </aside>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={-1}
            className="absolute inset-0 bg-canvas/75"
            onClick={close}
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-overlay">
            <div className="flex h-13 items-center justify-between pr-3 pl-5">
              <Logo />
              <button
                type="button"
                aria-label="Close navigation"
                // The drawer is modal, so focus has to move into it.
                autoFocus
                className="flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg"
                onClick={close}
              >
                <X className="size-4" />
              </button>
            </div>
            <RailContents onNavigate={close} />
            <RailFooter utilities={utilities} />
          </aside>
        </div>
      )}
    </>
  );
}
