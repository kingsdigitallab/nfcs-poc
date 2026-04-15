/**
 * Out-of-band results store.
 *
 * Storing large record arrays directly in React Flow node data causes the
 * entire canvas to re-render on every update: React Flow diffs state by value,
 * and every useNodes() subscriber (output nodes, process nodes) re-renders and
 * re-merges arrays on every updateNodeData call anywhere in the graph.
 *
 * This module keeps records in a plain Map outside React Flow state. Nodes
 * write here via setNodeResults() and store only a lightweight resultsVersion
 * counter in their node data. That counter is what triggers useNodes()
 * re-renders — but the actual data read is a cheap Map.get().
 *
 * Note: this store is module-level and is cleared on Vite HMR. After a hot
 * reload, upstream runners must be re-executed to repopulate results.
 */

type AnyRecord = Record<string, unknown>

const _store  = new Map<string, AnyRecord[]>()
let   _version = 0

/**
 * Write results for a node. Returns the new version number so callers can
 * pass it straight into updateNodeData as `resultsVersion`.
 */
export function setNodeResults(nodeId: string, records: AnyRecord[]): number {
  _store.set(nodeId, records)
  return ++_version
}

/** Read results for a node. Returns undefined if the node has no stored results. */
export function getNodeResults(nodeId: string): AnyRecord[] | undefined {
  return _store.get(nodeId)
}

/** Remove a node's results (e.g. when the node is deleted or reset). */
export function clearNodeResults(nodeId: string): void {
  _store.delete(nodeId)
}
