/**
 * Emits the base UI kit: button, input, textarea, select, label, card,
 * badge, skeleton, spinner, avatar, empty-state, error-state. Plain
 * Tailwind, no headless-UI dependency — matches the platform's own proven
 * approach of a small hand-rolled kit over a component library.
 */
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

const button = `import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';
import { Spinner } from './spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
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
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap transition-colors duration-100',
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
`;

const spinner = `import { Loader2 } from 'lucide-react';

import { cn } from '@/shared/lib/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      aria-hidden="true"
      className={cn('size-4 animate-spin text-fg-muted', className)}
    />
  );
}
`;

const label = `import type { LabelHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-xs font-medium text-fg-muted', className)} {...props} />;
}
`;

const input = `import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-8 w-full rounded-md border border-line bg-inset px-2.5 text-[0.8125rem] text-fg placeholder:text-fg-subtle',
        'transition-colors duration-100 hover:border-line-strong focus:border-accent focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-danger focus:border-danger',
        className,
      )}
      {...props}
    />
  );
});
`;

const textarea = `import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full resize-y rounded-md border border-line bg-inset px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg placeholder:text-fg-subtle',
        'transition-colors duration-100 hover:border-line-strong focus:border-accent focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-danger focus:border-danger',
        className,
      )}
      {...props}
    />
  );
});
`;

const select = `import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid = false, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-8 w-full rounded-md border border-line bg-inset px-2.5 text-[0.8125rem] text-fg',
        'transition-colors duration-100 hover:border-line-strong focus:border-accent focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-danger focus:border-danger',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
`;

const card = `import type { HTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-5 pt-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-medium text-fg', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs leading-relaxed text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 border-t border-line px-5 py-3', className)} {...props} />;
}
`;

const badge = `import type { HTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'border-line text-fg-muted',
  accent: 'border-accent/30 bg-accent-soft text-accent',
  success: 'border-success/30 text-success',
  warning: 'border-warning/30 text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
};

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wide',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
`;

const avatar = `import { cn } from '@/shared/lib/cn';

export interface AvatarProps {
  name: string | null | undefined;
  className?: string;
}

function initialsOf(name: string | null | undefined): string {
  // An avatar is decoration. It must never be the reason a page fails to
  // render, so a missing name degrades to a placeholder instead of throwing.
  const parts = (name ?? '').trim().split(/\\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function Avatar({ name, className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name ?? 'Account'}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-2xs font-semibold text-accent',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
`;

const skeleton = `import type { HTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-raised', className)} {...props} />;
}
`;

const emptyState = `import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex size-10 items-center justify-center rounded-md border border-line bg-raised text-fg-subtle">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
`;

const errorState = `import { AlertTriangle } from 'lucide-react';

export interface ErrorStateProps {
  title?: string;
  message: string;
}

/** role="alert" so assistive tech announces the failure without user action. */
export function ErrorState({ title = 'Something went wrong', message }: ErrorStateProps) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 text-xs text-fg-muted">{message}</p>
      </div>
    </div>
  );
}
`;

export function emitUiPrimitives(): GeneratedFile[] {
  return [
    file('src/shared/components/ui/button.tsx', 'typescriptreact', button),
    file('src/shared/components/ui/spinner.tsx', 'typescriptreact', spinner),
    file('src/shared/components/ui/label.tsx', 'typescriptreact', label),
    file('src/shared/components/ui/input.tsx', 'typescriptreact', input),
    file('src/shared/components/ui/textarea.tsx', 'typescriptreact', textarea),
    file('src/shared/components/ui/select.tsx', 'typescriptreact', select),
    file('src/shared/components/ui/card.tsx', 'typescriptreact', card),
    file('src/shared/components/ui/badge.tsx', 'typescriptreact', badge),
    file('src/shared/components/ui/avatar.tsx', 'typescriptreact', avatar),
    file('src/shared/components/ui/skeleton.tsx', 'typescriptreact', skeleton),
    file('src/shared/components/ui/empty-state.tsx', 'typescriptreact', emptyState),
    file('src/shared/components/ui/error-state.tsx', 'typescriptreact', errorState),
  ];
}
