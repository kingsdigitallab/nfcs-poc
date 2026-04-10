/**
 * localStorage cache for LLDS DSpace items.
 *
 * LLDS has experienced multi-week outages. On any fetch failure (CORS, timeout,
 * 5xx, network error) we serve the last successful response from cache and mark
 * all records with _cached: true so the UI can surface that clearly.
 *
 * Cache is keyed by a version string so schema changes auto-invalidate it.
 */

const CACHE_KEY = 'idah_llds_items_v2'
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000  // refresh after 24 h if service is up

export interface DSpaceMetadata {
  key: string
  value: string
  language: string
}

export interface DSpaceItem {
  id: number
  handle: string
  metadata: DSpaceMetadata[]
  [key: string]: unknown
}

interface CacheEntry {
  ts: number
  items: DSpaceItem[]
}

export function loadCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CacheEntry) : null
  } catch {
    return null
  }
}

export function saveCache(items: DSpaceItem[]): void {
  try {
    const entry: CacheEntry = { ts: Date.now(), items }
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch (e) {
    // Storage quota exceeded or private-browsing restriction — not fatal
    console.warn('[LLDS cache] could not save:', e)
  }
}

export function isCacheStale(entry: CacheEntry): boolean {
  return Date.now() - entry.ts > CACHE_MAX_AGE_MS
}
