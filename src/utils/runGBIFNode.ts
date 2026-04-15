import type { Node, Edge } from '@xyflow/react'
import { fetchGBIF } from './gbif'
import { adaptGBIFResponse, type GBIFSearchResponse } from './gbifAdapter'
import type { GBIFSearchNodeData } from '../nodes/GBIFSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

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
    const results = adaptGBIFResponse(raw)

    const version = setNodeResults(nodeId, results as Record<string, unknown>[])
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
