import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, FolderGit2, Layers, Package, Sparkles } from 'lucide-react';

import { useWorkspaceHistory } from '@/shared/hooks/use-workspace';
import { cn } from '@/shared/lib/cn';
import { formatRelativeTime } from '@/shared/lib/format';
import type { ActivityEventType } from '@/shared/types/api';

const ICON_BY_TYPE: Partial<Record<ActivityEventType, typeof FolderGit2>> = {
  'generation.logged': Layers,
  'export.completed': Package,
  'documentation.generated': Sparkles,
};

function iconFor(type: ActivityEventType): typeof FolderGit2 {
  return ICON_BY_TYPE[type] ?? FolderGit2;
}

/**
 * Reads the workspace activity feed (`GET /history`) rather than keeping a
 * parallel client-only notification store — the same events the Logs page
 * shows, surfaced here as a live tray. Covers the spec's notification
 * categories: generation runs, exports, and project lifecycle events; a
 * `security.warning`-shaped entry would render with the same shield icon
 * once the Security Dashboard starts logging into this feed.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const history = useWorkspaceHistory({ limit: 8 });
  const activity = history.data?.activity ?? [];
  const latest = activity[0];
  const hasUnread = latest !== undefined && (!lastSeenAt || latest.createdAt > lastSeenAt);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
          if (latest) setLastSeenAt(latest.createdAt);
        }}
        className="relative flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg"
      >
        <Bell className="size-4" />
        {hasUnread && (
          <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-ember" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 w-80 rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          <p className="px-3.5 py-2 text-xs font-medium text-fg">Activity</p>
          {activity.length === 0 ? (
            <p className="px-3.5 py-4 text-center text-xs text-fg-subtle">Nothing yet</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {activity.map((entry) => {
                const Icon = iconFor(entry.type);
                return (
                  <li
                    key={entry.id}
                    className="flex items-start gap-2.5 border-t border-line px-3.5 py-2.5"
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-fg">{entry.message}</p>
                      <p className="mt-0.5 font-mono text-2xs text-fg-subtle">
                        {formatRelativeTime(entry.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void navigate('/logs');
            }}
            className={cn(
              'block w-full border-t border-line px-3.5 py-2 text-left text-xs text-fg-muted hover:bg-raised hover:text-fg',
            )}
          >
            View all activity
          </button>
        </div>
      )}
    </div>
  );
}
