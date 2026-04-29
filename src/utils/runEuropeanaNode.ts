import type { Node, Edge } from '@xyflow/react'
import { adaptEuropeanaResponse, type EuropeanaSearchResponse } from './europeanaAdapter'
import type { EuropeanaSearchNodeData } from '../nodes/EuropeanaSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'

const EUROPEANA_API = 'https://api.europeana.eu/record/v2/search.json'
const MAX_ROWS      = 100

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

  const apiKey = (d.apiKey as string | undefined)?.trim() ?? ''
  const query  = resolve('query', 'inlineQuery').trim()
  const rows   = Math.min(
    MAX_ROWS,
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
    const params = new URLSearchParams({
      wskey:   apiKey,
      query,
      rows:    String(rows),
      profile: 'rich',
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

    const items   = json.items ?? []
    const total   = json.totalResults ?? items.length
    const records = addCitation(adaptEuropeanaResponse(items) as Record<string, unknown>[], {
      service:    'Europeana',
      serviceUrl: 'https://www.europeana.eu',
      publisher:  'Europeana Foundation',
      query,
      accessDate: new Date().toISOString(),
    })

    const capped = items.length < total
    const msg = capped
      ? `⚠ ${items.length} of ${total.toLocaleString()} (capped at ${rows})`
      : `✓ ${items.length} of ${total.toLocaleString()}`

    const version = setNodeResults(nodeId, records)
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  msg,
      count:          total,
      _capped:        capped,
      _total:         total,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Europeana] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
