/**
 * Runner for CommentNode — passes upstream records through unaltered.
 * Used when the hidden input/output handles are unlocked for illustrating
 * conceptual workflow gaps (e.g., marking a "data retrieval" step).
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { finishRunnerError } from './runnerHelpers'

/** Never throws — see NodeRunner contract. */
const runCommentNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  try {
    await runCommentInner(nodeId, getNodes, edges, updateNodeData)
  } catch (err) {
    finishRunnerError(nodeId, err, updateNodeData, '[Comment]')
  }
}

const runCommentInner: NodeRunner = async (
  nodeId,
  _getNodes,
  edges,
  updateNodeData,
) => {
  const upstreamRecords = collectUpstreamRecords(nodeId, edges)
  if (upstreamRecords.length === 0) {
    updateNodeData(nodeId, { status: 'idle', statusMessage: 'No upstream data' })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status: 'running',
    statusMessage: 'Passing through…',
    inputCount: upstreamRecords.length,
  })

  const version = setNodeResults(nodeId, upstreamRecords)
  updateNodeData(nodeId, {
    status: 'success',
    statusMessage: `✓ ${upstreamRecords.length} records passed through`,
    outputCount: upstreamRecords.length,
    resultsVersion: version,
  })
}

export default runCommentNode
