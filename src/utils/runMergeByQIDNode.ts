import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { ReconciliationResult } from './reconciliationService'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'
import type { MergeByQIDNodeData } from '../nodes/MergeByQIDNode'

function extractQIDInfo(record: UnifiedRecord): { qid: string; label: string } | null {
  const r = record as Record<string, unknown>
  for (const key of Object.keys(r)) {
    if (!key.endsWith('_reconciled')) continue
    const val = r[key] as ReconciliationResult | null
    if (val?.qid && (val.status === 'resolved' || val.status === 'review'))
      return { qid: val.qid, label: val.label ?? val.qid }
  }
  return null
}

const META_KEYS = new Set([
  'id', '_source', '_sourceId', '_sourceUrl', '_pid', '_cached',
  '_capped', '_total', 'count', 'status', 'statusMessage', 'resultsVersion',
])

function mergeGroup(qid: string, label: string, records: UnifiedRecord[]): Record<string, unknown> {
  const sourceCounts = new Map<string, number>()
  const out: Record<string, unknown> = {
    id:           `merged:${qid}`,
    _source:      'merged',
    _qid:         qid,
    title:        label,
    _sourceCount: records.length,
    _sources:     [...new Set(records.map(r => r._source).filter(Boolean))].join(', '),
    _sourceUrl:   `https://www.wikidata.org/wiki/${qid}`,
  }

  for (const rec of records) {
    const r   = rec as Record<string, unknown>
    const src = (rec._source as string | undefined) || 'source'
    const n   = sourceCounts.get(src) ?? 0
    sourceCounts.set(src, n + 1)
    const prefix = n === 0 ? src : `${src}_${n}`

    for (const [k, v] of Object.entries(r)) {
      if (META_KEYS.has(k))           continue
      if (k.endsWith('_reconciled'))  continue
      out[`${prefix}_${k}`] = v
    }
  }

  return out
}

export const runMergeByQIDNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as MergeByQIDNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Merging…', mergedCount: 0, unmatchedCount: 0 })

  try {
    const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
    const allRecords: UnifiedRecord[] = []
    for (const edge of inputEdges) {
      const src = nodes.find(n => n.id === edge.source)
      if (!src) continue
      const recs = getNodeResults(src.id) as UnifiedRecord[] | undefined
      if (recs) allRecords.push(...recs)
    }

    if (allRecords.length === 0) {
      updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records', mergedCount: 0, unmatchedCount: 0 })
      return
    }

    const qidGroups = new Map<string, { label: string; records: UnifiedRecord[] }>()
    const unmatched: UnifiedRecord[] = []

    for (const record of allRecords) {
      const info = extractQIDInfo(record)
      if (info) {
        const existing = qidGroups.get(info.qid)
        if (existing) existing.records.push(record)
        else qidGroups.set(info.qid, { label: info.label, records: [record] })
      } else if (d.keepUnmatched) {
        unmatched.push(record)
      }
    }

    const merged = [...qidGroups.entries()].map(([qid, { label, records }]) =>
      mergeGroup(qid, label, records),
    )

    const results = [...merged, ...(unmatched as unknown as Record<string, unknown>[])]
    const version = setNodeResults(nodeId, results)
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  `✓ ${merged.length} merged, ${unmatched.length} unmatched`,
      mergedCount:    merged.length,
      unmatchedCount: unmatched.length,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    clearNodeResults(nodeId)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, mergedCount: 0, unmatchedCount: 0 })
  }
}
