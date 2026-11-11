import { cn } from '@/shared/lib/cn';

export type StatusTone = 'neutral' | 'ok' | 'busy' | 'warn' | 'bad';

const toneClasses: Record<StatusTone, string> = {
  neutral: 'bg-fg-subtle',
  ok: 'bg-success',
  busy: 'bg-ember motion-safe:animate-pulse',
  warn: 'bg-warning',
  bad: 'bg-danger',
};

/**
 * A status marker. Always sits next to a word: colour alone says nothing to a
 * colour-blind reader or a screen reader, so the dot is hidden from assistive
 * tech and the adjacent label carries the meaning.
 */
export function StatusDot({
  tone = 'neutral',
  className,
}: {
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-1.5 shrink-0 rounded-full', toneClasses[tone], className)}
    />
  );
}
