import type { HTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

type BadgeVariant = 'neutral' | 'accent' | 'ember' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'border-line text-fg-muted',
  accent: 'border-accent/30 bg-accent-soft text-accent',
  ember: 'border-ember/30 bg-ember-soft text-ember',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
};

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-2xs font-medium',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
