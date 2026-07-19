import { Loader2 } from 'lucide-react';

import { cn } from '@/shared/lib/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 aria-hidden="true" className={cn('size-4 animate-spin text-fg-muted', className)} />
  );
}
