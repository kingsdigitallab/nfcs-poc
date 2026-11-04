/**
 * collectSourceTotals — the per-source "n of N retrieved" figure behind Source
 * Profile's completeness bar. Added Nov 2026 when a profile fed through a
 * merging node showed `60 of ?` for ARIADNE and Europeana and mis-labelled the
 * merged record count (160) as HSDS's API total: the node only read `count`
 * from its direct neighbours and keyed it by the first record's `_source`.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { collectSourceTotals } from '../utils/sourceTotals'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

function mkNode(id: string, type: string, data: Record<string, unknown> = {}): Node {
  return { id, type, position: { x: 0, y: 0 }, data }
}
function mkEdge(source: string, target: string, targetHandle = 'data'): Edge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, targetHandle }
}

const ALL_IDS = ['ar1', 'ar2', 'hs1', 'eu1', 'dedup', 'recon', 'profile']
beforeEach(() => { for (const id of ALL_IDS) clearNodeResults(id) })

describe('collectSourceTotals', () => {
  it('sums the API totals of every origin search node per _source, through a merging node', () => {
    const nodes = [
      mkNode('ar1', 'ariadneSearch', { status: 'success', count: 1054 }),
      mkNode('ar2', 'ariadneSearch', { status: 'success', count: 300 }),
      mkNode('hs1', 'hsdsSearch',    { status: 'success', count: 160 }),
      mkNode('dedup', 'deduplicate', { status: 'success', inputCount: 60, outputCount: 58 }),
      mkNode('profile', 'sourceProfile', {}),
    ]
    const edges = [
      mkEdge('ar1', 'dedup'), mkEdge('ar2', 'dedup'), mkEdge('hs1', 'dedup'),
      mkEdge('dedup', 'profile'),
    ]
    setNodeResults('ar1', [{ id: 'a', _source: 'ariadne' }])
    setNodeResults('ar2', [{ id: 'b', _source: 'ariadne' }])
    setNodeResults('hs1', [{ id: 'c', _source: 'hsds' }])
    setNodeResults('dedup', [{ id: 'c', _source: 'hsds' }, { id: 'a', _source: 'ariadne' }])

    const totals = collectSourceTotals('profile', nodes, edges)

    expect(totals.get('ariadne')).toEqual({ total: 1354, searches: 2 })
    expect(totals.get('hsds')).toEqual({ total: 160, searches: 1 })
    expect(totals.has('europeana')).toBe(false)
  })

  it('ignores a non-origin node that also writes count (reconciliation between search and profile)', () => {
    const nodes = [
      mkNode('eu1', 'europeanaSearch', { status: 'success', count: 419 }),
      mkNode('recon', 'reconciliation', { status: 'success', count: 99 }),
      mkNode('profile', 'sourceProfile', {}),
    ]
    const edges = [mkEdge('eu1', 'recon'), mkEdge('recon', 'profile')]
    setNodeResults('eu1',   [{ id: 'e', _source: 'europeana' }])
    setNodeResults('recon', [{ id: 'e', _source: 'europeana' }])

    expect(collectSourceTotals('profile', nodes, edges).get('europeana')).toEqual({ total: 419, searches: 1 })
  })

  it('a search node wired straight in still counts; count 0 or no results contribute nothing', () => {
    const nodes = [
      mkNode('hs1', 'hsdsSearch', { status: 'success', count: 160 }),
      mkNode('ar1', 'ariadneSearch', { status: 'error', count: 0 }),
      mkNode('eu1', 'europeanaSearch', { status: 'success', count: 419 }), // ran, but store empty
      mkNode('profile', 'sourceProfile', {}),
    ]
    const edges = [mkEdge('hs1', 'profile'), mkEdge('ar1', 'profile'), mkEdge('eu1', 'profile')]
    setNodeResults('hs1', [{ id: 'c', _source: 'hsds' }])
    setNodeResults('ar1', [])

    const totals = collectSourceTotals('profile', nodes, edges)
    expect(totals.get('hsds')).toEqual({ total: 160, searches: 1 })
    expect(totals.size).toBe(1)
  })
})
