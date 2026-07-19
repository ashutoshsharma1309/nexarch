import { useEffect } from 'react';

/** Set the tab title for the current page, restoring nothing on unmount —
 * every page sets its own, so restoration would only cause flicker. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · NexArch`;
  }, [title]);
}
