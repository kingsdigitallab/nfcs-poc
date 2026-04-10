import type { Node, Edge } from '@xyflow/react'
import { adaptADSResponse, type ADSSearchResponse } from './adsAdapter'
import type { ADSSearchNodeData } from '../nodes/ADSSearchNode'

// Dev proxy — see vite.config.ts
const ADS_SEARCH = '/ads-proxy/data-catalogue-api/api/search'
const FETCH_TIMEOUT_MS = 15_000

async function fetchADS(query: string, size: number): Promise<ADSSearchResponse> {
  const url = `${ADS_SEARCH}?${new URLSearchParams({ q: query, size: String(size) })}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    console.log('[ADS] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const json = await res.json() as ADSSearchResponse
    console.log(`[ADS] total=${json.total?.value} hits=${json.hits?.length}`, json)
    return json
  } finally {
    clearTimeout(timer)
  }
}

export async function runADSNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as ADSSearchNodeData

  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', results: undefined, count: 0 })

  // Resolve wired-or-inline params (ParamNode connection wins over inline field)
  const resolve = (handleId: string, dataKey: keyof ADSSearchNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const query    = resolve('query', 'inlineQuery')
  const rawLimit = parseInt(resolve('limit', 'inlineLimit') || '20', 10)
  const limit    = isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit

  try {
    const response = await fetchADS(query, limit)
    const results  = adaptADSResponse(response)
    const total    = response.total?.value ?? results.length

    updateNodeData(nodeId, {
      status:        'success',
      statusMessage: `✓ ${total.toLocaleString()} results`,
      results,
      count: total,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ADS] error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      results:       undefined,
      count:         0,
    })
  }
}
