import type { Node, Edge } from '@xyflow/react'
import { adaptADSResponse, type ADSSearchResponse } from './adsAdapter'
import type { ADSSearchNodeData } from '../nodes/ADSSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

// Dev proxy — see vite.config.ts
const ADS_SEARCH = '/ads-proxy/data-catalogue-api/api/search'

// The ADS API enforces a hard limit of 50 records per request.
// Pagination is driven by the `from` (offset) parameter.
const PAGE_SIZE        = 50
const FETCH_TIMEOUT_MS = 30_000

async function fetchADS(query: string, size: number, from = 0): Promise<ADSSearchResponse> {
  const params = new URLSearchParams({ q: query, size: String(size), from: String(from) })
  const url = `${ADS_SEARCH}?${params}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    console.log('[ADS] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const json = await res.json() as ADSSearchResponse
    console.log(`[ADS] from=${from} total=${json.total?.value} hits=${json.hits?.length}`)
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

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

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
  const limit    = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, PAGE_SIZE)
  const fetchAll = d.fetchAll ?? false

  try {
    if (fetchAll) {
      // Step 1 — probe for total with a single-record request
      updateNodeData(nodeId, { statusMessage: 'Probing total…' })
      const probe = await fetchADS(query, 1, 0)
      const total = probe.total?.value ?? 0

      if (total === 0) {
        const version = setNodeResults(nodeId, [])
        updateNodeData(nodeId, {
          status: 'success', statusMessage: '✓ 0 results', count: 0, resultsVersion: version,
        })
        return
      }

      const pageCount = Math.ceil(total / PAGE_SIZE)
      const allRecords: ReturnType<typeof adaptADSResponse> = []

      // Step 2 — paginate through all records
      for (let page = 0; page < pageCount; page++) {
        const from = page * PAGE_SIZE
        updateNodeData(nodeId, {
          statusMessage: `Page ${page + 1} of ${pageCount} (${allRecords.length} fetched)…`,
        })
        const response = await fetchADS(query, PAGE_SIZE, from)
        const batch    = adaptADSResponse(response)
        allRecords.push(...batch)
        if (batch.length < PAGE_SIZE) break
      }

      const version = setNodeResults(nodeId, allRecords as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status:         'success',
        statusMessage:  `✓ ${allRecords.length.toLocaleString()} of ${total.toLocaleString()}`,
        count:          total,
        resultsVersion: version,
      })
    } else {
      // Single request, bounded by limit
      const response = await fetchADS(query, limit, 0)
      const results  = adaptADSResponse(response)
      const total    = response.total?.value ?? results.length

      const version = setNodeResults(nodeId, results as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status:         'success',
        statusMessage:  `✓ ${results.length} of ${total.toLocaleString()}`,
        count:          total,
        resultsVersion: version,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ADS] error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      count:         0,
    })
  }
}
