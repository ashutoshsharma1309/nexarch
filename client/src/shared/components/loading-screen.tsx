import { LogoMark } from './logo';
import { Spinner } from './ui/spinner';

/** Full-viewport loader for app bootstrap. */
export function LoadingScreen() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-canvas">
      <LogoMark className="size-8" />
      <Spinner />
    </div>
  );
}

/** In-layout loader used as the Suspense fallback for lazy routes. */
export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading page">
      <Spinner />
    </div>
  );
}
