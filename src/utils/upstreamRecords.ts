/**
 * collectUpstreamRecords — sourceHandle-aware upstream record collection.
 *
 * LocalFolderSourceNode stores type-partitioned results under
 * "${nodeId}:pdf", "${nodeId}:xml", etc. When an edge originates from one of
 * these typed handles the correct partition is returned; for all other handles
 * (including the legacy "results" and "data" handles) the full store at
 * nodeId is returned — preserving identical behaviour for every existing node.
 */
import type { Edge } from '@xyflow/react'
import { getNodeResults } from '../store/resultsStore'

/** Handles that map to type-partitioned store keys on LocalFolderSourceNode. */
const TYPED_HANDLES = new Set(['pdf', 'xml', 'text', 'image'])

export function collectUpstreamRecords(
  nodeId: string,
  edges: Edge[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const edge of edges) {
    if (edge.target !== nodeId || edge.targetHandle !== 'data') continue
    const sh  = edge.sourceHandle
    const key = sh && TYPED_HANDLES.has(sh) ? `${edge.source}:${sh}` : edge.source
    const recs = getNodeResults(key)
    if (recs) out.push(...recs)
  }
  return out
}

export { TYPED_HANDLES }
