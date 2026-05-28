import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { ReconciliationResult } from './reconciliationService'
import { isReconciledArray } from './reconciliationService'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import type { WikidataEnrichNodeData } from '../nodes/WikidataEnrichNode'
import { fetchWikidataProperties, PROPERTY_FIELD_NAMES } from './wikidataApi'

function getQID(record: UnifiedRecord, reconcileField: string): string | null {
  const r = record as Record<string, unknown>
  if (reconcileField) {
    const val = r[reconcileField]
    // _qid on merged records is a plain string; *_reconciled fields are objects
    if (typeof val === 'string' && val.startsWith('Q')) return val
    // array-valued reconciled field — return first available QID
    if (isReconciledArray(val)) return val.find(x => x.qid)?.qid ?? null
    return (val as ReconciliationResult | null)?.qid ?? null
  }
  // Auto-detect: prefer plain _qid, then fall back to first reconciled object
  if (typeof r['_qid'] === 'string') return r['_qid'] as string
  for (const k of Object.keys(r)) {
    if (!k.endsWith('_reconciled')) continue
    const val = r[k]
    if (isReconciledArray(val)) {
      const qid = val.find(x => x.qid)?.qid
      if (qid) return qid
    } else {
      const single = val as ReconciliationResult | null
      if (single?.qid) return single.qid
    }
  }
  return null
}

export const runWikidataEnrichNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as WikidataEnrichNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Fetching from Wikidata…', count: 0 })

  try {
    const allRecords = collectUpstreamRecords(nodeId, edges) as UnifiedRecord[]

    if (allRecords.length === 0) {
      updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records', count: 0 })
      return
    }

    const properties = [
      ...d.selectedProperties,
      ...d.customProperties.split(',').map(p => p.trim()).filter(p => /^P\d+$/.test(p)),
    ]

    if (properties.length === 0) {
      updateNodeData(nodeId, { status: 'error', statusMessage: '✗ Select at least one property', count: 0 })
      return
    }

    const qidSet = new Set<string>()
    for (const rec of allRecords) {
      const qid = getQID(rec, d.reconcileField)
      if (qid) qidSet.add(qid)
    }

    if (qidSet.size === 0) {
      updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No reconciled QIDs found', count: 0 })
      return
    }

    updateNodeData(nodeId, { statusMessage: `Fetching ${qidSet.size} entities…` })

    const enrichments = await fetchWikidataProperties([...qidSet], properties)

    const enriched = allRecords.map(rec => {
      const qid   = getQID(rec, d.reconcileField)
      const props = qid ? enrichments.get(qid) : undefined
      if (!props) return rec as unknown as Record<string, unknown>

      const additions: Record<string, unknown> = {}
      for (const [propId, value] of Object.entries(props))
        additions[`wd_${PROPERTY_FIELD_NAMES[propId] ?? propId}`] = value

      return { ...(rec as unknown as Record<string, unknown>), ...additions }
    })

    const version = setNodeResults(nodeId, enriched)
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  `✓ ${qidSet.size} entities, ${enriched.length} records`,
      count:          enriched.length,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    clearNodeResults(nodeId)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
