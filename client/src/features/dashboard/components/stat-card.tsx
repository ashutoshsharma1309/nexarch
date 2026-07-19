import { Card, CardContent } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';

export interface StatCardProps {
  label: string;
  value: string;
  /** Secondary line under the value. */
  hint: string;
  loading?: boolean;
}

export function StatCard({ label, value, hint, loading = false }: StatCardProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-16" />
        ) : (
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg tabular-nums">
            {value}
          </p>
        )}
        <p className="mt-1 text-xs text-fg-muted">{hint}</p>
      </CardContent>
    </Card>
  );
}
