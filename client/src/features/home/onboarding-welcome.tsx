/**
 * First-run welcome (Steps 1–2).
 *
 * Shown once, to a user whose `onboardedAt` is still null: the four steps
 * of a NexArch run stated plainly, and the two ways to take the first one —
 * describe your own application, or open a ready-made demo. It never
 * explains the agent mesh or the graph; it explains what the user does.
 *
 * Completion is stored server-side, so it does not reappear on the next
 * device or after clearing the browser. Any of the three exits — create,
 * demo, or dismiss — marks it done; the card is an invitation, not a gate,
 * so "Skip" is a first-class choice, not hidden.
 */
import { ArrowRight, PlayCircle, Sparkles, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { completeOnboarding } from '@/shared/services/auth.service';
import { useAuthStore } from '@/shared/store/auth.store';
import { toast } from '@/shared/store/toast.store';

const STEPS = [
  { n: 1, title: 'Create a project', body: 'A project holds one application end to end.' },
  { n: 2, title: 'Describe it', body: 'One prompt — the domain and its core features.' },
  { n: 3, title: 'Build', body: 'NexArch plans, generates, reviews and hardens it.' },
  { n: 4, title: 'Explore', body: 'Read the architecture, code, findings and preview.' },
];

interface OnboardingWelcomeProps {
  onCreate: () => void;
  onDemo: () => void;
  demoLoading?: boolean;
}

export function OnboardingWelcome({
  onCreate,
  onDemo,
  demoLoading = false,
}: OnboardingWelcomeProps) {
  const setUser = useAuthStore((state) => state.setUser);

  // Fire-and-forget: the card is dismissed optimistically, and a failed
  // write just means the user sees it once more — never a blocked screen.
  const markDone = (): void => {
    void completeOnboarding()
      .then((user) => {
        setUser(user);
      })
      .catch(() => {
        toast('Could not save your onboarding state', 'error');
      });
  };

  const dismiss = (): void => {
    markDone();
  };

  const create = (): void => {
    markDone();
    onCreate();
  };

  const demo = (): void => {
    markDone();
    onDemo();
  };

  return (
    <Card className="relative overflow-hidden border-ember/30">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome"
        className="absolute top-3 right-3 rounded-sm p-1 text-fg-subtle transition-colors hover:bg-raised hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
      <CardContent className="py-6">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-ember-soft text-ember">
            <Sparkles className="size-4" />
          </span>
          <h2 className="text-sm font-medium text-fg">Welcome to NexArch</h2>
        </div>
        <p className="mt-2 max-w-2xl text-xs text-fg-muted">
          You describe an application in plain language. NexArch turns it into a real, reviewed,
          running codebase — here is the shape of a run:
        </p>

        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.n} className="rounded-md border border-line bg-raised/50 p-3">
              <div className="flex size-5 items-center justify-center rounded-full bg-inset font-mono text-2xs text-fg-muted">
                {step.n}
              </div>
              <p className="mt-2 text-xs font-medium text-fg">{step.title}</p>
              <p className="mt-0.5 text-2xs text-fg-muted">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="forge" icon={<ArrowRight className="size-3.5" />} onClick={create}>
            Create your first project
          </Button>
          <Button
            variant="secondary"
            icon={<PlayCircle className="size-3.5" />}
            onClick={demo}
            loading={demoLoading}
          >
            Explore a demo instead
          </Button>
          <button
            type="button"
            onClick={dismiss}
            className="ml-1 text-xs text-fg-subtle transition-colors hover:text-fg"
          >
            Skip
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
