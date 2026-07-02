/**
 * Shared helpers for search-node runners — the pieces every runner used to
 * re-implement inline: param-handle resolution, limit clamping, and the
 * terminal success/error status blocks.
 */
import type { Node, Edge } from '@xyflow/react'
import { setNodeResults } from '../store/resultsStore'

/**
 * Read the value wired into a param handle (from a ParamNode), or undefined
 * when nothing is connected.
 */
export function resolveParamEdge(
  nodeId: string,
  handleId: string,
  nodes: Node[],
  edges: Edge[],
): string | undefined {
  const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) return undefined
  const src = nodes.find(n => n.id === edge.source)
  return (src?.data as { value?: string } | undefined)?.value ?? ''
}

/**
 * Resolve the record limit: wired `limit` handle wins, then the node's
 * inline value, then the fallback. Non-numeric / sub-1 values fall back.
 * (Unlike query params, an undefined wired value falls through to the
 * inline limit — matching the original inline resolvers.)
 */
export function resolveLimit(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
  inlineLimit: string | undefined,
  fallback = 20,
): number {
  const edge  = edges.find(e => e.target === nodeId && e.targetHandle === 'limit')
  const src   = edge ? nodes.find(n => n.id === edge.source) : null
  const wired = (src?.data as { value?: string } | undefined)?.value
  const raw   = parseInt(wired ?? inlineLimit ?? String(fallback), 10)
  return isNaN(raw) || raw < 1 ? fallback : raw
}

/** Terminal success block: store records, bump version, set status. */
export function finishRunnerSuccess(
  nodeId: string,
  records: Record<string, unknown>[],
  total: number,
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): void {
  const version = setNodeResults(nodeId, records)
  updateNodeData(nodeId, {
    status:         'success',
    statusMessage:  `✓ ${records.length.toLocaleString()} of ${total.toLocaleString()}`,
    count:          total,
    resultsVersion: version,
  })
}

/** Terminal error block: log under the runner's tag, set error status. */
export function finishRunnerError(
  nodeId: string,
  err: unknown,
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
  logTag: string,
): void {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`${logTag} error`, msg)
  updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
}
