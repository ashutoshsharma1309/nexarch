/**
 * The scaffolding every suite here was already writing for itself.
 *
 * Six test files had grown their own copy of "a QueryClient that does not
 * retry, wrapped round the thing under test", and they had quietly drifted:
 * some set `retry: false` only for queries, so a mutation under test silently
 * retried three times and a test asserting "the service was called once" was
 * asserting nothing. One definition, used by all of them, is the fix.
 *
 * Retries are off for both queries and mutations on purpose. A test about a
 * failure wants the failure, not two more attempts at it, and under fake
 * timers the retry backoff never elapses at all — which is how a failing
 * query test becomes a five-second timeout instead of an assertion.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export interface ProviderOptions {
  /**
   * Wrap in a MemoryRouter too. Off by default: a component that needs no
   * router should fail loudly if it starts reaching for one.
   */
  router?: boolean;
  /** Share a client across renders, or to spy on its invalidations. */
  client?: QueryClient;
}

/** The provider tree as a `renderHook` wrapper. */
export function wrapperFor(
  client: QueryClient,
  options: { router?: boolean } = {},
): (props: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {options.router === true ? <MemoryRouter>{children}</MemoryRouter> : children}
      </QueryClientProvider>
    );
  };
}

/**
 * Render inside the providers, and hand back the client that was used — the
 * tests that matter most here assert on cache invalidation, which needs the
 * client the component actually talked to.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: ProviderOptions = {},
): RenderResult & { client: QueryClient } {
  const client = options.client ?? createTestQueryClient();
  const Wrapper = wrapperFor(client, {
    ...(options.router === undefined ? {} : { router: options.router }),
  });
  return { ...render(<Wrapper>{ui}</Wrapper>), client };
}

/**
 * A promise the test settles itself.
 *
 * For the window a request is open: the interesting failures in this client
 * happen while something is in flight — a component unmounting mid-request,
 * a second click arriving before the first answer — and those are only
 * reachable if the test, not the mock, decides when the answer arrives.
 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
