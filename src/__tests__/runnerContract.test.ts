import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'

/**
 * NodeRunner contract (CLAUDE.md): a runner never throws, always leaves a
 * terminal status, and never lets a previous run's records survive a failed
 * run (downstream nodes read the store, not the status).
 */
vi.mock('../utils/upstreamRecords', () => ({
  collectUpstreamRecords: vi.fn(() => [{ id: 'r1', title: 'x' }]),
  resolveProxyEdges: (e: Edge[]) => e,
}))

import { collectUpstreamRecords } from '../utils/upstreamRecords'
import { setNodeResults, getNodeResults, clearNodeResults, clearNodeResultsDeep, clearAllResults } from '../store/resultsStore'
import { runDeduplicateNode } from '../utils/runDeduplicateNode'
import runCommentNode from '../utils/runCommentNode'
import { runGeocodingNode } from '../utils/runGeocodingNode'
import { runImageViewNode } from '../utils/runImageViewNode'
import { runKCLNode } from '../utils/runKCLNode'
import { runOllamaNode } from '../utils/runOllamaNode'
import { runEuropeanaNode } from '../utils/runEuropeanaNode'

const mockUpstream = vi.mocked(collectUpstreamRecords)

function harness(type: string, data: Record<string, unknown>) {
  const nodes: Node[] = [{ id: 'n', type, position: { x: 0, y: 0 }, data }]
  const edges: Edge[] = []
  const updates: Record<string, unknown>[] = []
  const updateNodeData = (_id: string, d: Record<string, unknown>) => { updates.push(d) }
  const last = () => updates.reduce((acc, u) => ({ ...acc, ...u }), {} as Record<string, unknown>)
  return { nodes, edges, updateNodeData, last }
}

describe('runners never throw and end in a terminal status', () => {
  beforeEach(() => { clearNodeResults('n'); mockUpstream.mockReset(); mockUpstream.mockReturnValue([{ id: 'r1' }]) })

  it.each([
    ['runDeduplicateNode', 'deduplicate', runDeduplicateNode, { dedupeField: 'id' }],
    ['runCommentNode',     'comment',     runCommentNode,     {}],
    ['runGeocodingNode',   'geocoding',   runGeocodingNode,   { placeField: 'title' }],
  ] as const)('%s reports error instead of throwing when upstream collection fails', async (_n, type, runner, data) => {
    mockUpstream.mockImplementation(() => { throw new Error('boom') })
    const h = harness(type, data)
    await expect(runner('n', () => h.nodes, h.edges, h.updateNodeData)).resolves.toBeUndefined()
    expect(h.last().status).toBe('error')
    expect(String(h.last().statusMessage)).toContain('boom')
  })

  it('runImageViewNode leaves a terminal status even with nothing to re-signal', async () => {
    const h = harness('imageView', {})
    await runImageViewNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(['success', 'idle']).toContain(h.last().status)
    expect(h.last().statusMessage).toBeTypeOf('string')
  })
})

describe('a failed validation clears the previous run\'s results', () => {
  beforeEach(() => { clearNodeResults('n'); mockUpstream.mockReset(); mockUpstream.mockReturnValue([{ id: 'r1' }]) })

  it.each([
    ['runKCLNode (no apiKey)',        runKCLNode,       { apiKey: '', model: 'arc:nano' }],
    ['runOllamaNode (no model)',      runOllamaNode,    { model: '' }],
    ['runEuropeanaNode (no query)',   runEuropeanaNode, { apiKey: 'k', inlineQuery: '' }],
  ] as const)('%s', async (_n, runner, data) => {
    setNodeResults('n', [{ id: 'stale' }])
    const h = harness('x', data)
    await runner('n', () => h.nodes, h.edges, h.updateNodeData)
    expect(h.last().status).toBe('error')
    expect(getNodeResults('n')).toBeUndefined()
  })
})

describe('resultsStore eviction helpers', () => {
  it('clearNodeResultsDeep removes the plain key and every typed partition', () => {
    setNodeResults('f', [{ id: 'a' }]); setNodeResults('f:pdf', [{ id: 'b' }]); setNodeResults('f:xml', [{ id: 'c' }])
    setNodeResults('other', [{ id: 'd' }])
    clearNodeResultsDeep('f')
    expect(getNodeResults('f')).toBeUndefined()
    expect(getNodeResults('f:pdf')).toBeUndefined()
    expect(getNodeResults('f:xml')).toBeUndefined()
    expect(getNodeResults('other')).toEqual([{ id: 'd' }])
  })

  it('clearAllResults empties the store', () => {
    setNodeResults('p', [{ id: 'a' }]); setNodeResults('q', [{ id: 'b' }])
    clearAllResults()
    expect(getNodeResults('p')).toBeUndefined()
    expect(getNodeResults('q')).toBeUndefined()
  })
})
