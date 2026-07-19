import { cn } from '@/shared/lib/cn';

/**
 * The NexArch mark: a squared arch — the oldest load-bearing structure —
 * with a single warm block beneath it: the application taking shape under
 * the architecture. The ember block is the only warm pixel in the chrome.
 * Inline SVG so it inherits theme colors and needs no asset pipeline.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-5', className)}>
      <rect width="32" height="32" rx="7" className="fill-fg" />
      <path d="M8 24V8h16v16h-4V12h-8v12H8Z" className="fill-canvas" />
      <rect x="14" y="16" width="4" height="4" className="fill-ember" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-mono text-[0.8125rem] font-semibold tracking-tight text-fg">
        nexarch
      </span>
    </span>
  );
}
