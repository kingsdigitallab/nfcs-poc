/**
 * runReconciliationNode.ts — NodeRunner for ReconciliationNode.
 *
 * Reads upstream records from the out-of-band resultsStore, reconciles the
 * chosen field against a Wikidata authority, and writes augmented records back
 * to the store. Runners MUST NOT throw.
 */

import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import {
  reconcileField,
  authoritiesForField,
  type AuthorityConfig,
} from './reconciliationService'
import type { ReconciliationNodeData } from '../nodes/ReconciliationNode'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

export const runReconciliationNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as ReconciliationNodeData

  const fieldName = d.selectedField
  const threshold = d.confidenceThreshold ?? 0.8

  if (!fieldName) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ Select a field to reconcile',
    })
    return
  }

  // Collect upstream records from the out-of-band store
  const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
  const upstream: UnifiedRecord[] = []
  for (const edge of inputEdges) {
    const src  = nodes.find(n => n.id === edge.source)
    if (!src) continue
    const recs = getNodeResults(src.id) as UnifiedRecord[] | undefined
    if (recs) upstream.push(...recs)
  }

  if (upstream.length === 0) {
    clearNodeResults(nodeId)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ No upstream records',
      count:         0,
    })
    return
  }

  const authorities    = authoritiesForField(fieldName)
  const authorityValue = d.selectedAuthority || authorities[0]?.value
  const authority: AuthorityConfig = authorities.find(a => a.value === authorityValue)
    ?? authorities[0]

  if (authority.comingSoon) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${authority.label} not yet implemented`,
    })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status:        'loading',
    statusMessage: `Reconciling ${upstream.length} records…`,
    count:         0,
    resolvedCount: 0,
    reviewCount:   0,
  })

  try {
    const augmented = await reconcileField(upstream, fieldName, authority, threshold)

    const reconciledKey = `${fieldName}_reconciled`
    let resolved = 0, review = 0
    for (const r of augmented as unknown as Record<string, unknown>[]) {
      const rec = r[reconciledKey] as { status?: string } | null
      if (rec?.status === 'resolved') resolved++
      else if (rec?.status === 'review') review++
    }

    console.log(`[Reconciliation] ${fieldName} → ${authority.label}: ${resolved} resolved, ${review} for review`)

    const version = setNodeResults(nodeId, augmented as unknown as Record<string, unknown>[])
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  `✓ ${resolved} resolved · ${review} for review`,
      count:          augmented.length,
      resolvedCount:  resolved,
      reviewCount:    review,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reconciliation] error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      count:         0,
      resolvedCount: 0,
      reviewCount:   0,
    })
  }
}
