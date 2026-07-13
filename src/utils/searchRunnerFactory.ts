/**
 * searchRunnerFactory — builds a NodeRunner for Elasticsearch-backed search
 * services that share the ARIADNE-style API shape:
 *
 *   GET {endpoint}?q=…&size=…&page=…   (1-indexed pages)
 *   → { total: { value }, hits: [...] }
 *
 * ARIADNE and HSDS were byte-for-byte clones of each other apart from the
 * endpoint, adapter, and citation metadata; this factory holds the shared
 * body once. Services with different pagination models (Europeana's cursor,
 * SMG/VA/Bodleian's bespoke pagers) keep their own runners and reuse the
 * pieces from runnerHelpers.ts instead — do NOT force-fit them here.
 *
 * Execution shape (kept byte-compatible with the originals):
 *   clear results → status loading → buildParams (wired handles win) →
 *   resolve limit → probe with size=1 to learn the total → fetch pages of
 *   `pageSize` with progress updates → trim to requested cap → stamp
 *   _citation (query string from all non-paging params) → terminal
 *   success/error status. Never throws.
 */
import type { NodeRunner } from './nodeRunners'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'
import { fetchWithTimeout } from './fetchWithTimeout'
import {
  resolveParamEdge,
  resolveLimit,
  finishRunnerSuccess,
  finishRunnerError,
} from './runnerHelpers'

/** Minimal Elasticsearch-style response shape the paginator relies on. */
export interface ESLikeResponse {
  total?: { value?: number }
  hits?: unknown[]
}

export interface SearchRunnerConfig<TResponse extends ESLikeResponse> {
  /** Citation service name, e.g. 'ARIADNE' */
  service: string
  /** Citation service URL, e.g. 'https://portal.ariadne-infrastructure.eu' */
  serviceUrl: string
  /** Citation publisher */
  publisher: string
  /** Search endpoint (absolute URL or same-origin proxy path) */
  endpoint: string
  /** Console log prefix, e.g. '[ARIADNE]' */
  logTag: string
  /** Records per page (service maximum) */
  pageSize: number
  /** Maps one response page to UnifiedRecord[] */
  adapter: (response: TResponse) => UnifiedRecord[]
  /**
   * Builds the non-paging query params from node data. `resolve` reads a
   * param handle's wired value, falling back to the given node-data key —
   * identical semantics to the inline resolvers the runners used to carry.
   */
  buildParams: (
    d: Record<string, unknown>,
    resolve: (handleId: string, dataKey: string) => string,
  ) => Record<string, string>
}

export function makeSearchRunner<TResponse extends ESLikeResponse>(
  config: SearchRunnerConfig<TResponse>,
): NodeRunner {
  const { service, serviceUrl, publisher, endpoint, logTag, pageSize, adapter, buildParams } = config

  async function fetchPage(params: Record<string, string>): Promise<TResponse> {
    const url = `${endpoint}?${new URLSearchParams(params)}`
    console.log(`${logTag} GET`, url)
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const json = await res.json() as TResponse
    console.log(`${logTag} page=${params.page ?? 1} size=${params.size} total=${json.total?.value} hits=${json.hits?.length}`)
    return json
  }

  return async (nodeId, getNodes, edges, updateNodeData) => {
    const nodes = getNodes()
    const node  = nodes.find(n => n.id === nodeId)
    if (!node) return
    const d = node.data as Record<string, unknown>

    clearNodeResults(nodeId)
    updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

    const resolve = (handleId: string, dataKey: string): string =>
      resolveParamEdge(nodeId, handleId, nodes, edges)
      ?? ((d[dataKey] as string | undefined) ?? '')

    const baseParams = buildParams(d, resolve)
    const fetchAll   = (d.fetchAll as boolean | undefined) ?? false
    const limit      = resolveLimit(nodeId, nodes, edges, d.inlineLimit as string | undefined)

    const citationBase = {
      service,
      serviceUrl,
      publisher,
      accessDate: new Date().toISOString(),
      query: Object.entries(baseParams)
        .filter(([k, v]) => !['sort', 'order', 'size', 'page'].includes(k) && v)
        .map(([k, v]) => `${k}:${v}`)
        .join(', '),
    }

    // Probe with size=1 to learn the total, then page through (1-indexed)
    async function fetchPages(maxRecords: number): Promise<{ records: UnifiedRecord[]; total: number }> {
      const probe = await fetchPage({ ...baseParams, size: '1', page: '1' })
      const total = probe.total?.value ?? 0
      if (total === 0) return { records: [], total: 0 }

      const needed     = Math.min(maxRecords, total)
      const pageCount  = Math.ceil(needed / pageSize)
      const allRecords: UnifiedRecord[] = []

      for (let p = 1; p <= pageCount; p++) {
        updateNodeData(nodeId, {
          statusMessage: `Page ${p}/${pageCount} (${allRecords.length} fetched)…`,
        })
        const response = await fetchPage({ ...baseParams, size: String(pageSize), page: String(p) })
        const batch    = adapter(response)
        allRecords.push(...batch)
        if (batch.length < pageSize) break
      }

      return { records: allRecords.slice(0, needed), total }
    }

    try {
      const { records, total } = await fetchPages(fetchAll ? Infinity : limit)
      const citedRecords = addCitation(records as unknown as Record<string, unknown>[], citationBase)
      finishRunnerSuccess(nodeId, citedRecords, total, updateNodeData)
    } catch (err) {
      finishRunnerError(nodeId, err, updateNodeData, logTag)
    }
  }
}
