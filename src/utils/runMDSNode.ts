/**
 * runMDSNode.ts — NodeRunner for the MDSSearchNode.
 *
 * Runners MUST NOT throw. Own all error handling and always leave the node in a
 * terminal status ('success' | 'error') before returning.
 */

import type { Node, Edge } from '@xyflow/react'
import type { NodeRunner }  from './nodeRunners'
import { fetchMDSRecords }  from './mds'
import { adaptMDSRecords }  from './mdsAdapter'
import type { MDSSearchNodeData } from '../nodes/MDSSearchNode'

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

  // Resolve wired-or-inline params (ParamNode connection wins over inline field)
  const resolve = (handleId: string, dataKey: keyof MDSSearchNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const query    = resolve('query', 'inlineQuery').trim()
  const rawLimit = parseInt(resolve('limit', 'inlineLimit') || '20', 10)
  const limit    = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 200)

  if (!query) {
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: '✗ query is required',
      results:       undefined,
      count:         0,
    })
    return
  }

  updateNodeData(nodeId, {
    status:        'loading',
    statusMessage: 'Fetching…',
    results:       undefined,
    count:         0,
    _capped:       false,
    _total:        0,
  })

  try {
    const { records: raws, total, capped } = await fetchMDSRecords(query, limit)
    const records = adaptMDSRecords(raws)

    const msg = capped
      ? `⚠ ${records.length} of ${total.toLocaleString()} (capped)`
      : `✓ ${records.length} of ${total.toLocaleString()}`

    console.log(`[MDS] ${msg}`, records[0])

    updateNodeData(nodeId, {
      status:        'success',
      statusMessage: msg,
      results:       records,
      count:         records.length,
      _capped:       capped,
      _total:        total,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MDS] runner error', msg)
    updateNodeData(nodeId, {
      status:        'error',
      statusMessage: `✗ ${msg}`,
      results:       undefined,
      count:         0,
    })
  }
}
