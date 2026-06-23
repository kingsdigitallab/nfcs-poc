import type { Edge, Node } from '@xyflow/react'

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
  extent?: unknown
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
  'filterCount',
  'totalCount',
  'resolved',
  'pending',
  'failed',
  'proxyInCount',     // runtime-only
  'proxyOutCount',    // runtime-only
  'rowSelections',    // per-run row filter — meaningless without live record IDs
])

export function stripTransient(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!TRANSIENT_FIELDS.has(k)) out[k] = v
  }
  return out
}

export function buildWorkflowPayload(nodes: Node[], edges: Edge[], extras?: WorkflowExtras): WorkflowFile {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    nodes: nodes.map(n => {
      const saved: SavedNode = {
        id: n.id,
        type: n.type ?? '',
        position: n.position,
        data: stripTransient(n.data as Record<string, unknown>),
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
export function hydrateNodes(saved: WorkflowFile): Node[] {
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
    if (n.width != null) node.width = n.width
    if (n.height != null) node.height = n.height
    if (n.parentId) node.parentId = n.parentId
    if (n.extent) node.extent = n.extent
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
    return node
  })
}
