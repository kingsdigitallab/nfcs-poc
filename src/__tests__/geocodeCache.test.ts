import { describe, it, expect, beforeEach } from 'vitest'
import type { GeoCandidate } from '../types/UnifiedRecord'

// jsdom provides localStorage — reset between tests
beforeEach(() => localStorage.clear())

function candidate(label: string): GeoCandidate {
  return { source: 'tgn', uri: 'http://example.com/1', label, lat: 51.5, lng: -0.1, score: 0.9 }
}

// Import after mocking so the module picks up the cleared store each test.
// Dynamic import inside each test ensures the same module instance is used.
async function load() {
  const mod = await import('../utils/geocodeCache')
  return { getCached: mod.getCached, setCached: mod.setCached }
}

describe('getCached / setCached', () => {
  it('returns null for a missing key', async () => {
    const { getCached } = await load()
    expect(getCached('london')).toBeNull()
  })

  it('returns stored candidates immediately after setCached', async () => {
    const { getCached, setCached } = await load()
    const data = [candidate('London')]
    setCached('london', data)
    const result = getCached('london')
    expect(result).toHaveLength(1)
    expect(result![0].label).toBe('London')
  })

  it('returns null after the TTL has expired', async () => {
    const { getCached, setCached } = await load()
    setCached('oxford', [candidate('Oxford')])

    // Manually corrupt the timestamp in localStorage to simulate expiry
    const key = 'geocache:v1:oxford'
    const entry = JSON.parse(localStorage.getItem(key)!) as { ts: number; candidates: GeoCandidate[] }
    entry.ts = Date.now() - (31 * 24 * 60 * 60 * 1000) // 31 days ago
    localStorage.setItem(key, JSON.stringify(entry))

    expect(getCached('oxford')).toBeNull()
    // Expired entry should be removed
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('returns null when the localStorage value is corrupt JSON', async () => {
    const { getCached } = await load()
    localStorage.setItem('geocache:v1:broken', 'not-json')
    expect(getCached('broken')).toBeNull()
  })

  it('stores separate entries for different toponyms', async () => {
    const { getCached, setCached } = await load()
    setCached('bath', [candidate('Bath')])
    setCached('york', [candidate('York')])
    expect(getCached('bath')![0].label).toBe('Bath')
    expect(getCached('york')![0].label).toBe('York')
  })

  it('overwrites a previous entry for the same toponym', async () => {
    const { getCached, setCached } = await load()
    setCached('rome', [candidate('Rome Old')])
    setCached('rome', [candidate('Rome New'), candidate('Roma')])
    const result = getCached('rome')
    expect(result).toHaveLength(2)
    expect(result![0].label).toBe('Rome New')
  })
})
