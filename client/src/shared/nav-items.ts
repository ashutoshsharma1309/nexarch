import {
  Bot,
  Database,
  DraftingCompass,
  FileText,
  FolderGit2,
  GitBranch,
  Hammer,
  LayoutDashboard,
  Layers,
  Monitor,
  Network,
  PackageOpen,
  Rocket,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

/**
 * Navigation mirrors the product's mental model: overview → forge (the
 * verb) → what the forge produced (projects, generations) → workspace
 * tooling (docs, exports, logs) → settings. Shared between the sidebar and
 * the command palette so both stay in sync with one list.
 */
export const navigation: NavItem[] = [
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
  { to: '/deployment', label: 'Deployment', icon: Rocket },
  { to: '/projects', label: 'Projects', icon: FolderGit2 },
  { to: '/generations', label: 'Generations', icon: Layers },
  { to: '/documentation', label: 'Documentation', icon: FileText },
  { to: '/exports', label: 'Exports', icon: PackageOpen },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
];
