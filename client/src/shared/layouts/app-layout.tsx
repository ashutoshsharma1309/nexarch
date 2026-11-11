import { Suspense } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';

import { NotificationBell } from '@/features/notifications/notification-bell';
import { CommandPalette } from '@/features/search/command-palette';
import { PageLoader } from '@/shared/components/loading-screen';
import { StatusIndicator } from '@/shared/components/status-indicator';
import { ThemeToggle } from '@/shared/components/theme-toggle';
import { Toaster } from '@/shared/components/ui/toaster';
import { cn } from '@/shared/lib/cn';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

/** Sidebar footer: live API status, activity tray, theme. */
function ShellUtilities() {
  return (
    <>
      <StatusIndicator />
      <div
        // Hidden in the phone drawer, where the app bar already has both. The
        // tray is built to hang from a top bar; in the sidebar footer it has
        // to open upward and to the right or it lands off-screen.
        className="hidden items-center gap-0.5 lg:flex [&_[role=menu]]:top-auto [&_[role=menu]]:right-auto [&_[role=menu]]:bottom-full [&_[role=menu]]:left-0 [&_[role=menu]]:mb-1"
      >
        <NotificationBell />
        <ThemeToggle />
      </div>
    </>
  );
}

/**
 * Application shell: one navigation rail and the page. Route content fades in
 * with a 4px rise, disabled for reduced-motion users.
 *
 * The content column is anchored left beside the rail and widens inside a
 * project: a file tree beside a code pane, or an eight-column schema table,
 * needs more than the measure that suits a settings form.
 */
export function AppLayout() {
  const { pathname } = useLocation();
  const reducedMotion = useReducedMotion();
  const wide = pathname.startsWith('/projects/');

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-fg focus:px-3 focus:py-1.5 focus:text-canvas"
      >
        Skip to content
      </a>
      <Sidebar utilities={<ShellUtilities />} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          <div
            className={cn(
              'w-full px-4 py-6 md:px-8 md:py-8 lg:px-10',
              wide ? 'max-w-[1560px]' : 'max-w-[1160px]',
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={pathname}
                initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
              >
                <Suspense fallback={<PageLoader />}>
                  <Outlet />
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
