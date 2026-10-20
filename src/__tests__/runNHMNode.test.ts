import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { runNHMNode, buildNHMFilters, NHM_RESOURCES } from '../utils/runNHMNode'
import { getNodeResults, clearNodeResults } from '../store/resultsStore'
import type { NHMRecord } from '../utils/nhmAdapter'

const makeNode = (id: string, data: Record<string, unknown>): Node =>
  ({ id, type: 'nhmSearch', position: { x: 0, y: 0 }, data })

const baseData = {
  inlineQuery: 'stonehenge', inlineLimit: '20', fetchAll: false, resource: 'specimens', sort: 'relevance',
  collectionCode: '', country: '', year: '', typeStatus: '', basisOfRecord: '',
}

type Body = { resource_id: string; q?: string; filters?: Record<string, string>; sort?: string; limit: number; offset: number }

/** Fake NHM service: `total` records, each with a media item on every 3rd record. */
function mockNHM(total: number) {
  const all: NHMRecord[] = Array.from({ length: total }, (_, i) => ({
    _id: i + 1, occurrenceID: `occ-${i + 1}`, scientificName: `Taxon ${i + 1}`,
    associatedMedia: i % 3 === 0 ? [{ identifier: `https://data.nhm.ac.uk/media/m${i}` }] : [],
    associatedMediaCount: i % 3 === 0 ? '1' : '0',
  }))
  const bodies: Body[] = []
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body
    bodies.push(body)
    const records = all.slice(body.offset, body.offset + body.limit)
    return new Response(JSON.stringify({ success: true, result: { total, records } }), { status: 200 })
  })
  return { fetchMock, bodies }
}

async function run(data: Record<string, unknown>, extraNodes: Node[] = [], edges: Edge[] = []) {
  const nodes = [makeNode('n1', data), ...extraNodes]
  const updates: Record<string, unknown>[] = []
  await runNHMNode('n1', () => nodes, edges, (_, d) => updates.push(d))
  const last = updates.reduce((acc, u) => ({ ...acc, ...u }), {} as Record<string, unknown>)
  return { updates, last }
}

beforeEach(() => { clearNodeResults('n1'); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('buildNHMFilters', () => {
  it('returns undefined when nothing is set, trims values, drops blanks', () => {
    expect(buildNHMFilters(baseData)).toBeUndefined()
    expect(buildNHMFilters({ ...baseData, collectionCode: 'MIN', year: ' 1882 ', country: '   ' }))
      .toEqual({ collectionCode: 'MIN', year: '1882' })
  })
})

describe('runNHMNode', () => {
  it('limit 20 → exactly one POST with limit 20, no probe; stores adapted + cited records', async () => {
    const { fetchMock, bodies } = mockNHM(142)
    vi.stubGlobal('fetch', fetchMock)
    const { last } = await run(baseData)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ resource_id: NHM_RESOURCES.specimens, q: 'stonehenge', limit: 20, offset: 0 })
    expect(bodies[0]).not.toHaveProperty('filters')
    expect(bodies[0]).not.toHaveProperty('sort')
    const records = getNodeResults('n1') as Record<string, unknown>[]
    expect(records).toHaveLength(20)
    expect(records[0].id).toBe('nhm:occ-1')
    const c = records[0]._citation as Record<string, unknown>
    expect(c.service).toBe('Natural History Museum Data Portal')
    expect(c.url).toBe('https://data.nhm.ac.uk/object/occ-1')
    expect(c.pid).toBe('occ-1')
    expect(last).toMatchObject({ status: 'success', count: 142, _capped: false })
    expect(String(last.statusMessage)).toContain('20 of 142')
    expect(String(last.statusMessage)).toContain('7 with images')   // records 1,4,…,19 → 7
  })

  it('fetchAll with total 142 → two requests (100 + 42) and no third', async () => {
    const { fetchMock, bodies } = mockNHM(142)
    vi.stubGlobal('fetch', fetchMock)
    const { updates, last } = await run({ ...baseData, fetchAll: true })
    expect(bodies.map(b => [b.limit, b.offset])).toEqual([[100, 0], [100, 100]])
    expect((getNodeResults('n1') ?? []).length).toBe(142)
    expect(last).toMatchObject({ status: 'success', count: 142, _capped: false })
    expect(updates.some(u => String(u.statusMessage).startsWith('Page 2/2'))).toBe(true)
  })

  it('limit 50 with total 142 → one request of 50', async () => {
    const { fetchMock, bodies } = mockNHM(142)
    vi.stubGlobal('fetch', fetchMock)
    await run({ ...baseData, inlineLimit: '50' })
    expect(bodies.map(b => b.limit)).toEqual([50])
    expect((getNodeResults('n1') ?? []).length).toBe(50)
  })

  it('fetchAll caps at NHM_MAX_FETCH_ALL with the amber capped convention', async () => {
    const { fetchMock, bodies } = mockNHM(2500)
    vi.stubGlobal('fetch', fetchMock)
    const { last } = await run({ ...baseData, fetchAll: true })
    expect(bodies).toHaveLength(20)
    expect((getNodeResults('n1') ?? []).length).toBe(2000)
    expect(last).toMatchObject({ status: 'success', _capped: true, _total: 2500, count: 2500 })
    expect(String(last.statusMessage)).toMatch(/⚠ capped at 2,000 of 2,500/)
  }, 20_000)

  it('passes only the set filters, the sort when not relevance, and the index-lots resource', async () => {
    const { fetchMock, bodies } = mockNHM(3)
    vi.stubGlobal('fetch', fetchMock)
    await run({ ...baseData, resource: 'indexlots', sort: 'year desc', collectionCode: 'MIN', year: '1882' })
    expect(bodies[0]).toMatchObject({
      resource_id: NHM_RESOURCES.indexlots, sort: 'year desc',
      filters: { collectionCode: 'MIN', year: '1882' },
    })
    expect(Object.keys(bodies[0].filters ?? {})).toEqual(['collectionCode', 'year'])
  })

  it('wired query and limit params override inline values; empty query omits q', async () => {
    const { fetchMock, bodies } = mockNHM(5)
    vi.stubGlobal('fetch', fetchMock)
    const params = [makeNode('p1', { value: 'wired' }), makeNode('p2', { value: '3' })]
    const edges: Edge[] = [
      { id: 'e1', source: 'p1', target: 'n1', targetHandle: 'query' },
      { id: 'e2', source: 'p2', target: 'n1', targetHandle: 'limit' },
    ]
    await run(baseData, params, edges)
    expect(bodies[0]).toMatchObject({ q: 'wired', limit: 3 })

    const b2: Body[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      b2.push(JSON.parse(String(init?.body)) as Body)
      return new Response(JSON.stringify({ success: true, result: { total: 0, records: [] } }), { status: 200 })
    }))
    await run({ ...baseData, inlineQuery: '   ' })
    expect(b2[0]).not.toHaveProperty('q')
  })

  it('surfaces CKAN error.message on success:false (HTTP 200) without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false, error: { message: 'Resource "x" was not found.', __type: 'Not Found Error' },
    }), { status: 200 })))
    const { last } = await run(baseData)   // resolving at all proves the runner did not throw
    expect(last.status).toBe('error')
    expect(String(last.statusMessage)).toContain('Resource "x" was not found.')
    expect(getNodeResults('n1')).toBeUndefined()
  })

  it('stringifies a non-string CKAN validation error, and reports plain HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false, error: { __type: 'Validation Error', resource_id: ['Missing value'] },
    }), { status: 409 })))
    const { last } = await run(baseData)
    expect(last.status).toBe('error')
    expect(String(last.statusMessage)).toContain('Missing value')
    expect(String(last.statusMessage)).not.toContain('[object Object]')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>cloudflare</html>', { status: 503, statusText: 'Service Unavailable' })))
    const { last: l2 } = await run(baseData)
    expect(l2.status).toBe('error')
    expect(String(l2.statusMessage)).toContain('HTTP 503')
  })

  it('a service that caps pages below 100 still yields every record (offset advances by batch size)', async () => {
    const all: NHMRecord[] = Array.from({ length: 142 }, (_, i) => ({ _id: i + 1, occurrenceID: `occ-${i + 1}` }))
    const bodies: Body[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Body
      bodies.push(body)
      const records = all.slice(body.offset, body.offset + Math.min(body.limit, 50))   // server cap 50
      return new Response(JSON.stringify({ success: true, result: { total: 142, records } }), { status: 200 })
    }))
    const { last } = await run({ ...baseData, fetchAll: true })
    expect(bodies.map(b => b.offset)).toEqual([0, 50, 100])
    const ids = (getNodeResults('n1') ?? []).map(r => r.id)
    expect(ids).toHaveLength(142)
    expect(new Set(ids).size).toBe(142)
    expect(last).toMatchObject({ status: 'success', count: 142, _capped: false })
  })

  it('a service that stops returning records short of its own total reports an amber cap, not a clean success', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Body
      calls++
      const records: NHMRecord[] = body.offset === 0
        ? Array.from({ length: body.limit }, (_, i) => ({ _id: i + 1, occurrenceID: `occ-${i + 1}` }))
        : []
      return new Response(JSON.stringify({ success: true, result: { total: 142, records } }), { status: 200 })
    }))
    const { last } = await run({ ...baseData, fetchAll: true })
    expect(calls).toBe(2)
    expect((getNodeResults('n1') ?? []).length).toBe(100)
    expect(last).toMatchObject({ status: 'success', _capped: true, _total: 142 })
    expect(String(last.statusMessage)).toMatch(/⚠/)
    expect(String(last.statusMessage)).toContain('100 of 142')
  })

  it('empty result set finishes 0 of 0', async () => {
    vi.stubGlobal('fetch', mockNHM(0).fetchMock)
    const { last } = await run(baseData)
    expect(getNodeResults('n1')).toEqual([])
    expect(last).toMatchObject({ status: 'success', count: 0 })
  })
})
