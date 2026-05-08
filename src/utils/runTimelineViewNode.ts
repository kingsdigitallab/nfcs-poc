import type { Node, Edge } from '@xyflow/react'
import type { TimelineOutputNodeData } from '../nodes/TimelineOutputNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import type { UnifiedRecord } from '../types/UnifiedRecord'

function toYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  if (/^-\d+$/.test(s)) return parseInt(s, 10)
  const bce = /(\d+)\s*(?:BCE|B\.C\.E\.?|BC|B\.C\.)/i.exec(s)
  if (bce) return -parseInt(bce[1], 10)
  const m = /\b(\d{4})\b/.exec(s)
  if (m) { const n = parseInt(m[1], 10); if (n >= 0 && n <= 2200) return n }
  const m3 = /\b(\d{3})\b/.exec(s)
  if (m3) return parseInt(m3[1], 10)
  return null
}

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
    const upstream = collectUpstreamRecords(nodeId, edges) as UnifiedRecord[]
    const start    = d?.filterStart ?? null
    const end      = d?.filterEnd   ?? null
    const lo       = start !== null && end !== null ? Math.min(start, end) : start
    const hi       = start !== null && end !== null ? Math.max(start, end) : end

    const filtered = (lo === null && hi === null)
      ? upstream
      : upstream.filter(r => {
          const year = toYear(r.date as string | undefined) ?? toYear(r.eventDate as string | undefined) ?? null
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
