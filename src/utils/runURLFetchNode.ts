import type { Node, Edge } from '@xyflow/react'
import type { NodeRunner } from './nodeRunners'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

const NOISE_SELECTORS = 'script, style, nav, footer, header, aside, noscript, iframe, [aria-hidden="true"]'

function processHtml(html: string): { text: string; bodyHtml: string } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    doc.querySelectorAll(NOISE_SELECTORS).forEach(el => el.remove())
    const bodyHtml = doc.body?.innerHTML ?? ''
    const text     = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return { text, bodyHtml }
  } catch {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return { text, bodyHtml: html }
  }
}

function getUpstreamRecords(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
): Record<string, unknown>[] {
  const nodes = getNodes()
  const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
  const out: Record<string, unknown>[] = []
  for (const edge of inputEdges) {
    const src = nodes.find(n => n.id === edge.source)
    if (!src) continue
    const recs = getNodeResults(src.id)
    if (recs) out.push(...recs)
  }
  return out
}

export const runURLFetchNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d            = node.data as Record<string, unknown>
  const urlField     = (d.urlField  as string | undefined)  ?? '_sourceUrl'
  const maxLength    = (d.maxLength as number | undefined)  ?? 8000
  const timeoutSecs  = (d.timeoutSecs as number | undefined) ?? 10
  const renderJs     = (d.renderJs  as boolean | undefined) ?? false
  const waitStrategy = (d.waitStrategy as string | undefined) ?? 'networkidle2'

  const upstreamRecords = getUpstreamRecords(nodeId, getNodes, edges)

  if (upstreamRecords.length === 0) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records' })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status: 'running',
    statusMessage: `Fetching 0/${upstreamRecords.length}…`,
    inputCount: upstreamRecords.length,
    outputCount: 0,
  })

  const enriched: Record<string, unknown>[] = []
  let okCount  = 0
  let errCount = 0

  for (let i = 0; i < upstreamRecords.length; i++) {
    const record = upstreamRecords[i]
    const rawUrl = String(record[urlField] ?? '').trim()

    updateNodeData(nodeId, { statusMessage: `Fetching ${i + 1}/${upstreamRecords.length}…` })

    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      enriched.push({
        ...record,
        fetchedUrl:     rawUrl,
        fetchedContent: '',
        fetchStatus:    'no-url',
        fetchedAt:      new Date().toISOString(),
      })
      updateNodeData(nodeId, { outputCount: enriched.length })
      continue
    }

    try {
      const clientTimeout = renderJs ? 60_000 : timeoutSecs * 1000
      const proxyUrl = `/url-proxy?url=${encodeURIComponent(rawUrl)}`
        + (renderJs ? `&js=true&wait=${waitStrategy}` : '')

      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(clientTimeout) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const contentType = res.headers.get('content-type') ?? ''
      const rawText = await res.text()

      let fetchedContent: string
      let fetchedHtml: string | undefined

      const isHtml = contentType.includes('html') || rawText.trimStart().startsWith('<')
      if (isHtml) {
        const processed = processHtml(rawText)
        fetchedHtml    = processed.bodyHtml
        fetchedContent = processed.text
      } else {
        fetchedContent = rawText
      }

      if (fetchedContent.length > maxLength) {
        fetchedContent = fetchedContent.slice(0, maxLength) + '…[truncated]'
      }

      enriched.push({
        ...record,
        fetchedUrl:     rawUrl,
        fetchedContent,
        ...(fetchedHtml !== undefined ? { fetchedHtml } : {}),
        fetchStatus:    'ok',
        fetchedAt:      new Date().toISOString(),
      })
      okCount++
    } catch (err) {
      errCount++
      const msg = err instanceof Error ? err.message : String(err)
      enriched.push({
        ...record,
        fetchedUrl:     rawUrl,
        fetchedContent: '',
        fetchStatus:    `error: ${msg}`,
        fetchedAt:      new Date().toISOString(),
      })
    }

    updateNodeData(nodeId, { outputCount: enriched.length })
  }

  const version = setNodeResults(nodeId, enriched)
  updateNodeData(nodeId, {
    status:         errCount > 0 && okCount === 0 ? 'error' : 'success',
    statusMessage:  `✓ ${okCount} fetched${errCount > 0 ? `, ${errCount} errors` : ''}`,
    outputCount:    enriched.length,
    resultsVersion: version,
  })
}
