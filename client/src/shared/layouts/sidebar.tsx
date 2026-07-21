import {
  Bot,
  Database,
  DraftingCompass,
  FolderGit2,
  GitBranch,
  Hammer,
  LayoutDashboard,
  Layers,
  Monitor,
  Network,
  Server,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
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

/**
 * Navigation mirrors the product's mental model: overview → forge (the
 * verb) → what the forge produced (projects, generations) → settings.
 */
const navigation: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/forge', label: 'Forge', icon: Hammer },
  { to: '/architecture', label: 'Architecture', icon: DraftingCompass },
  { to: '/database', label: 'Database', icon: Database },
  { to: '/api', label: 'API Contract', icon: Network },
  { to: '/backend', label: 'Backend', icon: Server },
  { to: '/frontend', label: 'Frontend', icon: Monitor },
  { to: '/security', label: 'Security', icon: ShieldCheck },
  { to: '/dependency-graph', label: 'Dependency Graph', icon: GitBranch },
  { to: '/ai-operations', label: 'AI Operations', icon: Bot },
  { to: '/projects', label: 'Projects', icon: FolderGit2 },
  { to: '/generations', label: 'Generations', icon: Layers },
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
              isActive
                ? 'bg-raised font-medium text-fg'
                : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
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

function SidebarFooter() {
  return (
    <div className="border-t border-line px-5 py-3">
      <p className="font-mono text-2xs text-fg-subtle">phase 9 · ai orchestrator</p>
    </div>
  );
}

export function Sidebar() {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <>
      {/* Static rail ≥ lg */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center px-5">
          <Logo />
        </div>
        <NavItems />
        <SidebarFooter />
      </aside>

      {/* Drawer < lg */}
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
            <SidebarFooter />
          </aside>
        </div>
      )}
    </>
  );
}
