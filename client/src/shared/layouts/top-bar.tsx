import { Menu, Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { NotificationBell } from '@/features/notifications/notification-bell';
import { StatusIndicator } from '@/shared/components/status-indicator';
import { ThemeToggle } from '@/shared/components/theme-toggle';
import { Button } from '@/shared/components/ui/button';
import { Kbd } from '@/shared/components/ui/kbd';
import { useUiStore } from '@/shared/store/ui.store';

/**
 * The mono path in the top bar. Inside a project it names the section
 * rather than repeating the project id, which is neither readable nor
 * something anyone needs to see — the breadcrumbs below name the project.
 */
function locationLabel(pathname: string): string {
  const [, first, , third] = pathname.split('/');
  if (first === 'projects') return third ? `projects/${third}` : 'projects';
  return first === undefined || first === '' ? 'home' : first;
}

export function TopBar() {
  const { pathname } = useLocation();
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-canvas px-4 md:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={() => {
            setMobileNavOpen(true);
          }}
        >
          <Menu className="size-4" />
        </Button>
        <p className="font-mono text-xs text-fg-subtle">
          console<span className="mx-1 text-line-strong">/</span>
          <span className="text-fg-muted">{locationLabel(pathname)}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setCommandPaletteOpen(true);
          }}
          className="hidden h-8 items-center gap-2 rounded-md border border-line bg-inset px-2.5 text-xs text-fg-subtle hover:border-line-strong hover:text-fg-muted sm:flex"
        >
          <Search className="size-3.5" />
          Search
          <Kbd>⌘K</Kbd>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden"
          aria-label="Search"
          onClick={() => {
            setCommandPaletteOpen(true);
          }}
        >
          <Search className="size-4" />
        </Button>
        <NotificationBell />
        <StatusIndicator />
        <ThemeToggle />
      </div>
    </header>
  );
}
