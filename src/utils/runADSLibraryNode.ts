import type { NodeRunner }             from './nodeRunners'
import { fetchADSLibraryRecords }       from './adsLibrary'
import { adaptADSLibraryRecords }       from './adsLibraryAdapter'
import type { ADSLibraryNodeData }      from '../nodes/ADSLibraryNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

export const runADSLibraryNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as ADSLibraryNodeData

  const resolve = (handleId: string, dataKey: keyof ADSLibraryNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const query    = resolve('query', 'inlineQuery').trim()
  const rawLimit = parseInt(resolve('limit', 'inlineLimit') || '20', 10)
  const limit    = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100)

  if (!query) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ query is required',
      count:         0,
    })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status:        'loading',
    statusMessage: 'Fetching…',
    count:         0,
    _capped:       false,
    _total:        0,
  })

  try {
    const { records: raws, total, capped } = await fetchADSLibraryRecords(query, limit)
    const records = adaptADSLibraryRecords(raws)

    const msg = capped
      ? `⚠ ${records.length} of ${total.toLocaleString()} (capped)`
      : `✓ ${records.length}${total > records.length ? ` of ${total.toLocaleString()}` : ''}`

    const version = setNodeResults(nodeId, records as Record<string, unknown>[])
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  msg,
      count:          records.length,
      _capped:        capped,
      _total:         total,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ADS Library] runner error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      count:         0,
    })
  }
}
