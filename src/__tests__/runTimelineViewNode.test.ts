import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'

vi.mock('../utils/upstreamRecords', () => ({
  collectUpstreamRecords: vi.fn(() => []),
  resolveProxyEdges: (e: Edge[]) => e,
}))

import { collectUpstreamRecords } from '../utils/upstreamRecords'
import { getNodeResults, clearNodeResults } from '../store/resultsStore'
import { runTimelineViewNode } from '../utils/runTimelineViewNode'

const mockUpstream = vi.mocked(collectUpstreamRecords)

// An ARIADNE-shaped record: catalogue issue date AND an archaeological period.
const ariadne = { id: 'a', title: 'Stonehenge', _source: 'ariadne', date: '2020-06-08', periodStart: '-2599', periodEnd: '-0699' }
const dated   = { id: 'b', title: 'Book',       _source: 'llds',    date: '1901' }
const custom  = { id: 'c', title: 'Object',     _source: 'smg',     smg: { made: '1850' } }

function harness(data: Record<string, unknown>) {
  const nodes: Node[] = [{ id: 'n', type: 'timelineView', position: { x: 0, y: 0 }, data }]
  const edges: Edge[] = []
  const updates: Record<string, unknown>[] = []
  const updateNodeData = (_id: string, d: Record<string, unknown>) => { updates.push(d) }
  const last = () => updates.reduce((acc, u) => ({ ...acc, ...u }), {} as Record<string, unknown>)
  return { nodes, edges, updateNodeData, last }
}

describe('runTimelineViewNode uses the shared date resolution', () => {
  beforeEach(() => {
    clearNodeResults('n')
    mockUpstream.mockReset()
    mockUpstream.mockReturnValue([ariadne, dated, custom])
  })

  it('passes everything through when no range is set', async () => {
    const h = harness({ filterStart: null, filterEnd: null })
    await runTimelineViewNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect((getNodeResults('n') ?? []).map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(h.last().status).toBe('success')
    expect(h.last().statusMessage).toBe('3 records')
  })

  it('keeps a period record inside a BCE range even though its catalogue date is modern', async () => {
    const h = harness({ filterStart: -3000, filterEnd: -500 })
    await runTimelineViewNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect((getNodeResults('n') ?? []).map(r => r.id)).toEqual(['a'])
    expect(h.last().filterCount).toBe(1)
    expect(h.last().totalCount).toBe(3)
  })

  it('honours the user-chosen dateField like the component does', async () => {
    const h = harness({ filterStart: 1800, filterEnd: 1900, dateField: 'smg.made' })
    await runTimelineViewNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect((getNodeResults('n') ?? []).map(r => r.id)).toEqual(['c'])
  })

  it('drops undated records when a range is active', async () => {
    const h = harness({ filterStart: 1800, filterEnd: 2100 })
    await runTimelineViewNode('n', () => h.nodes, h.edges, h.updateNodeData)
    expect((getNodeResults('n') ?? []).map(r => r.id)).toEqual(['b'])
  })
})
