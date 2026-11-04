/**
 * sourceTotals — the "n of N retrieved" denominator behind Source Profile's
 * completeness bar, per `_source`.
 *
 * N is the sum of the API totals (`data.count`, written by every search
 * runner) of the ORIGIN nodes in the profile's lineage — nodes that no
 * data-flow edge feeds — grouped by the `_source` of the records they produced.
 * Walking the lineage (not just the direct neighbours) means a Deduplicate,
 * Filter or Merge node between the searches and the profile no longer hides
 * the figure; the origin-only rule keeps Reconciliation / AI Inference (by
 * field) / Wikidata Enrich, which also write a `count`, out of the sum.
 *
 * Several searches of the same provider (three terms, say) are added together.
 * The APIs cannot say how much their result sets overlap, so with
 * `searches > 1` the total is an upper bound and the UI says so.
 */
import type { Edge, Node } from '@xyflow/react'
import { collectLineage } from './lineage'
import { getNodeResults } from '../store/resultsStore'

export interface SourceTotal {
  /** Sum of the contributing search nodes' API totals. */
  total: number
  /** How many search nodes contributed — >1 means `total` is an upper bound. */
  searches: number
}

export function collectSourceTotals(nodeId: string, nodes: Node[], edges: Edge[]): Map<string, SourceTotal> {
  const graph = collectLineage(nodeId, nodes, edges)
  const fed = new Set(graph.edges.map(e => e.to))
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const totals = new Map<string, SourceTotal>()

  for (const entry of graph.entries) {
    if (fed.has(entry.nodeId)) continue
    const d = nodeById.get(entry.nodeId)?.data as Record<string, unknown> | undefined
    const count = d?.count
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue
    const src = getNodeResults(entry.nodeId)?.[0]?._source
    if (typeof src !== 'string' || !src) continue
    const cur = totals.get(src) ?? { total: 0, searches: 0 }
    totals.set(src, { total: cur.total + count, searches: cur.searches + 1 })
  }
  return totals
}
