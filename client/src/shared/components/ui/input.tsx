import { forwardRef } from 'react';
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
        'h-8 w-full rounded-md border border-line bg-inset px-2.5 text-[0.8125rem] text-fg',
        'placeholder:text-fg-subtle',
        'transition-colors duration-100 hover:border-line-strong',
        'focus:border-accent focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-danger focus:border-danger',
        className,
      )}
      {...props}
    />
  );
});
