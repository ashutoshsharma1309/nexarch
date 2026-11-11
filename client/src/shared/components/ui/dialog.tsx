import { useEffect, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/shared/lib/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Built on the native <dialog> element: showModal() gives us a focus trap,
 * Escape-to-close, and a backdrop for free — the accessibility primitives a
 * hand-rolled div-based modal would have to reimplement. Same design as the
 * Dialog every generated project ships (Phase 6's `emit-ui-overlays.ts`),
 * kept in sync so the console and the apps it builds share one pattern.
 */
export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target === ref.current) onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="dialog-title"
      className={cn(
        // `m-auto`: Tailwind's reset zeroes the UA margin that centres a modal.
        'm-auto w-full max-w-[calc(100vw-2rem)] rounded-lg border border-line-strong/70 bg-surface p-0 text-fg shadow-overlay backdrop:bg-canvas/75 sm:max-w-md',
        className,
      )}
    >
      <div className="flex items-start justify-between border-b border-line px-5 py-4">
        <div>
          <h2 id="dialog-title" className="text-base font-semibold tracking-tight text-fg">
            {title}
          </h2>
          {description && (
            <p className="mt-1 type-ui leading-relaxed text-fg-muted">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="-mt-0.5 -mr-1 ml-3 flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
