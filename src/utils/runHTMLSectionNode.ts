/**
 * NodeRunner for HTMLSectionNode.
 *
 * Reads upstream records that have a `fetchedHtml` field, applies the user's
 * CSS selector via DOMParser, and overwrites `fetchedContent` with the extracted
 * text. Records without `fetchedHtml` are passed through unchanged.
 */

import type { Node, Edge } from '@xyflow/react'
import type { NodeRunner } from './nodeRunners'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

function extractBySelector(html: string, selector: string, separator: string): string {
  try {
    const parser = new DOMParser()
    const doc    = parser.parseFromString(html, 'text/html')
    const els    = doc.querySelectorAll(selector)
    if (els.length === 0) return ''
    return Array.from(els)
      .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(separator)
  } catch {
    return ''
  }
}

export const runHTMLSectionNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes   = getNodes()
  const self    = nodes.find(n => n.id === nodeId)
  if (!self) return

  const d         = self.data as Record<string, unknown>
  const selector  = (d.selector  as string)  || 'main, article'
  const separator = (d.separator as string)  ?? '\n\n'
  const maxLength = (d.maxLength as number)  ?? 8000

  // Gather upstream records
  const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
  const upstream: Record<string, unknown>[] = []
  for (const edge of inputEdges) {
    const src  = nodes.find(n => n.id === edge.source)
    if (!src) continue
    const recs = getNodeResults(src.id)
    if (recs) upstream.push(...recs)
  }

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

    let text = extractBySelector(html, selector, separator)
    if (!text) {
      missCount++
      enriched.push({ ...record, fetchedContent: '', htmlSelector: selector })
      continue
    }
    if (text.length > maxLength) text = text.slice(0, maxLength) + '…[truncated]'
    hitCount++
    enriched.push({ ...record, fetchedContent: text, htmlSelector: selector })
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
