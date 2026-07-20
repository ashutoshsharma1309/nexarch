/**
 * Emits overlay components: Dialog (native <dialog>, built-in focus trap
 * and Escape-to-close), DropdownMenu (click-outside + Escape + arrow-key
 * navigation), Tooltip (pure CSS, so :focus-visible triggers it exactly
 * like :hover — no JS state needed for keyboard accessibility), and the
 * Toaster that renders the toast store's queue.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

const dialog = `import { useEffect, useRef } from 'react';
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
 * Escape-to-close, and a backdrop for free — the accessibility primitives
 * a hand-rolled div-based modal has to reimplement.
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
        'w-full max-w-md rounded-lg border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-transparent',
        className,
      )}
    >
      <div className="flex items-start justify-between border-b border-line px-5 py-4">
        <div>
          <h2 id="dialog-title" className="text-sm font-medium text-fg">
            {title}
          </h2>
          {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="text-fg-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
`;

const confirmDialog = `import { Dialog } from './dialog';
import { Button } from './button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} description={description}>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
`;

const dropdownMenu = `import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
}

/** Click-outside, Escape, and up/down arrow-key navigation between items. */
export function DropdownMenu({ trigger, items, align = 'end' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const focusable = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const currentIndex = focusable.findIndex((el) => el === document.activeElement);
    const nextIndex =
      event.key === 'ArrowDown'
        ? (currentIndex + 1) % focusable.length
        : (currentIndex - 1 + focusable.length) % focusable.length;
    focusable[nextIndex]?.focus();
  };

  return (
    <div ref={containerRef} className="relative inline-block" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-20 mt-1 min-w-40 rounded-md border border-line bg-surface py-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="menuitem"
              type="button"
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className={cn(
                'block w-full px-3 py-1.5 text-left text-xs hover:bg-raised',
                item.destructive ? 'text-danger' : 'text-fg',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
`;

const tooltip = `import type { ReactNode } from 'react';

export interface TooltipProps {
  content: string;
  children: ReactNode;
}

/**
 * Pure CSS: the trigger is a focusable/hoverable group, the bubble is shown
 * via group-hover *and* group-focus-visible, so keyboard users see it too
 * without any JS state.
 */
export function Tooltip({ content, children }: TooltipProps) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm border border-line bg-raised px-2 py-1 font-mono text-2xs text-fg opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
`;

const toaster = `import { useEffect } from 'react';
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

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const Icon = ICON_BY_VARIANT[toast.variant];

  useEffect(() => {
    const timer = setTimeout(() => {
      dismiss(toast.id);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, dismiss]);

  return (
    <li className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3.5 py-3 shadow-lg">
      <Icon className={cn('mt-0.5 size-4 shrink-0', COLOR_BY_VARIANT[toast.variant])} aria-hidden="true" />
      <p className="flex-1 text-xs text-fg">{toast.message}</p>
      <button
        type="button"
        onClick={() => {
          dismiss(toast.id);
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
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
    </ul>
  );
}
`;

export function emitUiOverlays(): GeneratedFile[] {
  return [
    file('src/shared/components/ui/dialog.tsx', 'typescriptreact', dialog),
    file('src/shared/components/ui/confirm-dialog.tsx', 'typescriptreact', confirmDialog),
    file('src/shared/components/ui/dropdown-menu.tsx', 'typescriptreact', dropdownMenu),
    file('src/shared/components/ui/tooltip.tsx', 'typescriptreact', tooltip),
    file('src/shared/components/ui/toaster.tsx', 'typescriptreact', toaster),
  ];
}
