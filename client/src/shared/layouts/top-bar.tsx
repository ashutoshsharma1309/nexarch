import { Menu, Search } from 'lucide-react';

import { NotificationBell } from '@/features/notifications/notification-bell';
import { Logo } from '@/shared/components/logo';
import { ThemeToggle } from '@/shared/components/theme-toggle';
import { Button } from '@/shared/components/ui/button';
import { useUiStore } from '@/shared/store/ui.store';

/**
 * The app bar on screens too narrow for the sidebar. On desktop everything
 * here lives in the sidebar, so the bar is not rendered and the page gets the
 * full height of the window.
 */
export function TopBar() {
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-line bg-surface px-2 sm:px-3 lg:hidden">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open navigation"
          onClick={() => {
            setMobileNavOpen(true);
          }}
        >
          <Menu className="size-4" />
        </Button>
        <Logo />
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Search"
          onClick={() => {
            setCommandPaletteOpen(true);
          }}
        >
          <Search className="size-4" />
        </Button>
        <NotificationBell />
        <ThemeToggle />
      </div>
    </header>
  );
}
