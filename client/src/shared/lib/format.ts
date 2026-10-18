const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** Format an ISO timestamp for display: "Jul 18, 2026". */
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

/** Format an ISO timestamp relative to now: "3 minutes ago", "just now". */
export function formatRelativeTime(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return relativeFormatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return relativeFormatter.format(Math.round(seconds / 60), 'minute');
}

/**
 * Format a byte count for a person: "812 KB", "3.4 MB".
 *
 * Decimal units, because that is what an image exporter and a file manager
 * both report — showing 3.2 MiB next to a tool that said 3.4 MB reads as a
 * disagreement about the file rather than about the unit.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
}
