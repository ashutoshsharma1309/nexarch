/**
 * In-memory cache of search and extraction results.
 *
 * Search and extraction are metered, and a user retrying a build asks the same
 * questions again. Only successes are stored, so a provider outage is not
 * remembered as "no results".
 */
import type { ExtractedPage, SearchHit } from './search-providers.js';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

class TtlMap<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    // A Map iterates in insertion order, so the first key is the oldest.
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export class ResearchCache {
  readonly searches: TtlMap<SearchHit[]>;
  readonly pages: TtlMap<ExtractedPage>;

  constructor(
    ttlMs: number = DEFAULT_TTL_MS,
    maxEntries: number = DEFAULT_MAX_ENTRIES,
    now: () => number = Date.now,
  ) {
    this.searches = new TtlMap(ttlMs, maxEntries, now);
    this.pages = new TtlMap(ttlMs, maxEntries, now);
  }

  clear(): void {
    this.searches.clear();
    this.pages.clear();
  }
}

export const globalResearchCache = new ResearchCache();

/** Case, spacing and trailing punctuation do not make a different search. */
export function normalizeQuery(query: string): string {
  return query
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s?.!,;:]+$/, '')
    .trim();
}
