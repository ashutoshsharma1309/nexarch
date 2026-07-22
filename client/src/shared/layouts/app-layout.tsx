import { Suspense } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';

import { CommandPalette } from '@/features/search/command-palette';
import { PageLoader } from '@/shared/components/loading-screen';
import { Toaster } from '@/shared/components/ui/toaster';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

/**
 * Application shell: fixed sidebar, top bar, scrollable content column.
 * Route content fades in with a 4px rise — one orchestrated moment per
 * navigation, disabled entirely for reduced-motion users.
 */
export function AppLayout() {
  const { pathname } = useLocation();
  const reducedMotion = useReducedMotion();

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={pathname}
                initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
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
