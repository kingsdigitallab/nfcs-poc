/**
 * runFilterTransformNode.ts — NodeRunner for FilterTransformNode.
 *
 * Reads upstream records from the out-of-band resultsStore (not node data),
 * applies filter and/or transform operations, and writes results back to the
 * store so downstream nodes can read them.
 */

import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { FilterTransformNodeData } from '../nodes/FilterTransformNode'
import { applyFilters, applyTransforms } from './filterTransformUtils'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'

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

  const upstream = collectUpstreamRecords(nodeId, edges) as UnifiedRecord[]

  if (upstream.length === 0) {
    clearNodeResults(nodeId)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ No upstream records',
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

    const version = setNodeResults(nodeId, result as Record<string, unknown>[])
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  `✓ ${upstream.length} → ${result.length}`,
      inputCount:     upstream.length,
      outputCount:    result.length,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[FilterTransform] error', msg)
    clearNodeResults(nodeId)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      inputCount:    upstream.length,
      outputCount:   0,
    })
  }
}
