import type { Node, Edge } from '@xyflow/react'
import { loadCache, saveCache, isCacheStale, type DSpaceItem } from './lldsCache'
import { adaptLLDSItem, matchesQuery, matchesLanguage } from './lldsAdapter'
import type { LLDSSearchNodeData } from '../nodes/LLDSSearchNode'

// In dev, requests are routed through the Vite proxy (vite.config.ts) which
// forwards them server-side — no CORS header needed.
// In production, replace with a real proxy URL (e.g. '/api/llds-proxy').
const LLDS_REST = '/llds-proxy/rest'
const FETCH_TIMEOUT_MS = 15_000
// Fetch more than the user limit since we filter client-side
const CLIENT_FILTER_MULTIPLIER = 10
const MAX_FETCH = 200

/**
 * Attempt a live fetch from LLDS DSpace REST API.
 * On any failure (CORS, timeout, 5xx, network error), throw so the caller
 * can fall back to cache.
 *
 * Note: if LLDS does not send CORS headers, the browser will block this
 * request. Treat that as an outage — cache kicks in.
 */
async function fetchLiveItems(fetchLimit: number): Promise<DSpaceItem[]> {
  const url = `${LLDS_REST}/items?expand=metadata&limit=${fetchLimit}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return (await res.json()) as DSpaceItem[]
  } finally {
    clearTimeout(timer)
  }
}

export async function runLLDSNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as LLDSSearchNodeData

  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', results: undefined, count: 0 })

  // Resolve param values — handle-connected ParamNode wins over inline field
  const resolve = (handleId: string, dataKey: keyof LLDSSearchNodeData): string => {
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
  const language = (d.language as string | undefined) ?? ''

  const fetchLimit = Math.min(limit * CLIENT_FILTER_MULTIPLIER, MAX_FETCH)
  // useCache defaults to true if not set (e.g. nodes created before this field existed)
  const useCache = (d.useCache as boolean | undefined) ?? true

  let rawItems: DSpaceItem[]
  let fromCache = false

  const cache = loadCache()

  try {
    if (useCache && cache && !isCacheStale(cache)) {
      // Fresh cache available and the user hasn't asked to bypass it
      console.log('[LLDS] using fresh cache from', new Date(cache.ts).toISOString())
      rawItems = cache.items
      fromCache = true
    } else {
      if (!useCache) console.log('[LLDS] cache bypassed — fetching live')
      rawItems = await fetchLiveItems(fetchLimit)
      saveCache(rawItems)
      console.log(`[LLDS] fetched ${rawItems.length} items live`)
    }
  } catch (err) {
    if (cache) {
      console.warn('[LLDS] live fetch failed, falling back to cache:', err)
      rawItems = cache.items
      fromCache = true
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[LLDS] no cache available after fetch failure:', msg)
      updateNodeData(nodeId, {
        status: 'error',
        statusMessage: `✗ ${msg}`,
        results: undefined,
        count: 0,
      })
      return
    }
  }

  // Map to UnifiedRecord then apply client-side filters
  let records = rawItems.map(item => adaptLLDSItem(item, fromCache))
  records = records.filter(r => matchesQuery(r, query) && matchesLanguage(r, language))
  records = records.slice(0, limit)

  console.log(`[LLDS] ${fromCache ? '(cached) ' : ''}query="${query}" lang="${language}" → ${records.length} records`)

  updateNodeData(nodeId, {
    status: fromCache ? 'cached' : 'success',
    statusMessage: fromCache
      ? `📦 ${records.length} results (cached)`
      : `✓ ${records.length} results`,
    results: records,
    count: records.length,
  })
}
