/**
 * Content-hashed response cache — identical (template, variables, model)
 * requests never hit a provider twice. In-memory only, matching the same
 * "most recent in this process" continuity model the Security Engine's
 * report cache and the Dependency Graph Engine's version history already
 * use; there's no persistence layer for platform-internal state anywhere
 * in this codebase.
 */
import { createHash } from 'node:crypto';

import type { CacheStats, ModelCallResult } from '../ai-orchestrator.types.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface StoredEntry {
  response: ModelCallResult;
  createdAt: number;
  hits: number;
}

export class CacheManager {
  private readonly store = new Map<string, StoredEntry>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  static key(promptId: string, model: string, text: string): string {
    return createHash('sha256')
      .update(promptId)
      .update('\0')
      .update(model)
      .update('\0')
      .update(text)
      .digest('hex');
  }

  get(key: string): ModelCallResult | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      this.misses += 1;
      return null;
    }
    entry.hits += 1;
    this.hits += 1;
    return entry.response;
  }

  set(key: string, response: ModelCallResult): void {
    this.store.set(key, { response, createdAt: Date.now(), hits: 0 });
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 10000) / 100 : 0,
    };
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

export const globalCache = new CacheManager();
