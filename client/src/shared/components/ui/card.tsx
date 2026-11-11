import type { HTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

/**
 * Surfaces are separated by a hairline and one background step, never by drop
 * shadows. Reach for a Card when the group is a thing in its own right; a
 * section heading and a divider are usually enough.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-4 pt-4 md:px-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-sm font-semibold tracking-tight text-fg', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs leading-relaxed text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4 md:px-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-line px-4 py-3 md:px-5', className)}
      {...props}
    />
  );
}
