import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import type { XMLSectionNodeData } from '../nodes/XMLSectionNode'

function extractByXPath(
  xmlText: string,
  xpath: string,
  outputMode: 'text' | 'xml',
): string {
  try {
    // Strip default namespace declarations — document.evaluate fails on namespaced XML
    const stripped = xmlText.replace(/\sxmlns="[^"]*"/g, '')
    const parser = new DOMParser()
    const doc    = parser.parseFromString(stripped, 'application/xml')

    const parseErr = doc.querySelector('parsererror')
    if (parseErr) return ''

    if (outputMode === 'text') {
      const result = document.evaluate(
        xpath, doc, null, XPathResult.STRING_TYPE, null,
      )
      return (result.stringValue ?? '').replace(/\s+/g, ' ').trim()
    }

    const snapshot = document.evaluate(
      xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null,
    )
    const serializer = new XMLSerializer()
    const parts: string[] = []
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i)
      if (node) parts.push(serializer.serializeToString(node))
    }
    return parts.join('\n')
  } catch {
    return ''
  }
}

export const runXMLSectionNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const self  = nodes.find(n => n.id === nodeId)
  if (!self) return

  const d          = self.data as XMLSectionNodeData
  const xpath      = d.xpath?.trim() || ''
  const outputMode = d.outputMode ?? 'text'
  const maxLength  = d.maxLength  ?? 8000

  if (!xpath) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ Enter an XPath expression' })
    return
  }

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
    const xmlText = typeof record.content === 'string' ? record.content : ''

    if (!xmlText) {
      missCount++
      enriched.push({ ...record, xmlXPath: xpath })
      continue
    }

    let extracted = extractByXPath(xmlText, xpath, outputMode)
    if (!extracted) {
      missCount++
      enriched.push({ ...record, xmlContent: '', xmlXPath: xpath })
      continue
    }
    if (extracted.length > maxLength) extracted = extracted.slice(0, maxLength) + '…[truncated]'
    hitCount++
    enriched.push({ ...record, xmlContent: extracted, xmlXPath: xpath })
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
