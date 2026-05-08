import type { NodeRunner } from './nodeRunners'
import { getNodeResults, setNodeResults } from '../store/resultsStore'

/**
 * ImageViewNode runner — called by "Run All".
 * The component writes to the results store reactively whenever the displayed
 * image changes. The runner just re-signals the version so downstream nodes
 * (e.g. KCLNode in vision mode) wake up and read the latest image record.
 */
export const runImageViewNode: NodeRunner = async (nodeId, _getNodes, _edges, updateNodeData) => {
  const existing = getNodeResults(nodeId)
  if (existing?.length) {
    const version = setNodeResults(nodeId, existing)
    updateNodeData(nodeId, { imageCount: existing.length, resultsVersion: version })
  } else {
    updateNodeData(nodeId, { imageCount: 0 })
  }
}
