/**
 * Reads and merges UnifiedRecord[] from ALL upstream nodes connected to the
 * 'data' input handle of the given node.
 *
 * Records are stored out-of-band in resultsStore (not in React Flow node data)
 * to keep React Flow state small. useNodes() still provides the reactivity
 * signal — when any upstream node calls updateNodeData (with a new
 * resultsVersion), this hook re-runs and reads fresh records from the store.
 */
import { useNodes, useEdges } from '@xyflow/react'
import { getNodeResults } from '../store/resultsStore'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export interface UpstreamData {
  records: UnifiedRecord[] | undefined
  /** Sum of count fields from all connected sources */
  count: number
  /** 'loading' if any source is loading; 'success'/'cached' if all done; 'idle' otherwise */
  status: string
  /** True if at least one edge is connected */
  connected: boolean
  /** How many source nodes are connected */
  sourceCount: number
}

export function useUpstreamRecords(nodeId: string): UpstreamData {
  const allNodes = useNodes()
  const allEdges = useEdges()

  const inputEdges = allEdges.filter(e => e.target === nodeId && e.targetHandle === 'data')

  if (inputEdges.length === 0) {
    return { records: undefined, count: 0, status: 'idle', connected: false, sourceCount: 0 }
  }

  const merged: UnifiedRecord[] = []
  let totalCount = 0
  let anyLoading = false
  let anySuccess = false

  for (const edge of inputEdges) {
    const src = allNodes.find(n => n.id === edge.source)
    if (!src) continue
    const d = src.data as Record<string, unknown>

    if (d.status === 'loading') anyLoading = true
    if (d.status === 'success' || d.status === 'cached' || d.status === 'ready') anySuccess = true

    // Read records from the out-of-band store (not from node data)
    const recs = getNodeResults(src.id) as UnifiedRecord[] | undefined
    if (recs) merged.push(...recs)
    totalCount += (d.count as number | undefined) ?? 0
  }

  const status = anyLoading ? 'loading' : anySuccess ? 'success' : 'idle'

  return {
    records:     merged.length > 0 ? merged : undefined,
    count:       totalCount,
    status,
    connected:   true,
    sourceCount: inputEdges.length,
  }
}
