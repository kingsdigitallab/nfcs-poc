/**
 * Reads and merges UnifiedRecord[] from ALL upstream nodes connected to the
 * 'data' input handle of the given node.
 *
 * Supporting multiple sources (e.g. GBIFSearchNode + LLDSSearchNode both wired
 * to the same TableOutputNode) is handled here automatically — output nodes
 * need no knowledge of how many sources feed them.
 *
 * Reactivity: both useNodes() and useEdges() re-render this hook's consumer
 * whenever any node data or edge changes, so output nodes update automatically
 * when an upstream node finishes running.
 */
import { useNodes, useEdges } from '@xyflow/react'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export interface UpstreamData {
  records: UnifiedRecord[] | undefined
  /** Sum of count fields from all connected sources */
  count: number
  /** 'loading' if any source is loading; 'success' / 'cached' if all done; 'idle' otherwise */
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
    if (d.status === 'success' || d.status === 'cached') anySuccess = true

    const recs = d.results as UnifiedRecord[] | undefined
    if (recs) merged.push(...recs)
    totalCount += (d.count as number | undefined) ?? 0
  }

  const status = anyLoading ? 'loading' : anySuccess ? 'success' : 'idle'

  return {
    records: merged.length > 0 ? merged : undefined,
    count: totalCount,
    status,
    connected: true,
    sourceCount: inputEdges.length,
  }
}
