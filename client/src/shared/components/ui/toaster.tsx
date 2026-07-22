import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

import { cn } from '@/shared/lib/cn';
import { useToastStore } from '@/shared/store/toast.store';
import type { Toast } from '@/shared/store/toast.store';

const ICON_BY_VARIANT = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const;

const COLOR_BY_VARIANT = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-accent',
} as const;

function ToastItem({ toastItem }: { toastItem: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const Icon = ICON_BY_VARIANT[toastItem.variant];

  useEffect(() => {
    const timer = setTimeout(() => {
      dismiss(toastItem.id);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [toastItem.id, dismiss]);

  return (
    <li className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3.5 py-3 shadow-lg">
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', COLOR_BY_VARIANT[toastItem.variant])}
        aria-hidden="true"
      />
      <p className="flex-1 text-xs text-fg">{toastItem.message}</p>
      <button
        type="button"
        onClick={() => {
          dismiss(toastItem.id);
        }}
        aria-label="Dismiss notification"
        className="text-fg-subtle hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/** Fixed toast stack; aria-live announces new toasts without stealing focus. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <ul
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((toastItem) => (
        <div key={toastItem.id} className="pointer-events-auto">
          <ToastItem toastItem={toastItem} />
        </div>
      ))}
    </ul>
  );
}
