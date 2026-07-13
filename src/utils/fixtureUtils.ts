/**
 * Fixture utilities — allow any search node to serve pre-baked results from
 * a static JSON file in public/fixtures/ instead of hitting the live API.
 *
 * Fixture files are committed to the repo, so searches always work even when
 * external services are unavailable (e.g. at a workshop or during an outage).
 *
 * File naming convention:
 *   public/fixtures/{nodeType}-{sanitizedQuery}.json
 *   e.g.  public/fixtures/ariadneSearch-stonehenge.json
 *
 * File format:
 *   A plain UnifiedRecord[] JSON array — the same format ExportNode writes
 *   with "JSON" selected. Run your searches, export as JSON, rename the file
 *   to match the convention above, and commit to public/fixtures/.
 *
 * Usage:
 *   In nodeRunners.ts, wrap a runner:
 *     ariadneSearch: withFixture('ariadneSearch', runARIADNENode),
 *
 *   In the node component, add a fixture toggle to the footer and call
 *   downloadAsFixture() to save the current results for committing.
 */
import type { Node, Edge } from '@xyflow/react'
import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults, getNodeResults } from '../store/resultsStore'
import { normaliseRecords } from './recordNormalise'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export function sanitizeQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'default'
}

export function fixtureFilename(nodeType: string, query: string): string {
  return `${nodeType}-${sanitizeQuery(query)}.json`
}

/**
 * Wraps a NodeRunner so that when the node's `useFixture` flag is set,
 * results are loaded from /fixtures/{nodeType}-{query}.json instead of
 * calling the live API. Falls back to the real runner if useFixture is false.
 */
export function withFixture(nodeType: string, runner: NodeRunner): NodeRunner {
  return async (
    nodeId: string,
    getNodes: () => Node[],
    edges: Edge[],
    updateNodeData: (id: string, data: Record<string, unknown>) => void,
  ) => {
    const nodes = getNodes()
    const node  = nodes.find(n => n.id === nodeId)
    const d     = node?.data as Record<string, unknown> | undefined

    if (!d?.useFixture) {
      return runner(nodeId, getNodes, edges, updateNodeData)
    }

    // Resolve query: prefer the wired upstream value (same pattern as all runners),
    // fall back to whichever inline field this node type uses
    const queryEdge = edges.find(
      e => e.target === nodeId && (e.targetHandle === 'query' || e.targetHandle === 'q'),
    )
    const resolvedQuery = queryEdge
      ? ((nodes.find(n => n.id === queryEdge.source)?.data as { value?: string } | undefined)?.value ?? '')
      : String(d.inlineQuery ?? d.inlineQ ?? '')
    const query = resolvedQuery.trim() || 'default'
    const filename = fixtureFilename(nodeType, query)
    const url = `/fixtures/${filename}`

    clearNodeResults(nodeId)
    updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading fixture…', count: 0 })

    try {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? `Fixture file not found — save results then put ${filename} in public/fixtures/`
            : `HTTP ${res.status} fetching ${filename}`,
        )
      }
      const raw = await res.json() as UnifiedRecord[]
      if (!Array.isArray(raw)) throw new Error(`${filename} is not a JSON array`)
      // Committed fixtures may predate schema changes — normalise to the
      // current UnifiedRecord contract (e.g. flat GBIF fields → gbif.*).
      const records = normaliseRecords(raw as Record<string, unknown>[])
      const version = setNodeResults(nodeId, records as Record<string, unknown>[])
      updateNodeData(nodeId, {
        status:         'cached',
        statusMessage:  `📦 ${records.length.toLocaleString()} (fixture)`,
        count:          records.length,
        resultsVersion: version,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[fixture:${nodeType}]`, msg)
      updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
    }
  }
}

/**
 * Resolves the effective query string for a node, checking wired edges first.
 * Use this in node components to get the right filename for downloadAsFixture.
 */
export function resolveFixtureQuery(
  nodeId: string,
  edges: Edge[],
  nodes: Node[],
  d: Record<string, unknown>,
): string {
  const queryEdge = edges.find(
    e => e.target === nodeId && (e.targetHandle === 'query' || e.targetHandle === 'q'),
  )
  const resolved = queryEdge
    ? ((nodes.find(n => n.id === queryEdge.source)?.data as { value?: string } | undefined)?.value ?? '')
    : String(d.inlineQuery ?? d.inlineQ ?? '')
  return resolved.trim() || 'default'
}

/**
 * Downloads the current results for a node as a fixture JSON file.
 * The user commits the downloaded file to public/fixtures/.
 */
export function downloadAsFixture(nodeId: string, nodeType: string, query: string): void {
  const records = getNodeResults(nodeId)
  if (!records?.length) return
  const filename = fixtureFilename(nodeType, query)
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
