import { FolderGit2, LayoutDashboard, Settings } from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

/**
 * Three destinations.
 *
 * This list used to hold twenty-one — one per internal module — which
 * described how NexArch is built rather than what a user does with it.
 * Architecture, Database, Code, Security and the rest are not gone; they
 * moved inside the project they belong to, because none of them means
 * anything except in the context of some project.
 *
 * Shared between the sidebar and the command palette so both stay in sync.
 */
export const navigation: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderGit2 },
  { to: '/settings', label: 'Settings', icon: Settings },
];
