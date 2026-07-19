const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** Format an ISO timestamp for display: "Jul 18, 2026". */
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}
