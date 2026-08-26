import type { ReactNode } from 'react';

import { Logo } from '@/shared/components/logo';
import { Card, CardContent } from '@/shared/components/ui/card';

/**
 * The signed-out shell. No sidebar, no top bar, no command palette —
 * nothing here is reachable without a session, so showing the console
 * chrome around a login form would only advertise doors that are locked.
 */
export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <Card>
          <div className="border-b border-line px-5 py-2.5">
            <p className="font-mono text-xs text-fg-subtle">
              <span className="text-ember">$</span> {eyebrow}
            </p>
          </div>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <h1 className="text-base font-medium text-fg">{title}</h1>
              <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
            </div>
            {children}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-fg-muted">{footer}</p>
      </div>
    </div>
  );
}
