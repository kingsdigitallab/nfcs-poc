/**
 * runFilterTransformNode.ts — NodeRunner for FilterTransformNode.
 *
 * Reads upstream records, applies filter and/or transform operations in order,
 * and writes the result to its own data.results so downstream nodes can read it.
 */

import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { FilterTransformNodeData } from '../nodes/FilterTransformNode'
import { applyFilters, applyTransforms } from './filterTransformUtils'

export const runFilterTransformNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as FilterTransformNodeData

  // ── collect upstream records ───────────────────────────────────────────────
  const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
  const upstream: UnifiedRecord[] = []
  for (const edge of inputEdges) {
    const src  = nodes.find(n => n.id === edge.source)
    const recs = (src?.data as { results?: UnifiedRecord[] })?.results
    if (recs) upstream.push(...recs)
  }

  if (upstream.length === 0) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ No upstream records',
      results:       [],
      inputCount:    0,
      outputCount:   0,
    })
    return
  }

  try {
    let result = upstream

    if (d.mode === 'filter' || d.mode === 'both') {
      result = applyFilters(result, d.filterOps ?? [], d.filterCombinator ?? 'AND')
    }
    if (d.mode === 'transform' || d.mode === 'both') {
      result = applyTransforms(result, d.transformOps ?? [])
    }

    updateNodeData(nodeId, {
      status:        'success',
      statusMessage: `✓ ${upstream.length} → ${result.length}`,
      results:       result,
      inputCount:    upstream.length,
      outputCount:   result.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[FilterTransform] error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      results:       undefined,
      inputCount:    upstream.length,
      outputCount:   0,
    })
  }
}
