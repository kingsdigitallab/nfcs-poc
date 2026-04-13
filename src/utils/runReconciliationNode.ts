/**
 * runReconciliationNode.ts — NodeRunner for ReconciliationNode.
 *
 * Processing nodes sit between source and output nodes in the workflow.
 * They read upstream `data.results`, transform the records, and write
 * augmented records back to their own `data.results` so downstream output
 * nodes (Table, Map, Timeline, JSON) can read them via useUpstreamRecords.
 *
 * Runners MUST NOT throw. Own all error handling.
 */

import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import {
  reconcileField,
  authoritiesForField,
  type AuthorityConfig,
} from './reconciliationService'
import type { ReconciliationNodeData } from '../nodes/ReconciliationNode'

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

  const fieldName  = d.selectedField
  const threshold  = d.confidenceThreshold ?? 0.8

  if (!fieldName) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ Select a field to reconcile',
    })
    return
  }

  // ── Collect upstream records (same logic as useUpstreamRecords hook) ───────
  const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
  const upstream: UnifiedRecord[] = []
  for (const edge of inputEdges) {
    const src  = nodes.find(n => n.id === edge.source)
    const recs = (src?.data as { results?: UnifiedRecord[] })?.results
    if (recs) upstream.push(...recs)
  }

  if (upstream.length === 0) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ No upstream records',
      results:       [],
      count:         0,
    })
    return
  }

  // Resolve authority config from stored value
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

  updateNodeData(nodeId, {
    status:        'loading',
    statusMessage: `Reconciling ${upstream.length} records…`,
    results:       undefined,
    count:         0,
    resolvedCount: 0,
    reviewCount:   0,
  })

  try {
    const augmented = await reconcileField(upstream, fieldName, authority, threshold)

    // Tally resolved vs review
    const reconciledKey = `${fieldName}_reconciled`
    let resolved = 0, review = 0
    for (const r of augmented as unknown as Record<string, unknown>[]) {
      const rec = r[reconciledKey] as { status?: string } | null
      if (rec?.status === 'resolved') resolved++
      else if (rec?.status === 'review') review++
    }

    console.log(`[Reconciliation] ${fieldName} → ${authority.label}: ${resolved} resolved, ${review} for review`)

    updateNodeData(nodeId, {
      status:        'success',
      statusMessage: `✓ ${resolved} resolved · ${review} for review`,
      results:       augmented,
      count:         augmented.length,
      resolvedCount: resolved,
      reviewCount:   review,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reconciliation] error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      results:       undefined,
      count:         0,
      resolvedCount: 0,
      reviewCount:   0,
    })
  }
}
