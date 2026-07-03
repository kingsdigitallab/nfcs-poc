/**
 * lineage — derive-on-demand pipeline history (docs/context-accrual.md).
 *
 * collectLineage(nodeId, nodes, edges) walks the node's upstream subgraph at
 * prompt time and returns a LineageGraph: every upstream node's configuration
 * (stripTransient'd), record counts, and the data-flow edges between them, in
 * topological order. Nothing is stamped on records and no runner is touched —
 * the lineage is derived from state the nodes already persist.
 */
import type { Edge, Node } from '@xyflow/react'
import { resolveProxyEdges } from './upstreamRecords'
import { stripTransient } from './workflowIO'
import { getNodeResults } from '../store/resultsStore'
import { SIDEBAR_ITEMS } from '../config/sidebarItems'
import { describeNode } from './lineageDescribers'

/** One node's contribution to the pipeline history. */
export interface LineageEntry {
  nodeId:   string
  nodeType: string
  /** Sidebar label, e.g. 'ARIADNESearch'. */
  label:    string
  /** One-sentence human-readable description of the operation,
   *  produced by the per-node-type registry in lineageDescribers.ts. */
  operationSummary: string
  /** The operation's key parameters — stripTransient(node.data). */
  params:   Record<string, unknown>
  /** Record counts when known (read from raw data BEFORE stripTransient,
   *  which removes all count keys). */
  inCount?:  number
  outCount?: number
  /** resultsVersion observed at derivation time — staleness signal. */
  resultsVersion?: number
}

/** A node's lineage = its upstream subgraph, topologically ordered. */
export interface LineageGraph {
  /** Entries in topological order (sources first). The target node itself is
   *  NOT included — its lineage is what happened before it. */
  entries: LineageEntry[]
  /** Data-flow edges between entries (parent nodeId → child nodeId), so
   *  branches and joins can be rendered structurally. */
  edges: Array<{ from: string; to: string }>
  /** True when an upstream node looks out of step with the records it feeds
   *  downstream (never ran this session, or its store results are gone). */
  stale: boolean
}

const LABEL_BY_TYPE = new Map<string, string>(SIDEBAR_ITEMS.map(i => [i.type as string, i.label]))

/** Data-flow target handles the walker follows upstream. 'data' is the
 *  standard record input; 'results' is the TableOutput pass-through input.
 *  Param handles (query, limit, apiKey, …) carry config, not records. */
const DATA_TARGET_HANDLES = new Set(['data', 'results'])

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Walk the upstream subgraph of `nodeId` and return its lineage.
 * Pure read — safe to call from runners (`getNodes()`, `edges`) and from
 * components (`useNodes()`, `useEdges()` values).
 */
export function collectLineage(nodeId: string, nodes: Node[], edges: Edge[]): LineageGraph {
  // Collapsed groups rewire edges through proxy handles — restore the real endpoints.
  const realEdges = resolveProxyEdges(edges, nodes)
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // BFS upstream over data-flow edges only; visited set makes cycles safe.
  const visited = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const e of realEdges) {
      if (e.target !== current) continue
      if (!DATA_TARGET_HANDLES.has(e.targetHandle ?? '')) continue
      if (visited.has(e.source) || e.source === nodeId) continue
      if (!nodeById.has(e.source)) continue
      visited.add(e.source)
      queue.push(e.source)
    }
  }

  // Subgraph edges: data-flow edges where both endpoints are lineage entries.
  const subEdges: Array<{ from: string; to: string }> = []
  for (const e of realEdges) {
    if (!DATA_TARGET_HANDLES.has(e.targetHandle ?? '')) continue
    if (visited.has(e.source) && visited.has(e.target)) {
      subEdges.push({ from: e.source, to: e.target })
    }
  }

  // Kahn's algorithm for topological order (sources first). Ties broken by
  // insertion order of the nodes array for deterministic output.
  const subIds = nodes.filter(n => visited.has(n.id)).map(n => n.id)
  const indegree = new Map<string, number>(subIds.map(id => [id, 0]))
  for (const e of subEdges) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1)
  const ordered: string[] = []
  const ready = subIds.filter(id => (indegree.get(id) ?? 0) === 0)
  while (ready.length > 0) {
    const id = ready.shift() as string
    ordered.push(id)
    for (const e of subEdges) {
      if (e.from !== id) continue
      const deg = (indegree.get(e.to) ?? 0) - 1
      indegree.set(e.to, deg)
      if (deg === 0) ready.push(e.to)
    }
  }
  // Cycle remnant (indegree never reached 0): append in insertion order so no
  // entry is silently dropped.
  for (const id of subIds) if (!ordered.includes(id)) ordered.push(id)

  let stale = false
  const entries: LineageEntry[] = ordered.map(id => {
    const node = nodeById.get(id) as Node
    const d = node.data as Record<string, unknown>

    // Staleness heuristics (docs/context-accrual.md §7):
    // (a) the node has a status field but never ran this session;
    // (b) it claims a past run (resultsVersion > 0) but its store is empty.
    if ('status' in d && (d.status == null || d.status === '' || d.status === 'idle')) stale = true
    const version = asNumber(d.resultsVersion)
    if (version !== undefined && version > 0 && (getNodeResults(id) ?? []).length === 0) stale = true

    return {
      nodeId:   id,
      nodeType: node.type ?? 'unknown',
      label:    LABEL_BY_TYPE.get(node.type ?? '') ?? node.type ?? 'unknown',
      operationSummary: describeNode(node),
      params:   stripTransient(d),
      inCount:  asNumber(d.inputCount),
      outCount: asNumber(d.outputCount) ?? asNumber(d.count),
      resultsVersion: version,
    }
  })

  return { entries, edges: subEdges, stale }
}

// ─── Narrative rendering ──────────────────────────────────────────────────────

const STALE_NOTE =
  'Note: some upstream node settings may have changed since these records were retrieved.'

interface Section {
  header:  string | null   // null = un-headed common section
  lines:   string[]        // operation sentences, in order
  omitted: number          // steps dropped by the budget
}

function renderSections(sections: Section[], stale: boolean): string {
  const out: string[] = []
  if (stale) out.push(STALE_NOTE)
  for (const s of sections) {
    if (s.lines.length === 0 && s.omitted === 0) continue
    const indent = s.header ? '  ' : ''
    if (s.header) out.push(s.header)
    if (s.omitted > 0) out.push(`${indent}(… ${s.omitted} earlier step${s.omitted === 1 ? '' : 's'} omitted)`)
    s.lines.forEach((line, i) => out.push(`${indent}${i + 1}. ${line}`))
  }
  return out.join('\n')
}

/**
 * Render a LineageGraph as an LLM-ready narrative (docs/context-accrual.md §5).
 *
 * Linear chains become a numbered list. Parallel branches feeding the target
 * (or a join node such as MergeByQID) are rendered as lettered branch
 * sections; steps shared by several branches are described once in a common
 * section before them; the join and everything after it render under "Then:".
 * The character budget drops the earliest steps first (sources downward) and
 * never cuts mid-sentence.
 */
export function lineageToNarrative(graph: LineageGraph, opts?: { maxChars?: number }): string {
  const maxChars = opts?.maxChars ?? 2000
  const { entries, edges, stale } = graph
  if (entries.length === 0) return ''

  const order = new Map(entries.map((e, i) => [e.nodeId, i]))
  const byId = new Map(entries.map(e => [e.nodeId, e]))
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  for (const e of edges) {
    parents.set(e.to, [...(parents.get(e.to) ?? []), e.from])
    children.set(e.from, [...(children.get(e.from) ?? []), e.to])
  }

  // Join nodes (≥2 parents) and their descendants render after the branches.
  const postJoin = new Set<string>()
  for (const e of entries) if ((parents.get(e.nodeId) ?? []).length >= 2) postJoin.add(e.nodeId)
  let grew = true
  while (grew) {
    grew = false
    for (const e of entries) {
      if (postJoin.has(e.nodeId)) continue
      if ((parents.get(e.nodeId) ?? []).some(p => postJoin.has(p))) { postJoin.add(e.nodeId); grew = true }
    }
  }
  const preJoin = entries.filter(e => !postJoin.has(e.nodeId))

  // Branch terminals: pre-join nodes whose children all leave the pre-join set
  // (they feed the target or a join node).
  const terminals = preJoin.filter(e =>
    (children.get(e.nodeId) ?? []).every(c => postJoin.has(c) || !byId.has(c)))

  const sections: Section[] = []
  if (terminals.length <= 1) {
    // Linear (or single-strand) pipeline.
    sections.push({ header: null, lines: preJoin.map(e => e.operationSummary), omitted: 0 })
  } else {
    // Ancestor sets per terminal (within pre-join), to split shared vs exclusive.
    const reach = new Map<string, Set<string>>()
    for (const t of terminals) {
      const set = new Set<string>()
      const stack = [t.nodeId]
      while (stack.length > 0) {
        const id = stack.pop() as string
        if (set.has(id)) continue
        set.add(id)
        for (const p of parents.get(id) ?? []) if (!postJoin.has(p)) stack.push(p)
      }
      reach.set(t.nodeId, set)
    }
    const shared = preJoin.filter(e =>
      terminals.filter(t => (reach.get(t.nodeId) as Set<string>).has(e.nodeId)).length >= 2)
    const sharedIds = new Set(shared.map(e => e.nodeId))
    if (shared.length > 0) {
      sections.push({ header: null, lines: shared.map(e => e.operationSummary), omitted: 0 })
    }
    terminals
      .sort((a, b) => (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0))
      .forEach((t, i) => {
        const letter = String.fromCharCode(65 + i)
        const own = preJoin.filter(e =>
          (reach.get(t.nodeId) as Set<string>).has(e.nodeId) && !sharedIds.has(e.nodeId))
        sections.push({ header: `Branch ${letter}:`, lines: own.map(e => e.operationSummary), omitted: 0 })
      })
  }
  if (postJoin.size > 0) {
    const post = entries.filter(e => postJoin.has(e.nodeId))
    sections.push({ header: 'Then:', lines: post.map(e => e.operationSummary), omitted: 0 })
  }

  // Character budget: drop the earliest step of the earliest oversized section,
  // repeatedly, keeping at least the last line of every section.
  let text = renderSections(sections, stale)
  while (text.length > maxChars) {
    const victim = sections.find(s => s.lines.length > 1)
    if (!victim) break
    victim.lines.shift()
    victim.omitted += 1
    text = renderSections(sections, stale)
  }
  return text
}
