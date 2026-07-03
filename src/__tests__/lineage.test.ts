import { describe, it, expect, beforeEach } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { collectLineage } from '../utils/lineage'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

function mkNode(id: string, type: string, data: Record<string, unknown> = {}): Node {
  return { id, type, position: { x: 0, y: 0 }, data }
}

function mkEdge(source: string, target: string, targetHandle = 'data'): Edge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, targetHandle }
}

const ALL_IDS = ['search', 'filter', 'kcl', 'a', 'b', 'c', 'd', 'src', 'group', 'target']

beforeEach(() => {
  for (const id of ALL_IDS) clearNodeResults(id)
})

describe('collectLineage', () => {
  it('walks a linear chain in topological order, excluding the target and param edges', () => {
    const nodes = [
      mkNode('search', 'ariadneSearch', {
        status: 'success', statusMessage: '✓ 50', count: 50,
        inlineQuery: 'stonehenge', resultsVersion: 1,
      }),
      mkNode('filter', 'filterTransform', {
        status: 'success', inputCount: 50, outputCount: 20, filterOps: [{ field: 'title' }],
      }),
      mkNode('kcl', 'kclNode', { status: 'idle' }),
      mkNode('param', 'param', { value: 'stonehenge' }),
    ]
    const edges = [
      mkEdge('search', 'filter'),
      mkEdge('filter', 'kcl'),
      mkEdge('param', 'search', 'query'),   // param handle — NOT data flow
    ]
    setNodeResults('search', [{ id: 'r1' }])

    const g = collectLineage('kcl', nodes, edges)

    expect(g.entries.map(e => e.nodeId)).toEqual(['search', 'filter'])
    expect(g.edges).toEqual([{ from: 'search', to: 'filter' }])
    // params are stripTransient'd — no status/count noise
    expect(g.entries[0].params).not.toHaveProperty('status')
    expect(g.entries[0].params).not.toHaveProperty('count')
    expect(g.entries[0].params).toHaveProperty('inlineQuery', 'stonehenge')
    // counts read from raw data before stripping
    expect(g.entries[0].outCount).toBe(50)
    expect(g.entries[1].inCount).toBe(50)
    expect(g.entries[1].outCount).toBe(20)
    expect(g.stale).toBe(false)
  })

  it('handles a diamond: shared ancestor appears once, sources first', () => {
    const nodes = [
      mkNode('a', 'gbifSearch', { status: 'success', count: 10 }),
      mkNode('b', 'filterTransform', { status: 'success', inputCount: 10, outputCount: 5 }),
      mkNode('c', 'deduplicate', { status: 'success', inputCount: 10, outputCount: 8 }),
      mkNode('d', 'mergeByQID', { status: 'idle' }),
    ]
    const edges = [
      mkEdge('a', 'b'),
      mkEdge('a', 'c'),
      mkEdge('b', 'd'),
      mkEdge('c', 'd'),
    ]

    const g = collectLineage('d', nodes, edges)

    expect(g.entries.map(e => e.nodeId)).toEqual(['a', 'b', 'c'])
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ]))
    expect(g.edges).toHaveLength(2) // edges into the excluded target are not entries-edges
  })

  it('resolves collapsed-group proxy edges back to the original source', () => {
    const nodes = [
      mkNode('src', 'ariadneSearch', { status: 'success', count: 3, inlineQuery: 'roman' }),
      mkNode('group', 'group', {
        collapsed: true,
        proxyEdges: [{ edgeId: 'e1', side: 'out', originalSource: 'src', originalSourceHandle: 'results' }],
      }),
      mkNode('target', 'kclNode', { status: 'idle' }),
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'group', target: 'target', targetHandle: 'data' },
    ]
    setNodeResults('src', [{ id: 'r1' }])

    const g = collectLineage('target', nodes, edges)

    expect(g.entries.map(e => e.nodeId)).toEqual(['src'])
    expect(g.entries[0].params).toHaveProperty('inlineQuery', 'roman')
  })

  it('is cycle-safe: each node appears once and the walk terminates', () => {
    const nodes = [
      mkNode('a', 'filterTransform', { status: 'success' }),
      mkNode('b', 'deduplicate', { status: 'success' }),
      mkNode('target', 'kclNode', { status: 'idle' }),
    ]
    const edges = [
      mkEdge('a', 'b'),
      mkEdge('b', 'a'),      // cycle
      mkEdge('b', 'target'),
    ]

    const g = collectLineage('target', nodes, edges)

    expect(g.entries.map(e => e.nodeId).sort()).toEqual(['a', 'b'])
  })

  it('flags stale when an upstream node never ran this session', () => {
    const nodes = [
      mkNode('search', 'ariadneSearch', { status: 'idle', inlineQuery: 'x' }),
      mkNode('kcl', 'kclNode', { status: 'idle' }),
    ]
    const g = collectLineage('kcl', nodes, [mkEdge('search', 'kcl')])
    expect(g.stale).toBe(true)
  })

  it('flags stale when a past run is claimed but the results store is empty', () => {
    const nodes = [
      mkNode('search', 'ariadneSearch', { status: 'success', count: 5, resultsVersion: 2 }),
      mkNode('kcl', 'kclNode', { status: 'idle' }),
    ]
    const edges = [mkEdge('search', 'kcl')]

    expect(collectLineage('kcl', nodes, edges).stale).toBe(true)

    setNodeResults('search', [{ id: 'r1' }])
    expect(collectLineage('kcl', nodes, edges).stale).toBe(false)
  })

  it('returns an empty graph for a node with no upstream data edges', () => {
    const nodes = [mkNode('search', 'ariadneSearch', { status: 'idle' })]
    const g = collectLineage('search', nodes, [])
    expect(g.entries).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.stale).toBe(false)
  })
})
