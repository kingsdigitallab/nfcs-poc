/**
 * runMDSNode.ts — NodeRunner for the MDSSearchNode.
 *
 * Runners MUST NOT throw. Own all error handling and always leave the node in a
 * terminal status ('success' | 'error') before returning.
 */

import type { NodeRunner }  from './nodeRunners'
import { fetchMDSRecords }  from './mds'
import { adaptMDSRecords }  from './mdsAdapter'
import type { MDSSearchNodeData } from '../nodes/MDSSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'
import { resolveParamEdge, resolveLimit, finishRunnerError } from './runnerHelpers'

export const runMDSNode: NodeRunner = async (
  nodeId,
  getNodes,
  edges,
  updateNodeData,
) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as MDSSearchNodeData

  const resolve = (handleId: string, dataKey: keyof MDSSearchNodeData): string =>
    resolveParamEdge(nodeId, handleId, nodes, edges) ?? (d[dataKey] as string | undefined) ?? ''

  const query    = resolve('query', 'inlineQuery').trim()
  const limit    = resolveLimit(nodeId, nodes, edges, d.inlineLimit as string | undefined)

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
    const { records: raws, total, capped } = await fetchMDSRecords(query, limit)
    const records = addCitation(adaptMDSRecords(raws) as Record<string, unknown>[], {
      service:    'MDS',
      serviceUrl: 'https://museumdata.uk',
      publisher:  'Museum Data Service',
      accessDate: new Date().toISOString(),
      query,
    })

    const msg = capped
      ? `⚠ ${records.length} of ${total.toLocaleString()} (capped)`
      : `✓ ${records.length} of ${total.toLocaleString()}`

    console.log(`[MDS] ${msg}`, records[0])

    const version = setNodeResults(nodeId, records)
    updateNodeData(nodeId, {
      status:         'success',
      statusMessage:  msg,
      count:          total,
      _capped:        capped,
      _total:         total,
      resultsVersion: version,
    })
  } catch (err) {
    finishRunnerError(nodeId, err, updateNodeData, '[MDS] runner')
  }
}
