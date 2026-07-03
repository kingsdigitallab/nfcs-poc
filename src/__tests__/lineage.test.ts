import { describe, it, expect, beforeEach } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { collectLineage, lineageToNarrative, type LineageGraph, type LineageEntry } from '../utils/lineage'
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

// ─── lineageToNarrative ───────────────────────────────────────────────────────

function mkEntry(nodeId: string, operationSummary: string): LineageEntry {
  return { nodeId, nodeType: 'test', label: 'Test', operationSummary, params: {} }
}

function mkGraph(
  entries: LineageEntry[],
  edges: Array<{ from: string; to: string }>,
  stale = false,
): LineageGraph {
  return { entries, edges, stale }
}

describe('lineageToNarrative', () => {
  it('renders a linear chain as a numbered list', () => {
    const g = mkGraph(
      [mkEntry('s', 'Searched ARIADNE for "stonehenge".'), mkEntry('f', 'Filtered records.')],
      [{ from: 's', to: 'f' }],
    )
    const text = lineageToNarrative(g)
    expect(text).toBe('1. Searched ARIADNE for "stonehenge".\n2. Filtered records.')
    expect(text).not.toContain('Branch')
  })

  it('renders parallel branches feeding a join as lettered sections + Then', () => {
    const g = mkGraph(
      [
        mkEntry('a', 'Searched ARIADNE.'),
        mkEntry('b', 'Searched HSDS.'),
        mkEntry('m', 'Merged records by QID.'),
      ],
      [{ from: 'a', to: 'm' }, { from: 'b', to: 'm' }],
    )
    const text = lineageToNarrative(g)
    expect(text).toContain('Branch A:\n  1. Searched ARIADNE.')
    expect(text).toContain('Branch B:\n  1. Searched HSDS.')
    expect(text).toContain('Then:\n  1. Merged records by QID.')
  })

  it('describes a shared diamond ancestor once, before the branches', () => {
    const g = mkGraph(
      [
        mkEntry('s', 'Searched GBIF.'),
        mkEntry('a', 'Filtered to England.'),
        mkEntry('b', 'Deduplicated by title.'),
      ],
      [{ from: 's', to: 'a' }, { from: 's', to: 'b' }],
    )
    const text = lineageToNarrative(g)
    expect(text.match(/Searched GBIF\./g)).toHaveLength(1)
    expect(text.indexOf('Searched GBIF.')).toBeLessThan(text.indexOf('Branch A:'))
    expect(text).toContain('Branch B:\n  1. Deduplicated by title.')
  })

  it('enforces the character budget by dropping the earliest steps whole', () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      mkEntry(`n${i}`, `Step number ${i} did a moderately verbose thing to the records.`))
    const edges = entries.slice(1).map((e, i) => ({ from: `n${i}`, to: e.nodeId }))
    const text = lineageToNarrative(mkGraph(entries, edges), { maxChars: 200 })
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text).toContain('steps omitted')
    // never cut mid-sentence — last line is the final full sentence
    expect(text.trimEnd().endsWith('Step number 7 did a moderately verbose thing to the records.')).toBe(true)
  })

  it('prefixes the staleness note when the graph is stale', () => {
    const g = mkGraph([mkEntry('s', 'Searched ARIADNE.')], [], true)
    expect(lineageToNarrative(g)).toMatch(/^Note: some upstream node settings may have changed/)
  })

  it('returns an empty string for an empty graph', () => {
    expect(lineageToNarrative(mkGraph([], []))).toBe('')
  })
})
