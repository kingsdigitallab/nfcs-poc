import type { Node, Edge } from '@xyflow/react'
import { adaptARIADNEResponse, type ARIADNESearchResponse } from './ariadneAdapter'
import type { ARIADNESearchNodeData } from '../nodes/ARIADNESearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'

// ARIADNE portal API — CORS open, direct browser fetch (no proxy needed)
const ARIADNE_SEARCH  = 'https://portal.ariadne-infrastructure.eu/api/search'
const PAGE_SIZE       = 50
const FETCH_TIMEOUT   = 30_000

async function fetchARIADNE(params: Record<string, string>): Promise<ARIADNESearchResponse> {
  const qs  = new URLSearchParams(params)
  const url = `${ARIADNE_SEARCH}?${qs}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    console.log('[ARIADNE] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const json = await res.json() as ARIADNESearchResponse
    console.log(`[ARIADNE] from=${params.from ?? 0} total=${json.total?.value} hits=${json.hits?.length}`)
    return json
  } finally {
    clearTimeout(timer)
  }
}

function buildParams(
  d: ARIADNESearchNodeData,
  nodes: Node[],
  edges: Edge[],
  nodeId: string,
): Record<string, string> {
  const resolve = (handleId: string, dataKey: keyof ARIADNESearchNodeData): string => {
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

export async function runARIADNENode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as ARIADNESearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  const baseParams = buildParams(d, nodes, edges, nodeId)
  const fetchAll   = d.fetchAll ?? false

  const limitEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'limit')
  const limitSrc  = limitEdge ? nodes.find(n => n.id === limitEdge.source) : null
  const rawLimit  = parseInt((limitSrc?.data as { value?: string } | undefined)?.value ?? d.inlineLimit ?? '20', 10)
  const limit     = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, PAGE_SIZE)

  const accessDate   = new Date().toISOString()
  const citationBase = {
    service:    'ARIADNE',
    serviceUrl: 'https://portal.ariadne-infrastructure.eu',
    publisher:  'ARIADNE Research Infrastructure',
    accessDate,
    query: Object.entries(baseParams)
      .filter(([k, v]) => !['sort', 'order', 'size', 'from'].includes(k) && v)
      .map(([k, v]) => `${k}:${v}`)
      .join(', '),
  }

  try {
    if (fetchAll) {
      updateNodeData(nodeId, { statusMessage: 'Probing total…' })
      const probe = await fetchARIADNE({ ...baseParams, size: '1', from: '0' })
      const total = probe.total?.value ?? 0

      if (total === 0) {
        const version = setNodeResults(nodeId, [])
        updateNodeData(nodeId, { status: 'success', statusMessage: '✓ 0 results', count: 0, resultsVersion: version })
        return
      }

      const pageCount  = Math.ceil(total / PAGE_SIZE)
      const allRecords: ReturnType<typeof adaptARIADNEResponse> = []

      for (let page = 0; page < pageCount; page++) {
        const from = page * PAGE_SIZE
        updateNodeData(nodeId, {
          statusMessage: `Page ${page + 1}/${pageCount} (${allRecords.length} fetched)…`,
        })
        const response = await fetchARIADNE({ ...baseParams, size: String(PAGE_SIZE), from: String(from) })
        const batch    = adaptARIADNEResponse(response)
        allRecords.push(...batch)
        if (batch.length < PAGE_SIZE) break
      }

      const citedRecords = addCitation(allRecords as Record<string, unknown>[], citationBase)
      const version = setNodeResults(nodeId, citedRecords)
      updateNodeData(nodeId, {
        status: 'success',
        statusMessage: `✓ ${allRecords.length.toLocaleString()} of ${total.toLocaleString()}`,
        count: total,
        resultsVersion: version,
      })
    } else {
      const response = await fetchARIADNE({ ...baseParams, size: String(limit), from: '0' })
      const results  = addCitation(adaptARIADNEResponse(response) as Record<string, unknown>[], citationBase)
      const total    = response.total?.value ?? results.length
      const version  = setNodeResults(nodeId, results)
      updateNodeData(nodeId, {
        status: 'success',
        statusMessage: `✓ ${results.length} of ${total.toLocaleString()}`,
        count: total,
        resultsVersion: version,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ARIADNE] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
