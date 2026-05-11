import type { Node, Edge } from '@xyflow/react'
import type { MapOutputNodeData } from '../nodes/MapOutputNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export const runMapOutputNode = async (
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
) => {
  const nodes = getNodes()
  const own   = nodes.find(n => n.id === nodeId)
  const data  = own?.data as MapOutputNodeData | undefined

  try {
    const bbox     = data?.bbox ?? null
    const upstream = collectUpstreamRecords(nodeId, edges) as UnifiedRecord[]

    const output = bbox
      ? upstream.filter(r =>
          r.decimalLatitude  != null &&
          r.decimalLongitude != null &&
          +r.decimalLatitude  >= bbox.south &&
          +r.decimalLatitude  <= bbox.north &&
          +r.decimalLongitude >= bbox.west  &&
          +r.decimalLongitude <= bbox.east,
        )
      : upstream

    const version = setNodeResults(nodeId, output as Record<string, unknown>[])
    updateNodeData(nodeId, {
      inputCount:     upstream.length,
      outputCount:    output.length,
      resultsVersion: version,
    })
  } catch (err) {
    clearNodeResults(nodeId)
    updateNodeData(nodeId, {
      inputCount:  data?.inputCount  ?? 0,
      outputCount: 0,
    })
  }
}
