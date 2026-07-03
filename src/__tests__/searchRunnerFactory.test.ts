import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { makeSearchRunner } from '../utils/searchRunnerFactory'
import { resolveLimit } from '../utils/runnerHelpers'
import { getNodeResults } from '../store/resultsStore'
import type { UnifiedRecord } from '../types/UnifiedRecord'

interface FakeResponse {
  total?: { value?: number }
  hits?: { id: string }[]
}

const adapter = (resp: FakeResponse): UnifiedRecord[] =>
  (resp.hits ?? []).map(h => ({ id: `fake:${h.id}`, _source: 'fake', title: h.id }))

const runner = makeSearchRunner<FakeResponse>({
  service:    'FAKE',
  serviceUrl: 'https://fake.example',
  publisher:  'Fake Publisher',
  endpoint:   'https://fake.example/api/search',
  logTag:     '[FAKE]',
  pageSize:   2,
  adapter,
  buildParams: (d, resolve) => {
    const params: Record<string, string> = { sort: '_score', order: 'desc' }
    const q = resolve('query', 'inlineQuery')
    if (q) params.q = q
    if (d.country) params.country = d.country as string
    return params
  },
})

const makeNode = (id: string, data: Record<string, unknown>): Node => ({
  id, type: 'fakeSearch', position: { x: 0, y: 0 }, data,
})

/** total=5, pageSize=2 — pages of [1,2] [3,4] [5] */
function mockService(total = 5) {
  const allHits = Array.from({ length: total }, (_, i) => ({ id: String(i + 1) }))
  return vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url))
    const size = parseInt(u.searchParams.get('size') ?? '2', 10)
    const page = parseInt(u.searchParams.get('page') ?? '1', 10)
    const start = (page - 1) * size
    const body: FakeResponse = { total: { value: total }, hits: allHits.slice(start, start + size) }
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('makeSearchRunner', () => {
  it('probes, paginates 1-indexed, trims to the limit, stamps citations', async () => {
    const fetchMock = mockService(5)
    vi.stubGlobal('fetch', fetchMock)

    const nodes = [makeNode('n1', { inlineQuery: 'stonehenge', inlineLimit: '3', country: 'UK' })]
    const updates: Record<string, unknown>[] = []
    await runner('n1', () => nodes, [], (_, data) => updates.push(data))

    const records = getNodeResults('n1') as Record<string, unknown>[]
    expect(records.map(r => r.id)).toEqual(['fake:1', 'fake:2', 'fake:3'])

    // Probe (size=1) + 2 pages of size=2
    const calls = fetchMock.mock.calls.map(c => new URL(String(c[0])))
    expect(calls[0].searchParams.get('size')).toBe('1')
    expect(calls.slice(1).map(u => u.searchParams.get('page'))).toEqual(['1', '2'])

    // Citation: service metadata + query string of non-paging params
    const citation = records[0]._citation as Record<string, unknown>
    expect(citation.service).toBe('FAKE')
    expect(citation.query).toBe('q:stonehenge, country:UK')

    // Terminal status
    const last = updates[updates.length - 1]
    expect(last).toMatchObject({ status: 'success', count: 5 })
    expect(String(last.statusMessage)).toContain('3 of 5')
  })

  it('wired query param overrides the inline value', async () => {
    const fetchMock = mockService(1)
    vi.stubGlobal('fetch', fetchMock)

    const nodes = [
      makeNode('n1', { inlineQuery: 'inline-q' }),
      makeNode('param-1', { value: 'wired-q' }),
    ]
    const edges: Edge[] = [{ id: 'e1', source: 'param-1', target: 'n1', targetHandle: 'query' }]
    await runner('n1', () => nodes, edges, () => {})

    const probeUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(probeUrl.searchParams.get('q')).toBe('wired-q')
  })

  it('fetchAll ignores the limit and fetches everything', async () => {
    vi.stubGlobal('fetch', mockService(5))
    const nodes = [makeNode('n1', { inlineQuery: 'x', inlineLimit: '2', fetchAll: true })]
    await runner('n1', () => nodes, [], () => {})
    expect((getNodeResults('n1') ?? []).length).toBe(5)
  })

  it('sets error status without throwing when the service fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 502, statusText: 'Bad Gateway' })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const nodes = [makeNode('n1', { inlineQuery: 'x' })]
    const updates: Record<string, unknown>[] = []
    await expect(runner('n1', () => nodes, [], (_, d) => updates.push(d))).resolves.toBeUndefined()
    expect(updates[updates.length - 1]).toMatchObject({ status: 'error' })
  })

  it('empty result set finishes cleanly with 0 of 0', async () => {
    vi.stubGlobal('fetch', mockService(0))
    const nodes = [makeNode('n1', { inlineQuery: 'nothing' })]
    const updates: Record<string, unknown>[] = []
    await runner('n1', () => nodes, [], (_, d) => updates.push(d))
    expect(getNodeResults('n1')).toEqual([])
    expect(updates[updates.length - 1]).toMatchObject({ status: 'success', count: 0 })
  })
})

describe('resolveLimit', () => {
  const nodes = [
    makeNode('n1', {}),
    makeNode('param-1', { value: '7' }),
    makeNode('param-bad', { value: 'abc' }),
  ]

  it('prefers the wired limit', () => {
    const edges: Edge[] = [{ id: 'e', source: 'param-1', target: 'n1', targetHandle: 'limit' }]
    expect(resolveLimit('n1', nodes, edges, '3')).toBe(7)
  })

  it('falls back to inline, then default; rejects non-numeric and sub-1', () => {
    expect(resolveLimit('n1', nodes, [], '3')).toBe(3)
    expect(resolveLimit('n1', nodes, [], undefined)).toBe(20)
    expect(resolveLimit('n1', nodes, [], '0')).toBe(20)
    const badEdges: Edge[] = [{ id: 'e', source: 'param-bad', target: 'n1', targetHandle: 'limit' }]
    expect(resolveLimit('n1', nodes, badEdges, '3')).toBe(20)
  })
})
