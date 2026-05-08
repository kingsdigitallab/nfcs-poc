import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { DeduplicateNodeData } from '../nodes/DeduplicateNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'

export const runDeduplicateNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const node = getNodes().find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as DeduplicateNodeData
  const upstream = collectUpstreamRecords(nodeId, edges) as UnifiedRecord[]

  if (upstream.length === 0) {
    clearNodeResults(nodeId)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ No upstream records',
      inputCount:    0,
      outputCount:   0,
      removedCount:  0,
    })
    return
  }

  updateNodeData(nodeId, { status: 'running', statusMessage: '…' })

  const dedupeField = d.dedupeField || 'id'
  const seen = new Set<string>()
  const unique: UnifiedRecord[] = []

  for (const record of upstream) {
    const raw = record[dedupeField as keyof UnifiedRecord] as unknown
    if (raw == null || raw === '') {
      unique.push(record)
      continue
    }
    const key = String(raw)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(record)
    }
  }

  clearNodeResults(nodeId)
  const version = setNodeResults(nodeId, unique)
  const removed = upstream.length - unique.length

  updateNodeData(nodeId, {
    status:         'success',
    statusMessage:  `✓ ${unique.length} unique`,
    inputCount:     upstream.length,
    outputCount:    unique.length,
    removedCount:   removed,
    resultsVersion: version,
  })
}
