import type { Node, Edge } from '@xyflow/react'
import { fetchGBIF, GBIF_PAGE_SIZE } from './gbif'
import { adaptGBIFResponse, type GBIFSearchResponse } from './gbifAdapter'
import type { GBIFSearchNodeData } from '../nodes/GBIFSearchNode'
import { clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'
import { resolveParamEdge, resolveLimit, finishRunnerSuccess, finishRunnerError } from './runnerHelpers'

const MAX_OFFSET = 100_000

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

    while (true) {
      const pageSize = fetchAll
        ? GBIF_PAGE_SIZE
        : Math.min(limit - allRecords.length, GBIF_PAGE_SIZE)

      updateNodeData(nodeId, {
        statusMessage: allRecords.length > 0
          ? `Fetching… (${allRecords.length} so far)`
          : 'Loading…',
      })

      const raw = await fetchGBIF({ ...baseParams, limit: String(pageSize), offset: String(offset) }) as GBIFSearchResponse
      total = raw.count

      const batch = adaptGBIFResponse(raw)
      allRecords.push(...batch)

      const done = raw.endOfRecords
        || batch.length === 0
        || (!fetchAll && allRecords.length >= limit)
        || offset + pageSize >= MAX_OFFSET

      if (done) break
      offset += pageSize
    }

    const trimmed = fetchAll ? allRecords : allRecords.slice(0, limit)
    const cited   = addCitation(trimmed as Record<string, unknown>[], citationBase)
    finishRunnerSuccess(nodeId, cited, total, updateNodeData)
  } catch (err) {
    finishRunnerError(nodeId, err, updateNodeData, '[GBIF]')
  }
}
