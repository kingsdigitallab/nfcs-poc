/**
 * NHM Data Portal runner — CKAN `datastore_search` over the NHM
 * versioned-datastore extension. Direct browser fetch (CORS is permissive;
 * verified 2026-10-20). No proxy: robots.txt disallows /api/, and a browser
 * fetch cannot set the User-Agent the portal asks for — that limitation is
 * documented in the NHM source profile.
 *
 * Shape: limit/offset paging with `result.total` — GBIF-like, so this is a
 * bespoke runner over runnerHelpers.ts rather than a searchRunnerFactory
 * config (the factory is page/size + {total:{value},hits}; do not force-fit).
 * The first page doubles as the total probe. Pages are paced 250 ms apart to
 * stay well under the portal's 5 req/s request; "Fetch all" is capped.
 */
import type { Node, Edge } from '@xyflow/react'
import { adaptNHMResult, type NHMDatastoreResponse, type NHMDatastoreResult } from './nhmAdapter'
import type { NHMSearchNodeData } from '../nodes/NHMSearchNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'
import { fetchWithTimeout } from './fetchWithTimeout'
import { resolveParamEdge, resolveLimit, finishRunnerSuccess, finishRunnerError } from './runnerHelpers'

export const NHM_API = 'https://data.nhm.ac.uk/api/3/action/datastore_search'
export const NHM_RESOURCES = {
  specimens: '05ff2255-c38a-40c9-b657-4ccb55ab2feb',
  indexlots: 'bb909597-dedf-427d-8c04-4c02b3a24db3',
} as const
export const NHM_PAGE_SIZE = 100
/** Bound a "Fetch all" run: 20 pages × 100. */
export const NHM_MAX_FETCH_ALL = 2_000
const PAGE_DELAY_MS = 250

/** Node-data keys that map 1:1 onto CKAN `filters` keys (single value each). */
const FILTER_KEYS = ['collectionCode', 'country', 'year', 'typeStatus', 'basisOfRecord'] as const

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Non-empty, trimmed filter values — or undefined so the `filters` key is omitted entirely. */
export function buildNHMFilters(d: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const k of FILTER_KEYS) {
    const v = typeof d[k] === 'string' ? (d[k] as string).trim() : ''
    if (v) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

interface NHMQuery {
  resource_id: string
  q?: string
  filters?: Record<string, string>
  sort?: string
}

function ckanErrorMessage(err: NHMDatastoreResponse['error'], fallback: string): string {
  if (!err) return fallback
  if (typeof err.message === 'string' && err.message) return err.message
  const { __type, ...rest } = err
  const detail = Object.keys(rest).length ? JSON.stringify(rest) : ''
  return [__type, detail].filter(Boolean).join(': ') || fallback
}

async function fetchNHMPage(body: NHMQuery & { limit: number; offset: number }): Promise<NHMDatastoreResult> {
  console.log('[NHM] POST', NHM_API, body)
  const res = await fetchWithTimeout(NHM_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  let json: NHMDatastoreResponse | null = null
  try { json = await res.json() as NHMDatastoreResponse } catch { json = null }
  if (json && json.success === false) throw new Error(ckanErrorMessage(json.error, `HTTP ${res.status}`))
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  if (!json?.result) throw new Error('Malformed response from the NHM Data Portal (no result)')
  return json.result
}

function hasMedia(r: UnifiedRecord): boolean {
  const ns = r.nhm as Record<string, unknown> | undefined
  return typeof ns?.thumbnail === 'string'
}

export async function runNHMNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as NHMSearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  try {
    const query    = (resolveParamEdge(nodeId, 'query', nodes, edges) ?? d.inlineQuery ?? '').trim()
    const limit    = resolveLimit(nodeId, nodes, edges, d.inlineLimit)
    const fetchAll = d.fetchAll ?? false
    const resource = d.resource === 'indexlots' ? 'indexlots' : 'specimens'
    const filters  = buildNHMFilters(d as Record<string, unknown>)
    const sort     = d.sort && d.sort !== 'relevance' ? d.sort : undefined

    const base: NHMQuery = {
      resource_id: NHM_RESOURCES[resource],
      ...(query   ? { q: query }   : {}),
      ...(filters ? { filters }    : {}),
      ...(sort    ? { sort }       : {}),
    }

    const citationBase = {
      service:    'Natural History Museum Data Portal',
      serviceUrl: 'https://data.nhm.ac.uk/',
      publisher:  'The Trustees of the Natural History Museum, London',
      licence:    'CC0 (specimen metadata); per-image licence and rightsHolder in nhm.associatedMedia',
      query: [
        `resource:${resource}`,
        query ? `q:${query}` : '',
        ...Object.entries(filters ?? {}).map(([k, v]) => `${k}:${v}`),
        sort ? `sort:${sort}` : '',
      ].filter(Boolean).join(', '),
      accessDate: new Date().toISOString(),
    }

    const target = fetchAll ? NHM_MAX_FETCH_ALL : limit
    const all: UnifiedRecord[] = []
    let total  = 0
    let offset = 0
    let page   = 0

    while (true) {
      const pageSize = Math.min(NHM_PAGE_SIZE, target - all.length)
      if (pageSize <= 0) break
      if (page > 0) {
        const pageCount = Math.ceil(Math.min(target, total) / NHM_PAGE_SIZE)
        updateNodeData(nodeId, { statusMessage: `Page ${page + 1}/${pageCount} (${all.length} fetched)…` })
      }
      const result = await fetchNHMPage({ ...base, limit: pageSize, offset })
      total = typeof result.total === 'number' ? result.total : 0
      const batch = adaptNHMResult(result)
      all.push(...batch)
      page++
      if (batch.length < pageSize || all.length >= Math.min(target, total)) break
      offset += pageSize
      await sleep(PAGE_DELAY_MS)
    }

    const cited = addCitation(all as Record<string, unknown>[], citationBase)
    finishRunnerSuccess(nodeId, cited, total, updateNodeData)

    const withImages = all.filter(hasMedia).length
    const imgSuffix  = withImages > 0 ? ` · ${withImages.toLocaleString()} with images` : ''
    const capped     = fetchAll && total > all.length
    updateNodeData(nodeId, capped
      ? { statusMessage: `⚠ capped at ${all.length.toLocaleString()} of ${total.toLocaleString()} (ALL limit)${imgSuffix}`, _capped: true, _total: total }
      : { statusMessage: `✓ ${all.length.toLocaleString()} of ${total.toLocaleString()}${imgSuffix}`, _capped: false, _total: total })
  } catch (err) {
    finishRunnerError(nodeId, err, updateNodeData, '[NHM]')
  }
}
