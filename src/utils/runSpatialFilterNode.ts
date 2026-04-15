import type { Node, Edge } from '@xyflow/react'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { SpatialFilterNodeData } from '../nodes/SpatialFilterNode'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

export const runSpatialFilterNode = async (
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
) => {
  const nodes = getNodes()
  const own   = nodes.find(n => n.id === nodeId)
  const data  = own?.data as SpatialFilterNodeData | undefined

  try {
    const bbox = data?.bbox

    // Collect upstream records from the out-of-band store
    const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
    const upstream: UnifiedRecord[] = []
    for (const e of inputEdges) {
      const src  = nodes.find(n => n.id === e.source)
      if (!src) continue
      const recs = getNodeResults(src.id) as UnifiedRecord[] | undefined
      if (recs) upstream.push(...recs)
    }

    if (!bbox) {
      // Pass through unchanged when no bbox is drawn
      const version = setNodeResults(nodeId, upstream as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status:         'idle',
        statusMessage:  'No bounding box drawn',
        inputCount:     upstream.length,
        outputCount:    upstream.length,
        resultsVersion: version,
      })
      return
    }

    const filtered = upstream.filter(r =>
      r.decimalLatitude  != null &&
      r.decimalLongitude != null &&
      +r.decimalLatitude  >= bbox.south &&
      +r.decimalLatitude  <= bbox.north &&
      +r.decimalLongitude >= bbox.west  &&
      +r.decimalLongitude <= bbox.east,
    )

    const version = setNodeResults(nodeId, filtered as Record<string, unknown>[])
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  `${filtered.length} of ${upstream.length} records in bbox`,
      inputCount:     upstream.length,
      outputCount:    filtered.length,
      resultsVersion: version,
    })
  } catch (err) {
    clearNodeResults(nodeId)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `Error: ${err instanceof Error ? err.message : String(err)}`,
      inputCount:    data?.inputCount ?? 0,
      outputCount:   0,
    })
  }
}
