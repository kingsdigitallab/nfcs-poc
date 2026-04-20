import type { Node, Edge } from '@xyflow/react'
import { adaptADSResponse, type ADSSearchResponse } from './adsAdapter'
import type { ADSSearchAdvancedNodeData } from '../nodes/ADSSearchAdvancedNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

const ADS_SEARCH      = '/ads-proxy/data-catalogue-api/api/search'
const PAGE_SIZE       = 50
const FETCH_TIMEOUT   = 30_000

async function fetchADS(params: Record<string, string>): Promise<ADSSearchResponse> {
  const qs = new URLSearchParams(params)
  const url = `${ADS_SEARCH}?${qs}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    console.log('[ADS-adv] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const json = await res.json() as ADSSearchResponse
    console.log(`[ADS-adv] from=${params.from ?? 0} total=${json.total?.value} hits=${json.hits?.length}`)
    return json
  } finally {
    clearTimeout(timer)
  }
}

function buildParams(d: ADSSearchAdvancedNodeData, nodes: Node[], edges: Edge[], nodeId: string): Record<string, string> {
  const resolve = (handleId: string, dataKey: keyof ADSSearchAdvancedNodeData): string => {
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

  return params
}

export async function runADSAdvancedNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as ADSSearchAdvancedNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  const baseParams = buildParams(d, nodes, edges, nodeId)
  const fetchAll   = d.fetchAll ?? false

  const limitEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'limit')
  const limitSrc  = limitEdge ? nodes.find(n => n.id === limitEdge.source) : null
  const rawLimit  = parseInt((limitSrc?.data as { value?: string } | undefined)?.value ?? d.inlineLimit ?? '20', 10)
  const limit     = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, PAGE_SIZE)

  try {
    if (fetchAll) {
      updateNodeData(nodeId, { statusMessage: 'Probing total…' })
      const probe = await fetchADS({ ...baseParams, size: '1', from: '0' })
      const total = probe.total?.value ?? 0

      if (total === 0) {
        const version = setNodeResults(nodeId, [])
        updateNodeData(nodeId, { status: 'success', statusMessage: '✓ 0 results', count: 0, resultsVersion: version })
        return
      }

      const pageCount  = Math.ceil(total / PAGE_SIZE)
      const allRecords: ReturnType<typeof adaptADSResponse> = []

      for (let page = 0; page < pageCount; page++) {
        const from = page * PAGE_SIZE
        updateNodeData(nodeId, {
          statusMessage: `Page ${page + 1}/${pageCount} (${allRecords.length} fetched)…`,
        })
        const response = await fetchADS({ ...baseParams, size: String(PAGE_SIZE), from: String(from) })
        const batch    = adaptADSResponse(response)
        allRecords.push(...batch)
        if (batch.length < PAGE_SIZE) break
      }

      const version = setNodeResults(nodeId, allRecords as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status: 'success',
        statusMessage: `✓ ${allRecords.length.toLocaleString()} of ${total.toLocaleString()}`,
        count: total,
        resultsVersion: version,
      })
    } else {
      const response = await fetchADS({ ...baseParams, size: String(limit), from: '0' })
      const results  = adaptADSResponse(response)
      const total    = response.total?.value ?? results.length
      const version  = setNodeResults(nodeId, results as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status: 'success',
        statusMessage: `✓ ${results.length} of ${total.toLocaleString()}`,
        count: total,
        resultsVersion: version,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ADS-adv] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
