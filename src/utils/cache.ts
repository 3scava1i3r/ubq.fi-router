/**
 * Simple in-memory cache with TTL
 * Used for caching sitemap/map generation results
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

const DEFAULT_TTL = 3600000 // 1 hour in milliseconds

/**
 * Get value from cache
 */
export function get<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null

  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }

  return entry.value as T
}

/**
 * Set value in cache with TTL
 */
export function set<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
}

/**
 * Clear all cached values
 */
export function clear(): void {
  cache.clear()
}

/**
 * Get cache statistics (for debugging)
 */
export function getStats(): { size: number; keys: string[] } {
  const now = Date.now()
  const validKeys: string[] = []

  for (const [key, entry] of cache.entries()) {
    if (now < entry.expiresAt) {
      validKeys.push(key)
    }
  }

  return {
    size: validKeys.length,
    keys: validKeys,
  }
}
