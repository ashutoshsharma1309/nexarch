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
  forge: 'bg-ember font-medium text-on-ember hover:bg-ember-hover active:bg-ember',
  primary: 'bg-fg font-medium text-canvas hover:bg-fg/85',
  secondary:
    'border border-line-strong/70 bg-surface text-fg hover:border-line-strong hover:bg-raised',
  ghost: 'text-fg-muted hover:bg-raised hover:text-fg',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:border-danger',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-sm px-2.5 text-xs pointer-coarse:h-9',
  md: 'h-8 gap-2 rounded-md px-3 type-ui pointer-coarse:h-10',
  lg: 'h-10 gap-2 rounded-md px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      data-variant={variant}
      disabled={loading || disabled}
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
