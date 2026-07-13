/**
 * Pins the wbsearchentities / wbgetentities entity-lookup surface added for
 * the SPARQL builder autocomplete + NL-assist grounding (searchEntities,
 * fetchEntityLabels): URL parameters, result mapping, missing-entity
 * semantics, batching, and the session caches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  searchEntities, fetchEntityLabels, __clearWikidataCaches,
} from '../utils/wikidataApi'

const fetchMock = vi.fn()

beforeEach(() => {
  __clearWikidataCaches()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('searchEntities', () => {
  it('calls wbsearchentities with origin=* and maps results', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      search: [
        { id: 'Q159758', label: 'J. M. W. Turner', description: 'English Romantic painter (1775–1851)' },
        { id: 'Q219831', label: 'William Turner of Oxford' },
      ],
    }))

    const results = await searchEntities('william turner')

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe('https://www.wikidata.org/w/api.php')
    expect(url.searchParams.get('action')).toBe('wbsearchentities')
    expect(url.searchParams.get('search')).toBe('william turner')
    expect(url.searchParams.get('type')).toBe('item')
    expect(url.searchParams.get('limit')).toBe('8')
    expect(url.searchParams.get('origin')).toBe('*')

    expect(results).toEqual([
      { id: 'Q159758', label: 'J. M. W. Turner', description: 'English Romantic painter (1775–1851)' },
      { id: 'Q219831', label: 'William Turner of Oxford', description: undefined },
    ])
  })

  it('searches properties when type=property (powers the filter-row property picker)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      search: [{ id: 'P2348', label: 'time period', description: 'era the item was in existence' }],
    }))

    const results = await searchEntities('time period', { type: 'property' })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('type')).toBe('property')
    expect(results[0]).toEqual({ id: 'P2348', label: 'time period', description: 'era the item was in existence' })
  })

  it('serves repeats from the session cache (no second fetch)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ search: [{ id: 'Q1', label: 'universe' }] }))
    await searchEntities('universe')
    const again = await searchEntities('  Universe ')   // trim + case-insensitive key
    expect(again[0].id).toBe('Q1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns [] for an empty query without fetching, and throws on HTTP error without caching', async () => {
    expect(await searchEntities('   ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(new Response('err', { status: 500 }))
    await expect(searchEntities('boom')).rejects.toThrow('500')
    // failure was not cached — a retry fetches again
    fetchMock.mockResolvedValueOnce(jsonResponse({ search: [] }))
    expect(await searchEntities('boom')).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('fetchEntityLabels', () => {
  it('resolves labels + descriptions; missing entities are absent from the Map', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      entities: {
        Q159758: { id: 'Q159758', labels: { en: { value: 'J. M. W. Turner' } }, descriptions: { en: { value: 'painter' } } },
        Q99999999: { id: 'Q99999999', missing: '' },
      },
    }))

    const map = await fetchEntityLabels(['Q159758', 'Q99999999'])

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('action')).toBe('wbgetentities')
    expect(url.searchParams.get('props')).toBe('labels|descriptions')

    expect(map.get('Q159758')).toEqual({ label: 'J. M. W. Turner', description: 'painter' })
    expect(map.has('Q99999999')).toBe(false)
  })

  it('caches both found and missing entities across calls', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      entities: {
        Q1: { id: 'Q1', labels: { en: { value: 'universe' } } },
        Q2: { id: 'Q2', missing: '' },
      },
    }))
    await fetchEntityLabels(['Q1', 'Q2'])

    const map = await fetchEntityLabels(['Q1', 'Q2'])   // fully cached
    expect(map.get('Q1')).toEqual({ label: 'universe', description: undefined })
    expect(map.has('Q2')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops an out-of-range QID (top-level no-such-entity error) and retries the batch', async () => {
    // Verified live: ids beyond Wikidata's range fail the WHOLE request with a
    // top-level error naming the offender, unlike in-range nonexistent ids
    // which get per-entity `missing` markers.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'no-such-entity', id: 'Q99999999999' } }))
      .mockResolvedValueOnce(jsonResponse({
        entities: { Q159758: { id: 'Q159758', labels: { en: { value: 'J. M. W. Turner' } } } },
      }))

    const map = await fetchEntityLabels(['Q159758', 'Q99999999999'])

    expect(map.get('Q159758')?.label).toBe('J. M. W. Turner')
    expect(map.has('Q99999999999')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // second request no longer contains the bad id
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('ids')).toBe('Q159758')
  })

  it('batches more than 50 QIDs into multiple requests', async () => {
    const qids = Array.from({ length: 60 }, (_, i) => `Q${i + 1}`)
    const entitiesFor = (ids: string[]) =>
      Object.fromEntries(ids.map(q => [q, { id: q, labels: { en: { value: `label ${q}` } } }]))

    fetchMock.mockImplementation((rawUrl: string) => {
      const ids = new URL(rawUrl).searchParams.get('ids')!.split('|')
      return Promise.resolve(jsonResponse({ entities: entitiesFor(ids) }))
    })

    const map = await fetchEntityLabels(qids)
    expect(map.size).toBe(60)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('ids')!.split('|')).toHaveLength(50)
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('ids')!.split('|')).toHaveLength(10)
  })
})
