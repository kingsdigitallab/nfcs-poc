/**
 * duplicateNodes — the ONE implementation of "duplicate these nodes" behind
 * the ⧉ toolbar button and Ctrl+D / Cmd+D. Pure: it returns the NEW nodes and
 * edges to append (ids already minted), so callers never mint ids or touch a
 * second store inside a React updater (which StrictMode runs twice).
 *
 * Rules:
 *  - a selected group brings every direct child, selected or not; a child
 *    whose group is also selected is cloned once;
 *  - children of a cloned group keep their relative position under the new
 *    group; everything else moves +OFFSET/+OFFSET (a child whose group is NOT
 *    selected stays in that group);
 *  - only edges with BOTH ends inside the duplicated set are cloned;
 *  - collapsed groups are refused (`skipped`): their children are invisible
 *    and their edges re-routed through proxy handles — the caller expands
 *    them first, as ungroup / delete do.
 */
import type { Node, Edge } from '@xyflow/react'
import { newId } from './nodeIdCounter'

export const DUPLICATE_OFFSET = 40

/** Runtime-only data keys that a copy must not inherit (it has no results, no status, no counts). */
export const RUNTIME_FIELDS: ReadonlySet<string> = new Set([
  'results', 'status', 'statusMessage', 'count',
  'inputCount', 'outputCount', 'removedCount',
  'resolvedCount', 'reviewCount', 'mergedCount', 'unmatchedCount',
  'resolved', 'pending', 'failed',
  'resultsVersion', '_capped', '_total',
  'folderName', 'fileName', 'columnNames',
  'pdfCount', 'xmlCount', 'textCount', 'imageCount', 'csvCount', 'gisCount', 'gisLayers',
  'filterCount', 'totalCount',
  'proxyInCount', 'proxyOutCount', 'rowSelections',
])

/** Collapse bookkeeping a cloned group must not carry (its proxy edge ids belong to the source group). */
const GROUP_STATE_FIELDS = ['collapsed', 'proxyEdges', 'childPositions', 'originalWidth', 'originalHeight']

export function cloneNodeData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(structuredClone(data ?? {})).filter(([k]) => !RUNTIME_FIELDS.has(k)),
  )
}

export interface DuplicateResult {
  /** New nodes, groups before their children (React Flow needs the parent first). */
  nodes:   Node[]
  edges:   Edge[]
  /** Selected groups that were collapsed and therefore not cloned. */
  skipped: string[]
}

export function duplicateNodes(nodes: Node[], edges: Edge[], selectedIds: Iterable<string>): DuplicateResult {
  const byId  = new Map(nodes.map(n => [n.id, n]))
  const seeds = [...new Set(selectedIds)].map(id => byId.get(id)).filter((n): n is Node => !!n)

  const skipped: string[] = []
  const groups: Node[] = []
  for (const n of seeds) {
    if (n.type !== 'group') continue
    if (n.data?.collapsed) skipped.push(n.id); else groups.push(n)
  }
  const groupIds   = new Set(groups.map(g => g.id))
  const skippedIds = new Set(skipped)

  // Insertion order is the output order: groups, their children, then loose seeds
  const members = new Map<string, Node>()
  for (const g of groups) members.set(g.id, g)
  for (const n of nodes) if (n.parentId && groupIds.has(n.parentId)) members.set(n.id, n)
  for (const n of seeds) {
    if (n.type === 'group' || members.has(n.id)) continue
    // A child of a collapsed group is hidden (opacity 0) — cloning it would clone a ghost
    if (n.parentId && skippedIds.has(n.parentId)) continue
    members.set(n.id, n)
  }

  // Mint past any id already on the canvas (the counter can trail a loaded workflow)
  const idMap = new Map<string, string>()
  for (const n of members.values()) {
    let id: string
    do id = newId(n.type ?? 'node'); while (byId.has(id))
    idMap.set(n.id, id)
  }

  const out: Node[] = []
  for (const n of members.values()) {
    const parentCloned = !!n.parentId && idMap.has(n.parentId)
    const data = cloneNodeData(n.data as Record<string, unknown>)
    if (n.type === 'group') for (const k of GROUP_STATE_FIELDS) delete data[k]
    const { measured: _measured, dragging: _dragging, ...rest } = n as Node & { measured?: unknown; dragging?: unknown }
    void _measured; void _dragging
    out.push({
      ...rest,
      id:       idMap.get(n.id)!,
      selected: true,
      data,
      parentId: parentCloned ? idMap.get(n.parentId!) : n.parentId,
      position: parentCloned
        ? { x: n.position.x, y: n.position.y }
        : { x: n.position.x + DUPLICATE_OFFSET, y: n.position.y + DUPLICATE_OFFSET },
    })
  }

  const newEdges: Edge[] = edges
    .filter(e => idMap.has(e.source) && idMap.has(e.target))
    .map(e => {
      const { hidden: _hidden, ...rest } = e
      void _hidden
      return { ...rest, id: newId('edge'), source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false }
    })

  return { nodes: out, edges: newEdges, skipped }
}
