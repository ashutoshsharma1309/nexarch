/**
 * The router's error boundary.
 *
 * React Router routes a thrown render error or a failed loader to the
 * nearest `errorElement` instead of unmounting the whole tree to a blank
 * page. This is that element: it shows a recoverable message and the paths
 * back to safety, and it never renders the error's stack or message into
 * the page — a boundary that printed the internal error would be its own
 * small information leak (Step 23).
 */
import { AlertTriangle } from 'lucide-react';
import { Link, useRouteError } from 'react-router-dom';

export function RouteError() {
  // Read but do not render: the detail belongs in the console for a
  // developer, never on the screen for whoever hit the error.
  const error = useRouteError();
  // eslint-disable-next-line no-console -- a boundary logging to the dev console is correct; it never renders.
  if (error) console.error('Route error boundary caught:', error);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="size-8 text-warning" aria-hidden />
      <div>
        <h1 className="text-lg font-semibold text-fg">Something went wrong on this screen</h1>
        <p className="mt-1 max-w-md text-sm text-fg-muted">
          The rest of NexArch is unaffected. Reload this view, or head back to your projects.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          className="rounded border border-line px-3 py-1.5 text-xs text-fg-muted hover:border-line-strong hover:text-fg"
        >
          Reload
        </button>
        <Link
          to="/projects"
          className="rounded border border-line px-3 py-1.5 text-xs text-fg-muted hover:border-line-strong hover:text-fg"
        >
          Go to Projects
        </Link>
      </div>
    </div>
  );
}
