import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { duplicateNodes, cloneNodeData, RUNTIME_FIELDS, DUPLICATE_OFFSET } from '../utils/duplicateNodes'

const makeNode = (id: string, type: string, data: Record<string, unknown> = {}, extra: Partial<Node> = {}): Node => ({
  id, type, position: { x: 10, y: 20 }, data, ...extra,
})
const edge = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id, source, target, targetHandle: 'data', ...extra })

describe('cloneNodeData', () => {
  it('drops runtime keys and keeps configuration (apiKey included — an in-session copy)', () => {
    const out = cloneNodeData({ inlineQuery: 'roman coin', apiKey: 'k', status: 'success', count: 12, resultsVersion: 3, gisLayers: [{}], rowSelections: {} })
    expect(out).toEqual({ inlineQuery: 'roman coin', apiKey: 'k' })
    expect(RUNTIME_FIELDS.has('resultsVersion')).toBe(true)
  })
  it('deep-copies nested data so the clone never shares an array with the source', () => {
    const src = { filterOps: [{ field: 'title', operator: 'contains', value: 'x' }] }
    const out = cloneNodeData(src)
    expect(out.filterOps).toEqual(src.filterOps)
    expect(out.filterOps).not.toBe(src.filterOps)
  })
})

describe('duplicateNodes', () => {
  it('a single node: new id of the same type prefix, offset, runtime data stripped, selected', () => {
    const n = makeNode('gbifSearch-1', 'gbifSearch', { inlineQ: 'Bufo', status: 'success', count: 3, resultsVersion: 5 },
      { measured: { width: 300, height: 200 }, style: { width: 300 } } as Partial<Node>)
    const { nodes, edges, skipped } = duplicateNodes([n], [], ['gbifSearch-1'])
    expect(nodes).toHaveLength(1)
    const c = nodes[0]
    expect(c.id).toMatch(/^gbifSearch-\d+$/)
    expect(c.id).not.toBe(n.id)
    expect(c.position).toEqual({ x: 10 + DUPLICATE_OFFSET, y: 20 + DUPLICATE_OFFSET })
    expect(c.data).toEqual({ inlineQ: 'Bufo' })
    expect(c.selected).toBe(true)
    expect(c.style).toEqual({ width: 300 })
    expect((c as Node & { measured?: unknown }).measured).toBeUndefined()
    expect(edges).toEqual([])
    expect(skipped).toEqual([])
  })

  it('mints ids outside any updater: calling twice yields different ids', () => {
    const n = makeNode('a', 'comment')
    const a = duplicateNodes([n], [], ['a']).nodes[0].id
    const b = duplicateNodes([n], [], ['a']).nodes[0].id
    expect(a).not.toBe(b)
  })

  it('two connected selected nodes: the edge between them is cloned and remapped', () => {
    const nodes = [makeNode('s', 'gbifSearch'), makeNode('t', 'tableOutput')]
    const edges = [edge('e1', 's', 't', { hidden: false, selected: true })]
    const r = duplicateNodes(nodes, edges, ['s', 't'])
    expect(r.nodes).toHaveLength(2)
    expect(r.edges).toHaveLength(1)
    const [e] = r.edges
    expect(e.id).toMatch(/^edge-\d+$/)
    expect(e.source).toBe(r.nodes[0].id)
    expect(e.target).toBe(r.nodes[1].id)
    expect(e.targetHandle).toBe('data')
    expect(e.selected).toBe(false)
  })

  it('an edge to an unselected neighbour is not copied', () => {
    const nodes = [makeNode('s', 'gbifSearch'), makeNode('t', 'tableOutput')]
    const r = duplicateNodes(nodes, [edge('e1', 's', 't')], ['t'])
    expect(r.nodes.map(n => n.type)).toEqual(['tableOutput'])
    expect(r.edges).toEqual([])
  })

  it('ignores ids that do not exist and de-duplicates the selection', () => {
    const r = duplicateNodes([makeNode('a', 'comment')], [], ['a', 'a', 'ghost'])
    expect(r.nodes).toHaveLength(1)
  })

  describe('groups', () => {
    const group = makeNode('g1', 'group', { name: 'Sources', collapsed: false, childPositions: { k1: { x: 0, y: 0 } }, proxyEdges: [] },
      { position: { x: 100, y: 100 }, style: { width: 400, height: 300 } } as Partial<Node>)
    const k1 = makeNode('k1', 'kclNode', { model: 'arc:nano' }, { parentId: 'g1', extent: 'parent', expandParent: true, position: { x: 20, y: 40 } })
    const k2 = makeNode('k2', 'kclOutput', {}, { parentId: 'g1', extent: 'parent', expandParent: true, position: { x: 220, y: 40 } })
    const outside = makeNode('o', 'tableOutput')
    const edges = [edge('in', 'k1', 'k2'), edge('out', 'k2', 'o')]

    it('a selected group brings all its children once (even when a child is also selected), remaps parentId, keeps relative positions', () => {
      const r = duplicateNodes([group, k1, k2, outside], edges, ['g1', 'k1'])
      expect(r.nodes.map(n => n.type)).toEqual(['group', 'kclNode', 'kclOutput'])   // group first
      const [g, c1, c2] = r.nodes
      expect(g.position).toEqual({ x: 140, y: 140 })
      expect(g.data).toEqual({ name: 'Sources' })                                    // collapse bookkeeping dropped
      expect(c1.parentId).toBe(g.id)
      expect(c2.parentId).toBe(g.id)
      expect(c1.position).toEqual({ x: 20, y: 40 })
      expect(c1.extent).toBe('parent')
      expect(c1.expandParent).toBe(true)
      expect(r.nodes.every(n => n.selected)).toBe(true)
      // only the internal edge
      expect(r.edges).toHaveLength(1)
      expect(r.edges[0].source).toBe(c1.id)
      expect(r.edges[0].target).toBe(c2.id)
    })

    it('a selected child whose group is not selected stays in that group and moves by the offset', () => {
      const r = duplicateNodes([group, k1, k2], edges, ['k1'])
      expect(r.nodes).toHaveLength(1)
      expect(r.nodes[0].parentId).toBe('g1')
      expect(r.nodes[0].position).toEqual({ x: 20 + DUPLICATE_OFFSET, y: 40 + DUPLICATE_OFFSET })
    })

    it('a collapsed group is refused (skipped) along with its hidden children; other seeds still clone', () => {
      const collapsed = { ...group, data: { ...group.data, collapsed: true } }
      const r = duplicateNodes([collapsed, k1, k2, outside], edges, ['g1', 'k1', 'o'])
      expect(r.skipped).toEqual(['g1'])
      expect(r.nodes.map(n => n.type)).toEqual(['tableOutput'])
    })
  })
})
