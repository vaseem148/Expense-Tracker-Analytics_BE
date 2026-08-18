import { Injectable, Logger } from '@nestjs/common';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Tiny in-process TTL cache with tag-based invalidation.
 * Analytics queries are expensive and read-heavy; a per-user tag lets any
 * write to a user's ledger drop exactly that user's cached aggregates.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly store = new Map<string, Entry<unknown>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = 60_000): T {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  async wrap<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    return this.set(key, value, ttlMs);
  }

  /** Drop every key whose name starts with the prefix (used as a tag). */
  invalidate(prefix: string): number {
    let n = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        n++;
      }
    }
    if (n) this.logger.debug(`invalidated ${n} key(s) for ${prefix}`);
    return n;
  }

  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Math.round((this.hits / total) * 1000) / 10 : 0,
    };
  }

  /** Evict expired entries so a long-lived process cannot grow unbounded. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) if (entry.expiresAt < now) this.store.delete(key);
  }
}
