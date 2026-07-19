import type { LabelHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-xs font-medium text-fg-muted', className)} {...props} />
  );
}
