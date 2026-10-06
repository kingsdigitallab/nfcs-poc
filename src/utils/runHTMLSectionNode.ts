/**
 * NodeRunner for HTMLSectionNode.
 *
 * Reads upstream records that have a `fetchedHtml` field, applies the node's
 * extraction mode (CSS selector / heading section / Readability — see
 * htmlExtract.ts, shared with the component so Run and Run All agree) and
 * overwrites `fetchedContent`. Records without `fetchedHtml` pass through.
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { extractHtml } from './htmlExtract'

export const runHTMLSectionNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes   = getNodes()
  const self    = nodes.find(n => n.id === nodeId)
  if (!self) return

  const d            = self.data as Record<string, unknown>
  const selector     = (d.selector     as string)  || 'main, article'
  const separator    = (d.separator    as string)  ?? '\n\n'
  const maxLength    = (d.maxLength    as number)  ?? 8000
  const preserveHtml = (d.preserveHtml as boolean) ?? false
  const extractSection = (d.extractSection as boolean) ?? false

  const upstream = collectUpstreamRecords(nodeId, edges)

  if (upstream.length === 0) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records' })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status: 'running', statusMessage: 'Extracting…',
    inputCount: upstream.length, outputCount: 0,
  })

  const enriched: Record<string, unknown>[] = []
  let hitCount  = 0
  let missCount = 0

  for (const record of upstream) {
    const html = typeof record.fetchedHtml === 'string' ? record.fetchedHtml : ''

    if (!html) {
      missCount++
      enriched.push({ ...record, htmlSelector: selector })
      continue
    }

    let extracted = extractHtml(html, { selector, separator, preserveHtml, extractSection })
    if (!extracted) {
      missCount++
      enriched.push({ ...record, fetchedContent: '', htmlSelector: selector })
      continue
    }
    if (extracted.length > maxLength) extracted = extracted.slice(0, maxLength) + '…[truncated]'
    hitCount++
    enriched.push({ ...record, fetchedContent: extracted, htmlSelector: selector })
  }

  const version = setNodeResults(nodeId, enriched)
  updateNodeData(nodeId, {
    status:         missCount > 0 && hitCount === 0 ? 'error' : 'success',
    statusMessage:  `✓ ${hitCount} extracted${missCount > 0 ? `, ${missCount} no match` : ''}`,
    outputCount:    enriched.length,
    inputCount:     upstream.length,
    resultsVersion: version,
  })
}
