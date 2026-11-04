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

  it('aggregate: every path value is headed by "id: <id> · title (Source)" so the model can cite records', async () => {
    mockUpstream.mockReturnValue([vam(1), vam(2)])
    const h = harness({ selectedField: 'vam.thumbnail', mode: 'aggregate', userPromptTemplate: '{{count}}:\n{{values}}' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(userContent(0)).toBe(
      '2:\nid: vam:1 · Stone Henge 1 (V&A)\nhttps://framemark.vam.ac.uk/collections/1/full/!100,100/0/default.jpg'
      + '\n---\nid: vam:2 · Stone Henge 2 (V&A)\nhttps://framemark.vam.ac.uk/collections/2/full/!100,100/0/default.jpg')
    expect(h.last().statusMessage).toMatch(/✓ Aggregate summary \(2 records\)/)
  })

  it('aggregate: labelValues: false sends the bare values exactly as before', async () => {
    mockUpstream.mockReturnValue([vam(1), vam(2)])
    const h = harness({ selectedField: 'vam.thumbnail', mode: 'aggregate', labelValues: false, userPromptTemplate: '{{count}}:\n{{values}}' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(userContent(0)).toBe('2:\nhttps://framemark.vam.ac.uk/collections/1/full/!100,100/0/default.jpg\n---\nhttps://framemark.vam.ac.uk/collections/2/full/!100,100/0/default.jpg')
  })

  it('aggregate: {{count}}, kclAggregatedFrom and the status line report the values actually sent, not the upstream total', async () => {
    mockUpstream.mockReturnValue([vam(1), vam(2, false)])
    const h = harness({ selectedField: 'vam.thumbnail', mode: 'aggregate', userPromptTemplate: '{{count}}:\n{{values}}' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(String(userContent(0)).startsWith('1:\nid: vam:1')).toBe(true)
    expect(h.last().statusMessage).toMatch(/✓ Aggregate summary \(1 of 2 records\)/)
    expect(getNodeResults('n')?.[0]?.kclAggregatedFrom).toBe(1)
  })
})

type Part = { type: string; text?: string; image_url?: { url: string; format: string } }
const parts = (i: number) => userContent(i) as Part[]

describe('runKCLFieldNode — image input (thumbnails → vision model)', () => {
  beforeEach(() => { clearNodeResults('n'); sent.length = 0; mockUpstream.mockReset(); vi.stubGlobal('fetch', fetchSpy) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('per-record: one call per record with [text, image]; {{value}} is the record title, not the URL', async () => {
    mockUpstream.mockReturnValue([vam(1), vam(2)])
    const h = harness({ selectedField: 'vam.thumbnail', mode: 'per-record', inputKind: 'image', userPromptTemplate: 'What is shown in "{{value}}"?' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(sent).toHaveLength(2)
    expect(parts(0)[0]).toEqual({ type: 'text', text: 'What is shown in "Stone Henge 1"?' })
    expect(parts(0)[1].image_url?.url).toBe('data:image/jpeg;base64,FETCHED(https://framemark.vam.ac.uk/collections/1/full/!100,100/0/default.jpg)')
    expect((getNodeResults('n') ?? []).map(r => r.kclResponse)).toEqual(['OK', 'OK'])
    expect(h.last().status).toBe('success')
  })

  it('per-record: a record whose image cannot be fetched gets an explanatory response and the run continues', async () => {
    const broken = { ...vam(9), vam: { thumbnail: 'https://cdn.example/broken.jpg' } }
    mockUpstream.mockReturnValue([broken, vam(2)])
    const h = harness({ selectedField: 'vam.thumbnail', mode: 'per-record', inputKind: 'image' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    const out = getNodeResults('n') ?? []
    expect(out[0].kclResponse).toMatch(/^\[image unavailable: .*not an image/)
    expect(out[1].kclResponse).toBe('OK')
    expect(sent).toHaveLength(1)          // no API call for the broken record
    expect(h.last().status).toBe('success')
  })

  it('aggregate: one call carrying up to maxImages images, each introduced by a numbered title line', async () => {
    mockUpstream.mockReturnValue([vam(1), vam(2, false), vam(3), vam(4)])   // record 2 has no thumbnail
    const h = harness({ selectedField: 'vam.thumbnail', mode: 'aggregate', inputKind: 'image', maxImages: 2, userPromptTemplate: 'Which of these {{count}} images show standing stones?' })
    await runKCLFieldNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(sent).toHaveLength(1)
    const p = parts(0)
    expect(p.filter(x => x.type === 'image_url')).toHaveLength(2)
    expect(p[0].text).toBe('Which of these 2 images show standing stones?\n\nImages:\n1. Stone Henge 1 (V&A)\n2. Stone Henge 3 (V&A)')
    const agg = (getNodeResults('n') ?? [])[0]
    expect(agg.kclAggregatedFrom).toBe(2)
    expect(h.last().statusMessage).toMatch(/2 of 3 images/)
  })
})
