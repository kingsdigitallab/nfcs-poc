import type { Node, Edge } from '@xyflow/react'
import type { TimelineOutputNodeData } from '../nodes/TimelineOutputNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { resolveRecordYear } from './dateUtils'

export async function runTimelineViewNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const own   = nodes.find(n => n.id === nodeId)
  const d     = own?.data as TimelineOutputNodeData | undefined

  clearNodeResults(nodeId)

  try {
    const upstream  = collectUpstreamRecords(nodeId, edges) as UnifiedRecord[]
    const start     = d?.filterStart ?? null
    const end       = d?.filterEnd   ?? null
    const dateField = (d?.dateField as string | undefined) || undefined   // same resolution as the component
    const lo       = start !== null && end !== null ? Math.min(start, end) : start
    const hi       = start !== null && end !== null ? Math.max(start, end) : end

    const filtered = (lo === null && hi === null)
      ? upstream
      : upstream.filter(r => {
          const year = resolveRecordYear(r, dateField)?.year ?? null
          if (year === null) return false
          if (lo !== null && year < lo) return false
          if (hi !== null && year > hi) return false
          return true
        })

    const version = setNodeResults(nodeId, filtered as Record<string, unknown>[])
    updateNodeData(nodeId, {
      filterCount:    filtered.length,
      totalCount:     upstream.length,
      resultsVersion: version,
      status:         'success',
      statusMessage:  (lo !== null || hi !== null)
        ? `${filtered.length} of ${upstream.length} in range`
        : `${upstream.length} records`,
    })
  } catch (err) {
    clearNodeResults(nodeId)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `Error: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}
