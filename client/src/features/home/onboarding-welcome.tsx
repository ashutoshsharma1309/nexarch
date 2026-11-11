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
import { ArrowRight, PlayCircle, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { completeOnboarding } from '@/shared/services/auth.service';
import { useAuthStore } from '@/shared/store/auth.store';
import { toast } from '@/shared/store/toast.store';

const STEPS = [
  { n: 1, title: 'Create a project', body: 'A project holds one application end to end.' },
  { n: 2, title: 'Describe it', body: 'One prompt: the domain and its core features.' },
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
    <section
      aria-labelledby="onboarding-title"
      className="relative rounded-lg border border-line bg-surface p-4 md:p-5"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome"
        className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-sm text-fg-subtle transition-colors hover:bg-raised hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
      <h2 id="onboarding-title" className="text-base font-semibold tracking-tight text-fg">
        Your first run, in four steps
      </h2>

      <ol className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <li key={step.n} className="border-t border-line-strong/70 pt-2.5">
            <p className="type-ui font-medium text-fg">
              <span className="mr-1.5 font-mono text-fg-subtle">{step.n}</span>
              {step.title}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{step.body}</p>
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
          className="ml-1 text-xs text-fg-muted transition-colors hover:text-fg"
        >
          Skip
        </button>
      </div>
    </section>
  );
}
