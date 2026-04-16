import type { Edge, Node } from '@xyflow/react'

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface WorkflowFile {
  version: 1
  savedAt: string
  nodes: SavedNode[]
  edges: Edge[]
}

interface SavedNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
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
  'resultsVersion',
  '_capped',
  '_total',
  'folderName', // not serialisable — user must re-pick the folder
])

function stripTransient(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!TRANSIENT_FIELDS.has(k)) out[k] = v
  }
  return out
}

export function downloadWorkflow(nodes: Node[], edges: Edge[]): void {
  const file: WorkflowFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type ?? '',
      position: n.position,
      data: stripTransient(n.data as Record<string, unknown>),
    })),
    edges,
  }

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
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1
  ) {
    throw new Error('Not a recognised workflow file (expected version: 1).')
  }
  return parsed as WorkflowFile
}

/**
 * Reconstruct React Flow nodes from a saved workflow, merging in runtime
 * defaults so every node starts idle with no stale result counts.
 */
export function hydrateNodes(saved: WorkflowFile): Node[] {
  return saved.nodes.map(n => ({
    id: n.id,
    type: n.type,
    position: n.position,
    // Runtime defaults first so saved config always wins, except we never
    // restore the old status/counts.
    data: { ...RUNTIME_DEFAULTS, ...n.data },
  }))
}
