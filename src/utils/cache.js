'use strict';

/**
 * Small in-memory TTL cache with a hard size cap (oldest entry evicted first).
 * Used to avoid repeated calls to geocoding, air-quality and LLM APIs for the
 * same inputs, which keeps latency and cost down.
 */
class TtlCache {
  /**
   * @param {{ ttlMs: number, maxEntries?: number, now?: () => number }} options
   *   ttlMs: entry lifetime; maxEntries: size cap; now: clock (injectable for tests)
   */
  constructor({ ttlMs, maxEntries = 500, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this.store = new Map();
  }

  /**
   * @param {string} key
   * @returns {any} the cached value, or undefined when missing or expired
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency so frequently used keys survive eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /**
   * Stores a value, evicting the least recently used entry when full.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
  }

  /**
   * Returns the cached value or computes, caches and returns it.
   * Concurrent callers for the same key share one in-flight promise;
   * failures are not cached.
   * @template T
   * @param {string} key
   * @param {() => T | Promise<T>} producer
   * @returns {Promise<T>}
   */
  async wrap(key, producer) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = Promise.resolve().then(producer);
    this.set(key, pending);
    try {
      const value = await pending;
      this.set(key, value);
      return value;
    } catch (error) {
      this.store.delete(key);
      throw error;
    }
  }

  /** Number of entries currently stored (including not-yet-evicted expired ones). */
  get size() {
    return this.store.size;
  }
}

module.exports = { TtlCache };
