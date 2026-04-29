import type { Node, Edge } from '@xyflow/react'
import { fetchGBIF } from './gbif'
import { adaptGBIFResponse, type GBIFSearchResponse } from './gbifAdapter'
import type { GBIFSearchNodeData } from '../nodes/GBIFSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'

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
    const resolve = (handleId: string, dataKey: keyof GBIFSearchNodeData): string => {
      const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
      if (edge) {
        const src = nodes.find(n => n.id === edge.source)
        return (src?.data as { value?: string } | undefined)?.value ?? ''
      }
      return (d[dataKey] as string | undefined) ?? ''
    }

    const params = {
      q:              resolve('q',              'inlineQ'),
      scientificName: resolve('scientificName', 'inlineScientificName'),
      country:        resolve('country',        'inlineCountry'),
      year:           resolve('year',           'inlineYear'),
      limit:          resolve('limit',          'inlineLimit'),
    }

    const raw = await fetchGBIF(params) as GBIFSearchResponse
    const queryStr = Object.entries(params)
      .filter(([k, v]) => k !== 'limit' && v)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ')
    const results = addCitation(adaptGBIFResponse(raw) as Record<string, unknown>[], {
      service:    'GBIF',
      serviceUrl: 'https://www.gbif.org',
      publisher:  'Global Biodiversity Information Facility',
      licence:    'Various open licences (CC BY 4.0)',
      query:      queryStr,
      accessDate: new Date().toISOString(),
    })

    const version = setNodeResults(nodeId, results)
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  `✓ ${raw.count.toLocaleString()} results`,
      count:          raw.count,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[GBIF] error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      count:         0,
    })
  }
}
