import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'

vi.mock('../utils/upstreamRecords', () => ({
  collectUpstreamRecords: vi.fn(() => []),
  resolveProxyEdges: (e: Edge[]) => e,
}))
// Image bytes never leave the test; the fetch helper is what the proxy work covers.
vi.mock('../utils/imageFetch', () => ({
  fetchImageAsDataUrl: vi.fn(async (url: string) => url.startsWith('data:') ? url : (url.includes('broken') ? Promise.reject(new Error('HTTP 415: not an image')) : `data:image/jpeg;base64,FETCHED(${url})`)),
  resizeDataUrl: vi.fn(async (u: string) => u),
  IMAGE_MAX_DIM: 1280,
}))

import { collectUpstreamRecords } from '../utils/upstreamRecords'
import { getNodeResults, clearNodeResults } from '../store/resultsStore'
import { runKCLFieldNode } from '../utils/runKCLFieldNode'

const mockUpstream = vi.mocked(collectUpstreamRecords)

const vam = (i: number, thumb = true) => ({
  id: `vam:${i}`, _source: 'vam', title: `Stone Henge ${i}`,
  vam: { objectType: 'Watercolour', ...(thumb ? { thumbnail: `https://framemark.vam.ac.uk/collections/${i}/full/!100,100/0/default.jpg` } : {}) },
})

type Sent = { messages: Array<{ role: string; content: unknown }> }
const sent: Sent[] = []
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  sent.push(JSON.parse(String(init?.body)) as Sent)
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) }
})

function harness(data: Record<string, unknown>) {
  const nodes: Node[] = [{ id: 'n', type: 'kclField', position: { x: 0, y: 0 }, data: { apiKey: 'k', model: 'arc:lite', ...data } }]
  const edges: Edge[] = []
  const updates: Record<string, unknown>[] = []
  const updateNodeData = (_id: string, d: Record<string, unknown>) => { updates.push(d) }
  const last = () => updates.reduce((acc, u) => ({ ...acc, ...u }), {} as Record<string, unknown>)
  return { nodes, edges, updateNodeData, last }
}
const userContent = (i: number) => sent[i].messages.find(m => m.role === 'user')!.content

describe('runKCLFieldNode — namespaced (dot-path) fields', () => {
  beforeEach(() => { clearNodeResults('n'); sent.length = 0; mockUpstream.mockReset(); vi.stubGlobal('fetch', fetchSpy) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('per-record: reads the value by path and substitutes it into {{value}}', async () => {
    mockUpstream.mockReturnValue([vam(1), vam(2)])
    const h = harness({ selectedField: 'vam.objectType', mode: 'per-record', userPromptTemplate: 'Type: {{value}} / {{vam.objectType}}' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(userContent(0)).toBe('Type: Watercolour / Watercolour')
    expect((getNodeResults('n') ?? []).map(r => r.kclResponse)).toEqual(['OK', 'OK'])
    expect(h.last().status).toBe('success')
  })

  it('aggregate: joins the path values of every record', async () => {
    mockUpstream.mockReturnValue([vam(1), vam(2)])
    const h = harness({ selectedField: 'vam.thumbnail', mode: 'aggregate', userPromptTemplate: '{{count}}:\n{{values}}' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(userContent(0)).toBe('2:\nhttps://framemark.vam.ac.uk/collections/1/full/!100,100/0/default.jpg\n---\nhttps://framemark.vam.ac.uk/collections/2/full/!100,100/0/default.jpg')
  })
})
