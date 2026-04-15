/**
 * runLLDSNode.ts — NodeRunner for LLDSSearchNode.
 *
 * Fetches LLDS via the HTML scraper (llds.ts) rather than the DSpace REST API,
 * which proved unreliable (XML vs JSON content negotiation issues, schema
 * mismatches). Falls back to a localStorage cache on any failure.
 *
 * Runners MUST NOT throw. Own all error handling.
 */

import type { NodeRunner }        from './nodeRunners'
import { fetchLLDSRecords }       from './llds'
import { adaptLLDSRecords }       from './lldsAdapter'
import { loadCache, saveCache, isCacheStale } from './lldsCache'
import type { LLDSSearchNodeData } from '../nodes/LLDSSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

export const runLLDSNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as LLDSSearchNodeData

  const resolve = (handleId: string, dataKey: keyof LLDSSearchNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const query    = resolve('query', 'inlineQuery').trim()
  const rawLimit = parseInt(resolve('limit', 'inlineLimit') || '20', 10)
  const limit    = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 50)
  const useCache = (d.useCache as boolean | undefined) ?? true

  if (!query) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ query is required',
      count:         0,
    })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Fetching…', count: 0 })

  const cache = loadCache()

  try {
    if (useCache && cache && !isCacheStale(cache)) {
      console.log('[LLDS] using fresh cache from', new Date(cache.ts).toISOString())
      const records = adaptLLDSRecords(cache.items).map(r => ({ ...r, _cached: true }))
      const version = setNodeResults(nodeId, records as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status:         'cached',
        statusMessage:  `📦 ${records.length} results (cached)`,
        count:          records.length,
        resultsVersion: version,
      })
      return
    }

    if (!useCache) console.log('[LLDS] cache bypassed — fetching live')

    const { records: raws, total, capped } = await fetchLLDSRecords(query, limit)
    saveCache(raws)

    const records = adaptLLDSRecords(raws)
    const msg = capped
      ? `⚠ ${records.length} of ${total.toLocaleString()} (capped)`
      : `✓ ${records.length} of ${total.toLocaleString()}`

    console.log(`[LLDS] ${msg}`, records[0])

    const version = setNodeResults(nodeId, records as Record<string, unknown>[])
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  msg,
      count:          records.length,
      resultsVersion: version,
    })
  } catch (err) {
    if (cache) {
      console.warn('[LLDS] live fetch failed, falling back to cache:', err)
      const records = adaptLLDSRecords(cache.items).map(r => ({ ...r, _cached: true }))
      const version = setNodeResults(nodeId, records as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status:         'cached',
        statusMessage:  `📦 ${records.length} results (cached — service unavailable)`,
        count:          records.length,
        resultsVersion: version,
      })
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[LLDS] no cache available after fetch failure:', msg)
      updateNodeData(nodeId, {
        status:        'error',
        statusMessage: `✗ ${msg}`,
        count:         0,
      })
    }
  }
}
