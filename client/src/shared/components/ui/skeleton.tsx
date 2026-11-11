import type { HTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

/** Loading placeholder sized by the caller: `<Skeleton className="h-4 w-32" />`. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-sm bg-raised motion-safe:animate-pulse', className)}
      {...props}
    />
  );
}
