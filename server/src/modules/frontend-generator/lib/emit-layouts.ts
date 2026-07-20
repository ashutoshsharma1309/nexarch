/**
 * Emits the application shell: a responsive Sidebar (static rail ≥lg, a
 * mobile drawer below it) and TopBar built from the generated navigation,
 * DashboardLayout, AuthLayout (centered card, no chrome), SettingsLayout
 * (vertical tabs), FullWidthLayout (for wide tables), Breadcrumb wiring,
 * and ProtectedRoute (redirects unauthenticated visitors to /login).
 */
import type { PageModel } from './project-model.js';
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

function sidebar(pages: PageModel[]): string {
  const icons = [...new Set(pages.map((p) => p.icon))].sort();
  const iconImports = ['LayoutDashboard', 'Settings', 'X', ...icons].filter(
    (name, index, all) => all.indexOf(name) === index,
  );

  const navEntries = pages
    .map((p) => `  { to: '${p.route}', label: '${p.navLabel}', icon: ${p.icon} },`)
    .join('\n');

  return `import { ${iconImports.join(', ')} } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { ComponentType } from 'react';

import { Logo } from '@/shared/components/logo';
import { cn } from '@/shared/lib/cn';
import { useUiStore } from '@/shared/store/ui.store';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

const navigation: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
${navEntries}
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Primary">
      {navigation.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end ?? false}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] transition-colors duration-100',
              isActive ? 'bg-raised font-medium text-fg' : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
            )
          }
        >
          <item.icon className="size-4 shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <>
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center px-5">
          <Logo />
        </div>
        <NavItems />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-canvas/70"
            onClick={() => {
              setMobileNavOpen(false);
            }}
          />
          <aside className="relative flex h-full w-64 flex-col border-r border-line bg-surface">
            <div className="flex h-14 items-center justify-between px-5">
              <Logo />
              <button
                type="button"
                aria-label="Close navigation"
                className="text-fg-muted hover:text-fg"
                onClick={() => {
                  setMobileNavOpen(false);
                }}
              >
                <X className="size-4" />
              </button>
            </div>
            <NavItems
              onNavigate={() => {
                setMobileNavOpen(false);
              }}
            />
          </aside>
        </div>
      )}
    </>
  );
}
`;
}

const uiStore = `import { create } from 'zustand';

interface UiState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

/** Ephemeral UI state (not persisted) — the mobile nav drawer. */
export const useUiStore = create<UiState>()((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => {
    set({ mobileNavOpen: open });
  },
}));
`;

const logo = `export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-5">
        <rect width="32" height="32" rx="7" className="fill-fg" />
        <path d="M9 9h14v3.5h-9.5V15H21v3.5h-7.5V23H9V9Z" className="fill-canvas" />
      </svg>
      <span className="font-mono text-[0.8125rem] font-semibold tracking-tight text-fg">console</span>
    </span>
  );
}
`;

const topBar = `import { Menu, Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { Avatar } from '@/shared/components/ui/avatar';
import { Button } from '@/shared/components/ui/button';
import { DropdownMenu } from '@/shared/components/ui/dropdown-menu';
import { useAuthStore } from '@/shared/store/auth.store';
import { useThemeStore } from '@/shared/store/theme.store';
import { useUiStore } from '@/shared/store/ui.store';

function locationLabel(pathname: string): string {
  const segment = pathname.split('/')[1];
  return segment === undefined || segment === '' ? 'dashboard' : segment;
}

export function TopBar() {
  const { pathname } = useLocation();
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

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
          app<span className="mx-1 text-line-strong">/</span>
          <span className="text-fg-muted">{locationLabel(pathname)}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Button>
        {user && (
          <DropdownMenu
            trigger={<Avatar name={user.name} />}
            items={[{ label: 'Sign out', onSelect: logout, destructive: true }]}
          />
        )}
      </div>
    </header>
  );
}
`;

const appLayout = `import { Suspense } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';

import { PageLoader } from '@/shared/components/loading-screen';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

/** Dashboard shell: sidebar + top bar + a route fade/rise on navigation,
 * skipped entirely for users who prefer reduced motion. */
export function AppLayout() {
  const { pathname } = useLocation();
  const reducedMotion = useReducedMotion();

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
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
    </div>
  );
}
`;

const fullWidthLayout = `import type { ReactNode } from 'react';

/** No max-width container — for wide tables that need the full viewport. */
export function FullWidthLayout({ children }: { children: ReactNode }) {
  return <div className="w-full px-4 md:px-8">{children}</div>;
}
`;

const authLayout = `import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

import { Logo } from '@/shared/components/logo';
import { PageLoader } from '@/shared/components/loading-screen';

/** Centered card, no sidebar/topbar — for /login and /register. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
`;

const settingsLayout = `import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export interface SettingsTab {
  key: string;
  label: string;
}

export interface SettingsLayoutProps {
  tabs: SettingsTab[];
  active: string;
  onChange: (key: string) => void;
  children: ReactNode;
}

/** Vertical tab navigation beside a content panel — the Settings page shell. */
export function SettingsLayout({ tabs, active, onChange, children }: SettingsLayoutProps) {
  return (
    <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:flex-col">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              onChange(tab.key);
            }}
            aria-current={active === tab.key ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-left text-[0.8125rem] transition-colors',
              active === tab.key ? 'bg-raised font-medium text-fg' : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}
`;

const loadingScreen = `import { Spinner } from './ui/spinner';

export function LoadingScreen() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-canvas">
      <Spinner className="size-6" />
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading page">
      <Spinner />
    </div>
  );
}
`;

const pageHeader = `import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-[0.8125rem] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
`;

const protectedRoute = `import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/shared/store/auth.store';

/** Redirects unauthenticated visitors to /login, preserving where they came from. */
export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
`;

export function emitLayouts(pages: PageModel[], authEnabled: boolean): GeneratedFile[] {
  const files: GeneratedFile[] = [
    file('src/shared/layouts/sidebar.tsx', 'typescriptreact', sidebar(pages)),
    file('src/shared/store/ui.store.ts', 'typescript', uiStore),
    file('src/shared/components/logo.tsx', 'typescriptreact', logo),
    file('src/shared/layouts/top-bar.tsx', 'typescriptreact', topBar),
    file('src/shared/layouts/app-layout.tsx', 'typescriptreact', appLayout),
    file('src/shared/layouts/full-width-layout.tsx', 'typescriptreact', fullWidthLayout),
    file('src/shared/layouts/settings-layout.tsx', 'typescriptreact', settingsLayout),
    file('src/shared/components/loading-screen.tsx', 'typescriptreact', loadingScreen),
    file('src/shared/components/page-header.tsx', 'typescriptreact', pageHeader),
  ];

  if (authEnabled) {
    files.push(
      file('src/shared/layouts/auth-layout.tsx', 'typescriptreact', authLayout),
      file('src/shared/layouts/protected-route.tsx', 'typescriptreact', protectedRoute),
    );
  }

  return files;
}
