/**
 * SaveSearchNode — sink node that serialises upstream UnifiedRecord[] to a
 * .nfcs.json file with a metadata envelope (_nfcs block).
 *
 * Uses showSaveFilePicker (Chrome/Edge 86+) so the user can choose save
 * location and filename. Falls back to a triggered <a download> on Firefox.
 *
 * No runner — saving is a direct user gesture.
 */
import { useCallback } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { stripTransient } from '../utils/workflowIO'
import { downloadFile } from '../utils/exportUtils'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { NfcsSavedSearch } from '../types/savedSearch'

export interface SaveSearchNodeData {
  status: 'idle' | 'saving' | 'saved' | 'error'
  statusMessage: string
  lastSavedFile: string
  lastSavedAt: string
  [key: string]: unknown
}

const HEADER_COLOR = '#1b4332'

const STATUS_BORDER: Record<string, string> = {
  idle:   '#d1d5db',
  saving: '#3b82f6',
  saved:  '#22c55e',
  error:  '#ef4444',
}

const HAS_SAVE_PICKER =
  typeof window !== 'undefined' && 'showSaveFilePicker' in window

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSuggestedName(records: UnifiedRecord[]): string {
  const counts: Record<string, number> = {}
  for (const r of records) {
    const s = r._source ?? 'search'
    counts[s] = (counts[s] ?? 0) + 1
  }
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s]) => s)
  const sourceStr = top.length > 0 ? top.join('-') : 'search'
  return `${sourceStr}-${new Date().toISOString().slice(0, 10)}.nfcs.json`
}

/**
 * Walk upstream via data-handle edges and return the data of all source nodes
 * (those with no data-handle inputs of their own). Keyed by "{type}::{id}".
 */
function collectSourceParams(
  nodeId: string,
  getNodes: () => { id: string; type?: string; data: Record<string, unknown> }[],
  getEdges: () => { source: string; target: string; targetHandle?: string | null; sourceHandle?: string | null }[],
): Record<string, Record<string, unknown>> {
  const nodes = getNodes()
  const edges = getEdges()
  const visited = new Set<string>()
  const queue = [nodeId]
  const params: Record<string, Record<string, unknown>> = {}

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)

    const inEdges = edges.filter(e => e.target === id && e.targetHandle === 'data')
    for (const edge of inEdges) {
      const src = nodes.find(n => n.id === edge.source)
      if (!src || visited.has(src.id)) continue

      const srcHasDataInput = edges.some(e => e.target === src.id && e.targetHandle === 'data')
      if (!srcHasDataInput) {
        // Source node — no upstream data feed
        params[`${src.type ?? 'unknown'}::${src.id}`] =
          stripTransient(src.data as Record<string, unknown>)
      }
      queue.push(src.id)
    }
  }

  return params
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SaveSearchNode({ id, data }: NodeProps) {
  const d = data as SaveSearchNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { records, connected, count } = useUpstreamRecords(id)

  // Live source breakdown for preview
  const sourceCounts: Record<string, number> = {}
  for (const r of records ?? []) {
    const s = r._source ?? 'unknown'
    sourceCounts[s] = (sourceCounts[s] ?? 0) + 1
  }
  const sources = Object.keys(sourceCounts).sort()
  const suggestedName = records && records.length > 0
    ? buildSuggestedName(records)
    : null

  const handleSave = useCallback(async () => {
    if (!records || records.length === 0) return

    const searchParams = collectSourceParams(id, getNodes, getEdges)

    const sc: Record<string, number> = {}
    for (const r of records) {
      const s = r._source ?? 'unknown'
      sc[s] = (sc[s] ?? 0) + 1
    }

    const envelope: NfcsSavedSearch = {
      _nfcs: {
        version: 1,
        savedAt: new Date().toISOString(),
        sources: Object.keys(sc).sort(),
        sourceCounts: sc,
        recordCount: records.length,
        searchParams,
      },
      records,
    }

    const content = JSON.stringify(envelope, null, 2)
    const name = buildSuggestedName(records)

    updateNodeData(id, { status: 'saving', statusMessage: 'Saving…' })

    try {
      let savedName = name

      if (HAS_SAVE_PICKER) {
        type WritableStream = { write(s: string): Promise<void>; close(): Promise<void> }
        type FileHandle = { createWritable(): Promise<WritableStream>; name: string }
        const handle = await (window as unknown as {
          showSaveFilePicker(opts: object): Promise<FileHandle>
        }).showSaveFilePicker({
          suggestedName: name,
          types: [{
            description: 'NFCS Saved Search',
            accept: { 'application/json': ['.json'] },
          }],
        })
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
        savedName = handle.name
      } else {
        downloadFile(content, name, 'application/json')
      }

      updateNodeData(id, {
        status:        'saved',
        statusMessage: `✓ ${savedName}`,
        lastSavedFile: savedName,
        lastSavedAt:   new Date().toISOString(),
      })
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        updateNodeData(id, { status: 'idle', statusMessage: '' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [id, records, getNodes, getEdges, updateNodeData])

  const status     = (d.status as string | undefined) ?? 'idle'
  const canSave    = connected && count > 0
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Save Search</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus} title={d.statusMessage as string}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {!connected ? (
          <p style={styles.hint}>Connect an upstream node</p>
        ) : (
          <>
            {/* Record + source breakdown */}
            <div style={styles.summaryRow}>
              <span style={styles.countBadge}>{count} records</span>
              <span style={styles.sourceChips}>
                {sources.map(s => (
                  <span key={s} style={styles.chip}>
                    {s}&nbsp;<span style={styles.chipCount}>{sourceCounts[s]}</span>
                  </span>
                ))}
              </span>
            </div>

            {/* Filename preview */}
            {suggestedName && (
              <div style={styles.filenameRow}>
                <span style={styles.filenameLabel}>filename</span>
                <span style={styles.filename}>{suggestedName}</span>
              </div>
            )}

            {/* Metadata that will be included */}
            <div style={styles.metaNote}>
              Will save with: saved date · source breakdown · search parameters
            </div>

            {/* Last saved */}
            {d.lastSavedFile && (
              <div style={styles.lastSaved}>
                <span style={styles.lastSavedLabel}>Last saved</span>
                <span style={styles.lastSavedName} title={d.lastSavedFile as string}>
                  {d.lastSavedFile as string}
                </span>
              </div>
            )}
          </>
        )}

        {!HAS_SAVE_PICKER && connected && (
          <p style={styles.fallbackNote}>
            No save dialog available — file will download automatically.
          </p>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button
          style={{ ...styles.btn, opacity: canSave && status !== 'saving' ? 1 : 0.4 }}
          disabled={!canSave || status === 'saving'}
          onClick={handleSave}
          className="nodrag"
        >
          {status === 'saving'
            ? 'Saving…'
            : HAS_SAVE_PICKER
              ? '💾  Save As…'
              : '💾  Save'}
        </button>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background:   '#fff',
    border:       '2px solid #d1d5db',
    borderRadius: 8,
    minWidth:     240,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
    transition:   'border-color 0.2s',
  },
  header: {
    height:         32,
    background:     HEADER_COLOR,
    borderRadius:   '6px 6px 0 0',
    padding:        '0 10px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  headerTitle: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
    flexShrink: 0,
  },
  headerStatus: {
    fontSize:     10,
    fontWeight:   600,
    color:        '#a7f3d0',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  body: {
    padding:       '10px 12px 6px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
  },
  hint: {
    margin:     0,
    fontSize:   11,
    color:      '#9ca3af',
    fontStyle:  'italic' as const,
  },
  summaryRow: {
    display:    'flex',
    alignItems: 'center',
    flexWrap:   'wrap' as const,
    gap:        5,
  },
  countBadge: {
    fontSize:     10,
    fontWeight:   700,
    background:   '#d1fae5',
    color:        '#065f46',
    border:       '1px solid #6ee7b7',
    borderRadius: 10,
    padding:      '1px 7px',
    flexShrink:   0,
  },
  sourceChips: {
    display:  'flex',
    flexWrap: 'wrap' as const,
    gap:      3,
  },
  chip: {
    fontSize:     9,
    fontWeight:   600,
    background:   '#f0fdf4',
    color:        '#166534',
    border:       '1px solid #bbf7d0',
    borderRadius: 8,
    padding:      '1px 5px',
  },
  chipCount: {
    opacity: 0.7,
  },
  filenameRow: {
    display:    'flex',
    alignItems: 'baseline',
    gap:        5,
  },
  filenameLabel: {
    fontSize:   9,
    color:      '#9ca3af',
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  filename: {
    fontSize:     10,
    color:        '#374151',
    fontFamily:   'monospace',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  metaNote: {
    fontSize:   9,
    color:      '#6b7280',
    fontStyle:  'italic' as const,
    lineHeight: 1.4,
    padding:    '3px 6px',
    background: '#f9fafb',
    borderRadius: 4,
    border:     '1px solid #e5e7eb',
  },
  lastSaved: {
    display:    'flex',
    alignItems: 'center',
    gap:        5,
    marginTop:  2,
  },
  lastSavedLabel: {
    fontSize:   9,
    color:      '#9ca3af',
    flexShrink: 0,
  },
  lastSavedName: {
    fontSize:     10,
    color:        '#059669',
    fontFamily:   'monospace',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  fallbackNote: {
    margin:    0,
    fontSize:  9,
    color:     '#d97706',
    fontStyle: 'italic' as const,
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    justifyContent: 'flex-end',
  },
  btn: {
    background:   HEADER_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 14px',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
  },
  inputHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
}
