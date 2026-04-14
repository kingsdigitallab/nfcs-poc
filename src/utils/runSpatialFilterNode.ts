import { Node, Edge } from '@xyflow/react'
import { UnifiedRecord } from '../types/UnifiedRecord'
import { SpatialFilterNodeData } from '../nodes/SpatialFilterNode'

export const runSpatialFilterNode = async (
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
) => {
  const nodes = getNodes()
  const own = nodes.find(n => n.id === nodeId)
  const data = own?.data as SpatialFilterNodeData | undefined

  try {
    const bbox = data?.bbox

    // Collect upstream records
    const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
    const upstream: UnifiedRecord[] = []

    for (const e of inputEdges) {
      const src = nodes.find(n => n.id === e.source)
      const recs = src?.data?.results as UnifiedRecord[] | undefined
      if (recs) upstream.push(...recs)
    }

    if (!bbox) {
      updateNodeData(nodeId, {
        status: 'idle',
        statusMessage: 'No bounding box drawn',
        results: upstream,
        inputCount: upstream.length,
        outputCount: upstream.length,
      })
      return
    }

    // Filter by bounding box
    const filtered = upstream.filter(r =>
      r.decimalLatitude != null &&
      r.decimalLongitude != null &&
      +r.decimalLatitude >= bbox.south &&
      +r.decimalLatitude <= bbox.north &&
      +r.decimalLongitude >= bbox.west &&
      +r.decimalLongitude <= bbox.east,
    )

    updateNodeData(nodeId, {
      status: 'success',
      statusMessage: `${filtered.length} of ${upstream.length} records in bbox`,
      results: filtered,
      inputCount: upstream.length,
      outputCount: filtered.length,
    })
  } catch (err) {
    updateNodeData(nodeId, {
      status: 'error',
      statusMessage: `Error: ${err instanceof Error ? err.message : String(err)}`,
      results: undefined,
      inputCount: data?.inputCount ?? 0,
      outputCount: 0,
    })
  }
}
