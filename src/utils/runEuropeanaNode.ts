import type { Node, Edge } from '@xyflow/react'
import {
  adaptEuropeanaResponse,
  type EuropeanaSearchResponse,
  type EuropeanaItem,
} from './europeanaAdapter'
import type { EuropeanaSearchNodeData } from '../nodes/EuropeanaSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'

const EUROPEANA_API = 'https://api.europeana.eu/record/v2/search.json'
const PAGE_SIZE     = 100   // Europeana hard cap per request
const MAX_TOTAL     = 1000  // Practical ceiling — avoids runaway requests

export async function runEuropeanaNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as EuropeanaSearchNodeData

  const resolve = (handleId: string, dataKey: keyof EuropeanaSearchNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const apiKey = resolve('apiKey', 'apiKey').trim()
  const query  = resolve('query', 'inlineQuery').trim()
  const limit  = Math.min(
    MAX_TOTAL,
    Math.max(1, parseInt(resolve('limit', 'inlineLimit') || '20', 10) || 20),
  )

  if (!apiKey) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ API key required — register at apis.europeana.eu', count: 0 })
    return
  }
  if (!query) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ Query is required', count: 0 })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Searching Europeana…', count: 0 })

  try {
    const allItems: EuropeanaItem[] = []
    let cursor       = '*'
    let totalResults = 0

    while (allItems.length < limit) {
      const pageRows = Math.min(PAGE_SIZE, limit - allItems.length)

      const params = new URLSearchParams({
        wskey:   apiKey,
        query,
        rows:    String(pageRows),
        profile: 'rich',
        cursor,
      })

      if (d.typeFilter && d.typeFilter !== 'any') params.set('qf', `TYPE:${d.typeFilter}`)
      if (d.reusability && d.reusability !== 'any') params.set('reusability', d.reusability)
      if (d.mediaOnly) params.set('media', 'true')

      const res = await fetch(`${EUROPEANA_API}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`)
      }

      const json = await res.json() as EuropeanaSearchResponse

      if (!json.success) {
        throw new Error(json.error ?? 'Europeana returned success:false')
      }

      totalResults = json.totalResults ?? totalResults
      const items  = json.items ?? []
      allItems.push(...items)

      // Break conditions: no more pages, or result set exhausted, or no cursor
      if (items.length < pageRows || !json.nextCursor || allItems.length >= limit) break

      cursor = json.nextCursor

      // Show progress while fetching subsequent pages
      updateNodeData(nodeId, {
        statusMessage: `Fetching… ${allItems.length} / ${Math.min(limit, totalResults).toLocaleString()}`,
      })
    }

    const records = addCitation(adaptEuropeanaResponse(allItems) as Record<string, unknown>[], {
      service:    'Europeana',
      serviceUrl: 'https://www.europeana.eu',
      publisher:  'Europeana Foundation',
      query,
      accessDate: new Date().toISOString(),
    })

    const capped = allItems.length < totalResults
    const msg    = capped
      ? `⚠ ${allItems.length.toLocaleString()} of ${totalResults.toLocaleString()} (capped at ${limit})`
      : `✓ ${allItems.length.toLocaleString()} of ${totalResults.toLocaleString()}`

    const version = setNodeResults(nodeId, records)
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  msg,
      count:          totalResults,
      _capped:        capped,
      _total:         totalResults,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Europeana] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
