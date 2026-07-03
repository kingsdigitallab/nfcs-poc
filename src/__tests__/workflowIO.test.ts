import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import {
  buildWorkflowPayload,
  parseWorkflowFile,
  hydrateNodes,
  stripTransient,
} from '../utils/workflowIO'

const makeNode = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id,
  type,
  position: { x: 10, y: 20 },
  data,
})

describe('stripTransient', () => {
  it('drops runtime-only fields and keeps config', () => {
    const out = stripTransient({
      inlineQuery: 'stonehenge',
      limit: 50,
      status: 'success',
      statusMessage: '✓ 50',
      count: 50,
      resultsVersion: 7,
      results: [{ id: 'x' }],
      folderName: 'my-folder',
      _capped: true,
      _total: 999,
    })
    expect(out).toEqual({ inlineQuery: 'stonehenge', limit: 50 })
  })
})

describe('buildWorkflowPayload → parseWorkflowFile → hydrateNodes round-trip', () => {
  const nodes: Node[] = [
    makeNode('gbif-1', 'gbifSearch', { inlineQ: 'fox', status: 'success', count: 12, resultsVersion: 3 }),
    makeNode('table-1', 'tableOutput', { pageSize: 25 }),
  ]
  const edges: Edge[] = [
    { id: 'e1', source: 'gbif-1', target: 'table-1', targetHandle: 'data' },
  ]

  it('serialises with version 2 and strips transient data', () => {
    const payload = buildWorkflowPayload(nodes, edges)
    expect(payload.version).toBe(2)
    expect(payload.savedAt).toBeTruthy()
    expect(payload.nodes).toHaveLength(2)
    expect(payload.edges).toEqual(edges)
    const gbif = payload.nodes.find(n => n.id === 'gbif-1')!
    expect(gbif.data).toEqual({ inlineQ: 'fox' })
  })

  it('includes workflowId and notes only when provided', () => {
    const bare = buildWorkflowPayload(nodes, edges)
    expect('workflowId' in bare).toBe(false)
    expect('notes' in bare).toBe(false)

    const withExtras = buildWorkflowPayload(nodes, edges, {
      workflowId: 'wf-1',
      notes: { 'quicknote-1::rec-1': 'gold standard' },
    })
    expect(withExtras.workflowId).toBe('wf-1')
    expect(withExtras.notes).toEqual({ 'quicknote-1::rec-1': 'gold standard' })
  })

  it('parses its own serialised output and hydrates with runtime defaults', () => {
    const json = JSON.stringify(buildWorkflowPayload(nodes, edges))
    const parsed = parseWorkflowFile(json)
    const hydrated = hydrateNodes(parsed)

    expect(hydrated).toHaveLength(2)
    const gbif = hydrated.find(n => n.id === 'gbif-1')!
    // Runtime defaults injected; saved config preserved
    expect(gbif.data.status).toBe('idle')
    expect(gbif.data.count).toBe(0)
    expect(gbif.data.resultsVersion).toBe(0)
    expect(gbif.data.inlineQ).toBe('fox')
    expect(gbif.position).toEqual({ x: 10, y: 20 })
  })
})

describe('parseWorkflowFile validation', () => {
  it('accepts version 1 files', () => {
    const v1 = JSON.stringify({ version: 1, savedAt: 'x', nodes: [], edges: [] })
    expect(parseWorkflowFile(v1).version).toBe(1)
  })

  it('rejects invalid JSON', () => {
    expect(() => parseWorkflowFile('{not json')).toThrow('not valid JSON')
  })

  it('rejects JSON without a recognised version', () => {
    expect(() => parseWorkflowFile('{"nodes":[]}')).toThrow('version')
    expect(() => parseWorkflowFile('{"version":99,"nodes":[]}')).toThrow('version')
  })
})

describe('hydrateNodes group handling', () => {
  it('preserves child opacity styles only inside collapsed groups', () => {
    const file = parseWorkflowFile(JSON.stringify({
      version: 2,
      savedAt: 'x',
      edges: [],
      nodes: [
        { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { collapsed: true } },
        {
          id: 'child-1', type: 'comment', position: { x: 5, y: 5 },
          data: {}, parentId: 'g1', style: { opacity: 0 },
        },
        {
          id: 'free-1', type: 'comment', position: { x: 50, y: 50 },
          data: {}, style: { opacity: 0 },
        },
      ],
    }))
    const hydrated = hydrateNodes(file)
    const child = hydrated.find(n => n.id === 'child-1')!
    const free = hydrated.find(n => n.id === 'free-1')!
    expect((child.style as Record<string, unknown>).opacity).toBe(0)
    expect('opacity' in (free.style as Record<string, unknown>)).toBe(false)
  })
})
