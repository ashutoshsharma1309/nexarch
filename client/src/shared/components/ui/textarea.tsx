import { forwardRef } from 'react';
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
        'w-full resize-y rounded-md border border-line bg-inset px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg',
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
