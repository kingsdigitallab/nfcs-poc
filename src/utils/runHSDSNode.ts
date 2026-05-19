import type { Node, Edge } from '@xyflow/react'
import { adaptHSDSResponse, type HSDSSearchResponse } from './hsdsAdapter'
import type { HSDSSearchNodeData } from '../nodes/HSDSSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'

const HSDS_SEARCH   = '/hsds-proxy/data-catalogue-api/api/search'
const PAGE_SIZE     = 50
const FETCH_TIMEOUT = 30_000

async function fetchHSDS(params: Record<string, string>): Promise<HSDSSearchResponse> {
  const qs  = new URLSearchParams(params)
  const url = `${HSDS_SEARCH}?${qs}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    console.log('[HSDS] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const json = await res.json() as HSDSSearchResponse
    console.log(`[HSDS] page=${params.page ?? 1} total=${json.total?.value} hits=${json.hits?.length}`)
    return json
  } finally {
    clearTimeout(timer)
  }
}

function buildParams(d: HSDSSearchNodeData, nodes: Node[], edges: Edge[], nodeId: string): Record<string, string> {
  const resolve = (handleId: string, dataKey: keyof HSDSSearchNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const params: Record<string, string> = {
    sort:  d.sort  || '_score',
    order: d.order || 'desc',
  }

  const q = resolve('query', 'inlineQuery')
  if (q) params.q = q

  if (d.ariadneSubject) params.ariadneSubject = d.ariadneSubject
  if (d.derivedSubject) params.derivedSubject  = d.derivedSubject
  if (d.nativeSubject)  params.nativeSubject   = d.nativeSubject
  if (d.country)        params.country         = d.country
  if (d.dataType)       params.dataType        = d.dataType
  if (d.temporal)       params.temporal        = d.temporal
  if (d.contributor)    params.contributor     = d.contributor

  return params
}

export async function runHSDSNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as HSDSSearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  const baseParams = buildParams(d, nodes, edges, nodeId)
  const fetchAll   = d.fetchAll ?? false

  const limitEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'limit')
  const limitSrc  = limitEdge ? nodes.find(n => n.id === limitEdge.source) : null
  const rawLimit  = parseInt((limitSrc?.data as { value?: string } | undefined)?.value ?? d.inlineLimit ?? '20', 10)
  const limit     = isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit

  const accessDate   = new Date().toISOString()
  const citationBase = {
    service:    'HSDS',
    serviceUrl: 'https://hsds.ac.uk',
    publisher:  'Heritage Science Data Service',
    accessDate,
    query: Object.entries(baseParams)
      .filter(([k, v]) => !['sort', 'order', 'size', 'page'].includes(k) && v)
      .map(([k, v]) => `${k}:${v}`)
      .join(', '),
  }

  async function fetchPages(maxRecords: number): Promise<{ records: ReturnType<typeof adaptHSDSResponse>; total: number }> {
    const probe   = await fetchHSDS({ ...baseParams, size: '1', page: '1' })
    const total   = probe.total?.value ?? 0
    if (total === 0) return { records: [], total: 0 }

    const needed    = Math.min(maxRecords, total)
    const pageCount = Math.ceil(needed / PAGE_SIZE)
    const allRecords: ReturnType<typeof adaptHSDSResponse> = []

    for (let p = 1; p <= pageCount; p++) {
      updateNodeData(nodeId, {
        statusMessage: `Page ${p}/${pageCount} (${allRecords.length} fetched)…`,
      })
      const response = await fetchHSDS({ ...baseParams, size: String(PAGE_SIZE), page: String(p) })
      const batch    = adaptHSDSResponse(response)
      allRecords.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }

    return { records: allRecords.slice(0, needed), total }
  }

  try {
    const { records, total } = await fetchPages(fetchAll ? Infinity : limit)
    const citedRecords = addCitation(records as Record<string, unknown>[], citationBase)
    const version      = setNodeResults(nodeId, citedRecords)
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  `✓ ${records.length.toLocaleString()} of ${total.toLocaleString()}`,
      count:          total,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[HSDS] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
