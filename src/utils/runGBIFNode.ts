import type { Node, Edge } from '@xyflow/react'
import { fetchGBIF, GBIF_PAGE_SIZE, GBIFHttpError } from './gbif'
import { adaptGBIFResponse, type GBIFSearchResponse } from './gbifAdapter'
import type { GBIFSearchNodeData } from '../nodes/GBIFSearchNode'
import { clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'
import { resolveParamEdge, resolveLimit, finishRunnerSuccess, finishRunnerError } from './runnerHelpers'

const MAX_OFFSET = 100_000
/** Bound a single "ALL" run so it can't fire hundreds of requests and trip
 *  GBIF's rate limiter. 40 pages × 300 = up to 12,000 records. */
const MAX_FETCH_ALL_PAGES = 40
/** Small gap between pages — polite pacing that keeps live runs under the limit. */
const PAGE_DELAY_MS = 250
/** 429 backoff: retries per page and the base delay (doubled each attempt). */
const MAX_429_RETRIES = 4
const BACKOFF_BASE_MS = 800

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Fetch one page, retrying on HTTP 429 with exponential backoff (honouring a
 * Retry-After header when GBIF sends one). Any other error propagates.
 */
async function fetchPageWithBackoff(
  params: Parameters<typeof fetchGBIF>[0],
  onWait: (attempt: number, waitMs: number) => void,
): Promise<GBIFSearchResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchGBIF(params) as GBIFSearchResponse
    } catch (err) {
      const is429 = err instanceof GBIFHttpError && err.status === 429
      if (!is429 || attempt >= MAX_429_RETRIES) throw err
      const wait = (err as GBIFHttpError).retryAfterMs ?? BACKOFF_BASE_MS * 2 ** attempt
      onWait(attempt + 1, wait)
      await sleep(wait)
    }
  }
}

export async function runGBIFNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as GBIFSearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  try {
    const resolve = (handleId: string, dataKey: keyof GBIFSearchNodeData): string =>
      resolveParamEdge(nodeId, handleId, nodes, edges) ?? (d[dataKey] as string | undefined) ?? ''

    const baseParams = {
      q:              resolve('q',              'inlineQ'),
      scientificName: resolve('scientificName', 'inlineScientificName'),
      country:        resolve('country',        'inlineCountry'),
      year:           resolve('year',           'inlineYear'),
    }

    const limit    = resolveLimit(nodeId, nodes, edges, d.inlineLimit as string | undefined)
    const fetchAll = d.fetchAll ?? false

    const queryStr = Object.entries(baseParams)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ')

    const citationBase = {
      service:    'GBIF',
      serviceUrl: 'https://www.gbif.org',
      publisher:  'Global Biodiversity Information Facility',
      licence:    'Various open licences (CC BY 4.0)',
      query:      queryStr,
      accessDate: new Date().toISOString(),
    }

    const allRecords: ReturnType<typeof adaptGBIFResponse> = []
    let total = 0
    let offset = 0
    let page = 0
    let pageCapped = false

    while (true) {
      const pageSize = fetchAll
        ? GBIF_PAGE_SIZE
        : Math.min(limit - allRecords.length, GBIF_PAGE_SIZE)

      updateNodeData(nodeId, {
        statusMessage: allRecords.length > 0
          ? `Fetching… (${allRecords.length} so far)`
          : 'Loading…',
      })

      const raw = await fetchPageWithBackoff(
        { ...baseParams, limit: String(pageSize), offset: String(offset) },
        (attempt, waitMs) => updateNodeData(nodeId, {
          statusMessage: `Rate-limited — retrying in ${Math.ceil(waitMs / 1000)}s (${attempt}/${MAX_429_RETRIES})…`,
        }),
      )
      total = raw.count

      const batch = adaptGBIFResponse(raw)
      allRecords.push(...batch)
      page++

      // Stop an "ALL" run once it hits the page cap, so a single run can't fire
      // hundreds of requests at GBIF.
      if (fetchAll && page >= MAX_FETCH_ALL_PAGES && !raw.endOfRecords) pageCapped = true

      const done = raw.endOfRecords
        || batch.length === 0
        || (!fetchAll && allRecords.length >= limit)
        || offset + pageSize >= MAX_OFFSET
        || pageCapped

      if (done) break
      offset += pageSize
      await sleep(PAGE_DELAY_MS)   // polite pacing between pages
    }

    const trimmed = fetchAll ? allRecords : allRecords.slice(0, limit)
    const cited   = addCitation(trimmed as Record<string, unknown>[], citationBase)
    finishRunnerSuccess(nodeId, cited, total, updateNodeData)
    if (pageCapped) {
      // Amber note (status stays 'success', records already stored above) —
      // mirrors the MDS cap convention.
      updateNodeData(nodeId, {
        statusMessage: `⚠ capped at ${trimmed.length.toLocaleString()} of ${total.toLocaleString()} (ALL limit)`,
        _capped: true,
        _total: total,
      })
    }
  } catch (err) {
    finishRunnerError(nodeId, err, updateNodeData, '[GBIF]')
  }
}
