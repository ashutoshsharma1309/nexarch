import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';
import { Spinner } from './spinner';

type ButtonVariant = 'forge' | 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Icon rendered before the label. */
  icon?: ReactNode;
}

/**
 * `forge` is the single warm action in the interface — reserved for
 * starting generation work. Everything else stays cool and quiet.
 */
const variantClasses: Record<ButtonVariant, string> = {
  forge: 'bg-ember text-[#0b0c0e] font-medium hover:bg-ember-hover active:bg-ember',
  primary: 'bg-fg text-canvas font-medium hover:opacity-90',
  secondary: 'border border-line bg-raised text-fg hover:border-line-strong hover:bg-inset',
  ghost: 'text-fg-muted hover:bg-raised hover:text-fg',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:border-danger',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-sm',
  md: 'h-8 px-3 text-[0.8125rem] gap-2 rounded-md',
  lg: 'h-10 px-4 text-sm gap-2 rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      data-variant={variant}
      disabled={loading || props.disabled}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap transition-colors duration-100 select-none',
        'disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
});
