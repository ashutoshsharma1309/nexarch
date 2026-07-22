import { useEffect, useRef, useState } from 'react';
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
