import type { GeoCandidate } from '../types/UnifiedRecord'

const TTL_MS    = 30 * 24 * 60 * 60 * 1000  // 30 days — historical place data rarely changes
const KEY_PREFIX = 'geocache:v1:'

interface CacheEntry { ts: number; candidates: GeoCandidate[] }

export function getCached(toponym: string): GeoCandidate[] | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + toponym)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.ts > TTL_MS) {
      localStorage.removeItem(KEY_PREFIX + toponym)
      return null
    }
    return entry.candidates
  } catch {
    return null
  }
}

export function setCached(toponym: string, candidates: GeoCandidate[]): void {
  try {
    localStorage.setItem(KEY_PREFIX + toponym, JSON.stringify({ ts: Date.now(), candidates }))
  } catch {
    // localStorage quota exceeded — silently skip caching
  }
}
