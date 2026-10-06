import type { CoordinateExtent, Edge, Node } from '@xyflow/react'
import { TABLE_OUTPUT_SIZE, KCL_API_KEY_NODES } from '../config/nodeDefaults'
import { DEFAULT_KCL_API_KEY, DEFAULT_EUROPEANA_API_KEY } from './kclConfig'

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface WorkflowFile {
  version: 1 | 2
  savedAt: string
  nodes: SavedNode[]
  edges: Edge[]
  /** Identity of the workflow that authored the notes blob below. */
  workflowId?: string
  /** Per-node human annotations, keyed `${nodeId}::${recordId}`. */
  notes?: Record<string, string>
}

/** Extra payload threaded into a saved workflow alongside nodes/edges. */
export interface WorkflowExtras {
  workflowId?: string
  notes?: Record<string, string>
}

interface SavedNode {
  id: string
  type: string
  position: { x: number; y: number }
  width?: number
  height?: number
  data: Record<string, unknown>
  parentId?: string
  extent?: 'parent' | CoordinateExtent
  style?: { width?: number; height?: number }
}

// ─── Serialisation ────────────────────────────────────────────────────────────

/**
 * Fields that are runtime-only and must not be persisted.
 * Includes: result arrays, status strings, counters, and the folder handle
 * surrogate (folderName is cleared because the FileSystemDirectoryHandle
 * itself is never serialisable — the user must re-pick on load).
 */
const TRANSIENT_FIELDS = new Set([
  'results',
  'status',
  'statusMessage',
  'count',
  'inputCount',
  'outputCount',
  'resolvedCount',
  'reviewCount',
  'removedCount',
  'resultsVersion',
  '_capped',
  '_total',
  'folderName',  // not serialisable
  'gisLayers',
  'gisCount',
  'fileName',
  'columnNames',
  'pdfCount',
  'xmlCount',
  'textCount',
  'imageCount',
  'csvCount',
  'filterCount',
  'totalCount',
  'resolved',
  'pending',
  'failed',
  'proxyInCount',     // runtime-only
  'proxyOutCount',    // runtime-only
  'rowSelections',    // per-run row filter — meaningless without live record IDs
  'apiKey',           // credential — never persist; re-filled from the build-time default on load
])

export function stripTransient(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!TRANSIENT_FIELDS.has(k)) out[k] = v
  }
  return out
}

/** Target handle ids that carry a credential. A Param wired into one of these
 *  holds a secret in `data.value`, which must not be serialised either. */
const CREDENTIAL_HANDLES = new Set(['apiKey'])

/** Shape GroupNode writes into `data.proxyEdges` when it collapses. */
interface ProxyEdgeRecord {
  edgeId: string
  side: 'in' | 'out'
  originalSource: string
  originalTarget: string
  originalSourceHandle?: string | null
  originalTargetHandle?: string | null
}

interface EdgeLike { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
interface NodeLike { id: string; type?: string; data: Record<string, unknown> }

function proxyRecordsOf(node: NodeLike | undefined): ProxyEdgeRecord[] {
  const raw = node?.type === 'group' ? node.data.proxyEdges : undefined
  return Array.isArray(raw) ? (raw as ProxyEdgeRecord[]) : []
}

/**
 * Resolve BOTH ends of edges that a collapsed group rewrote onto its
 * `proxy-in-N` / `proxy-out-N` handles back to the real child endpoints.
 * (`resolveProxyEdges` in upstreamRecords.ts only resolves the source side,
 * which is all runners need; save/load must see the target side too.)
 */
function resolveSavedEdges<E extends EdgeLike>(nodes: NodeLike[], edges: E[]): E[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  return edges.map(edge => {
    let out = edge
    if (edge.targetHandle?.startsWith('proxy-in-')) {
      const rec = proxyRecordsOf(byId.get(edge.target)).find(p => p.side === 'in' && p.edgeId === edge.id)
      if (rec) out = { ...out, target: rec.originalTarget, targetHandle: rec.originalTargetHandle ?? undefined }
    }
    if (edge.sourceHandle?.startsWith('proxy-out-')) {
      const rec = proxyRecordsOf(byId.get(edge.source)).find(p => p.side === 'out' && p.edgeId === edge.id)
      if (rec) out = { ...out, source: rec.originalSource, sourceHandle: rec.originalSourceHandle ?? undefined }
    }
    return out
  })
}

/** Param node id → type of the node whose credential handle it feeds. */
function credentialParams(nodes: NodeLike[], edges: EdgeLike[]): Map<string, string> {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const out = new Map<string, string>()
  for (const e of resolveSavedEdges(nodes, edges)) {
    if (!CREDENTIAL_HANDLES.has(e.targetHandle ?? '')) continue
    const src = byId.get(e.source)
    if (src?.type !== 'param') continue
    out.set(src.id, byId.get(e.target)?.type ?? '')
  }
  return out
}

export function buildWorkflowPayload(nodes: Node[], edges: Edge[], extras?: WorkflowExtras): WorkflowFile {
  const credentialParamIds = credentialParams(nodes as NodeLike[], edges)
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    nodes: nodes.map(n => {
      const data = stripTransient(n.data as Record<string, unknown>)
      if (credentialParamIds.has(n.id)) data.value = ''
      const saved: SavedNode = {
        id: n.id,
        type: n.type ?? '',
        position: n.position,
        data,
      }
      if (n.width != null) saved.width = n.width
      if (n.height != null) saved.height = n.height
      if (n.parentId) saved.parentId = n.parentId
      if (n.extent) saved.extent = n.extent
      if (n.style) saved.style = n.style as { width?: number; height?: number }
      return saved
    }),
    edges,
    ...(extras?.workflowId ? { workflowId: extras.workflowId } : {}),
    ...(extras?.notes && Object.keys(extras.notes).length > 0 ? { notes: extras.notes } : {}),
  }
}

export function downloadWorkflow(nodes: Node[], edges: Edge[], extras?: WorkflowExtras): void {
  const file = buildWorkflowPayload(nodes, edges, extras)
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `workflow-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Deserialisation ──────────────────────────────────────────────────────────

/**
 * Remove nodes whose `type` is not registered in this build (e.g. a node that
 * has since been retired) together with every edge that touches them, so the
 * rest of a saved workflow still loads. React Flow would otherwise render an
 * unknown type as a blank default box with no handles. Returns the same object
 * when nothing was dropped.
 */
export function partitionUnknownNodes(
  file: WorkflowFile,
  knownTypes: ReadonlySet<string>,
): { file: WorkflowFile; dropped: { id: string; type: string }[] } {
  const dropped = file.nodes
    .filter(n => !knownTypes.has(n.type))
    .map(n => ({ id: n.id, type: n.type }))
  if (dropped.length === 0) return { file, dropped }
  const droppedIds = new Set(dropped.map(d => d.id))
  // An edge into/out of a collapsed group stands for an edge to a child; judge
  // it by the child it really connects to, then forget the group's record of it.
  const resolved = resolveSavedEdges(file.nodes, file.edges)
  const keptEdgeIds = new Set(
    resolved.filter(e => !droppedIds.has(e.source) && !droppedIds.has(e.target)).map(e => e.id),
  )
  return {
    file: {
      ...file,
      nodes: file.nodes
        .filter(n => !droppedIds.has(n.id))
        .map(n => {
          const recs = proxyRecordsOf(n)
          if (recs.length === 0) return n
          const pruned = recs.filter(p => !droppedIds.has(p.originalSource) && !droppedIds.has(p.originalTarget))
          return pruned.length === recs.length ? n : { ...n, data: { ...n.data, proxyEdges: pruned } }
        }),
      edges: file.edges.filter(e => keptEdgeIds.has(e.id)),
    },
    dropped,
  }
}

/**
 * Runtime defaults injected into every node on load so components start in a
 * clean idle state regardless of what was (or wasn't) in the saved file.
 */
const RUNTIME_DEFAULTS: Record<string, unknown> = {
  status: 'idle',
  statusMessage: '',
  count: 0,
  inputCount: 0,
  outputCount: 0,
  resolvedCount: 0,
  reviewCount: 0,
  resultsVersion: 0,
}

export function parseWorkflowFile(json: string): WorkflowFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('File is not valid JSON.')
  }
  const p = parsed as Record<string, unknown>
  const hasVersion = 'version' in p
  if (!hasVersion || (p.version !== 1 && p.version !== 2)) {
    throw new Error('Not a recognised workflow file (expected version: 1 or 2).')
  }
  return parsed as WorkflowFile
}

/**
 * Reconstruct React Flow nodes from a saved workflow, merging in runtime
 * defaults so every node starts idle with no stale result counts.
 */
/**
 * Build-time credential a node type should start with when the saved file
 * carries none (apiKey is stripped on save — see TRANSIENT_FIELDS).
 */
function defaultCredentialFor(type: string): string | undefined {
  if (KCL_API_KEY_NODES.has(type)) return DEFAULT_KCL_API_KEY
  if (type === 'europeanaSearch') return DEFAULT_EUROPEANA_API_KEY
  return undefined
}

export function hydrateNodes(saved: WorkflowFile): Node[] {
  // Params feeding a credential handle were blanked on save; give them the same
  // build-time default the target node itself would start with.
  const credentialParamTargets = credentialParams(saved.nodes, saved.edges)

  // Find all collapsed group IDs so we can preserve child opacity when reloading
  const collapsedParents = new Set(
    saved.nodes
      .filter(n => n.type === 'group' && (n.data as any).collapsed === true)
      .map(n => n.id)
  )

  return saved.nodes.map(n => {
    const node: Node = {
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...RUNTIME_DEFAULTS, ...n.data },
    }
    const credential = defaultCredentialFor(n.type)
    if (credential !== undefined && !node.data.apiKey) node.data.apiKey = credential
    const feeds = credentialParamTargets.get(n.id)
    if (feeds !== undefined && !node.data.value) {
      node.data.value = defaultCredentialFor(feeds) ?? ''
    }
    if (n.width != null) node.width = n.width
    if (n.height != null) node.height = n.height
    if (n.parentId) node.parentId = n.parentId
    if (n.extent) node.extent = n.extent
    if (n.extent === 'parent') (node as any).expandParent = true
    if (n.style) {
      const clean = { ...n.style }
      // Only strip collapse-related styles if the parent is NOT collapsed.
      // Children inside collapsed groups must keep opacity:0 on reload.
      if (!collapsedParents.has(n.parentId ?? '')) {
        if ('opacity' in clean) delete (clean as any).opacity
        if ('pointerEvents' in clean) delete (clean as any).pointerEvents
        if ('overflow' in clean) delete (clean as any).overflow
      }
      node.style = clean
    }
    // Legacy backfill: tableOutput saved without an explicit width (e.g. from
    // QuickStart instantiation before it set one) balloons to fit every column
    // instead of scrolling. Leave user-resized nodes untouched.
    if (n.type === 'tableOutput' && n.width == null && n.style?.width == null) {
      node.style = { ...node.style, width: TABLE_OUTPUT_SIZE.width }
      if (n.height == null && n.style?.height == null) node.style.height = TABLE_OUTPUT_SIZE.height
    }
    return node
  })
}
