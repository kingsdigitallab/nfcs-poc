import { useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { runDeduplicateNode } from '../utils/runDeduplicateNode'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'

function allFlatFields(records: unknown[]): string[] {
  const seen = new Set<string>()
  for (const rec of (records as Record<string, unknown>[]).slice(0, 30)) {
    for (const [k, v] of Object.entries(rec)) {
      if (v == null) continue
      if (typeof v === 'object' && !Array.isArray(v)) continue
      seen.add(k)
    }
  }
  return [...seen].sort()
}

// ─── types ────────────────────────────────────────────────────────────────────

export interface DeduplicateNodeData {
  dedupeField:   string
  status:        'idle' | 'running' | 'success' | 'error'
  statusMessage: string
  inputCount:    number
  outputCount:   number
  removedCount:  number
  [key: string]: unknown
}

// ─── component ────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#2f6660'  // teal-700

export function DeduplicateNode({ id }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: snap } = useReactFlow()
  const { records: upstreamRecords, connected } = useUpstreamRecords(id)

  const nodeData = getNodes().find(n => n.id === id)?.data as DeduplicateNodeData | undefined
  const d: DeduplicateNodeData = {
    dedupeField:   'id',
    status:        'idle',
    statusMessage: '',
    inputCount:    0,
    outputCount:   0,
    removedCount:  0,
    ...nodeData,
  }

  const fields = upstreamRecords?.length ? allFlatFields(upstreamRecords) : []

  const handleRun = useCallback(
    () => runDeduplicateNode(id, getNodes, snap(), updateNodeData),
    [id, getNodes, snap, updateNodeData],
  )

  return (
    <div style={S.card}>
      <Handle type="target" position={Position.Left}  id="data"    style={S.inHandle} />
      <Handle type="source" position={Position.Right} id="results" style={S.outHandle} />

      {/* Header */}
      <div style={S.header}>
        <span style={S.headerTitle}>Deduplicate</span>
        {d.statusMessage && (
          <span style={{ ...S.statusBadge, color: d.status === 'error' ? '#fca5a5' : '#a5f3fc' }}>
            {d.statusMessage}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={S.body} className="nodrag nowheel">
        <label style={S.label}>Deduplicate by field</label>
        <select
          value={d.dedupeField}
          onChange={e => updateNodeData(id, { dedupeField: e.target.value })}
          style={S.sel}
          className="nodrag"
        >
          {fields.length === 0 && (
            <option value={d.dedupeField}>{d.dedupeField || '— connect upstream node —'}</option>
          )}
          {fields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <p style={S.hint}>
          First occurrence of each unique value is kept. Records missing the field always pass through.
        </p>

        {!connected && (
          <p style={S.emptyHint}>Connect an upstream node to populate field selector</p>
        )}
      </div>

      {/* Footer */}
      <div style={S.footer}>
        {d.status === 'success' && (
          <span style={S.preview}>
            {d.inputCount} in → {d.outputCount} unique ({d.removedCount} removed)
          </span>
        )}
        <button
          style={{ ...S.runBtn, opacity: !connected ? 0.45 : 1 }}
          disabled={!connected}
          onClick={handleRun}
          className="nodrag"
        >
          ▶  Deduplicate
        </button>
      </div>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const S = {
  card: {
    background:   '#fff',
    border:       '1.5px solid #d1d5db',
    borderRadius: 8,
    minWidth:     280,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
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
  statusBadge: {
    fontSize:     10,
    fontWeight:   600,
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
  label: {
    fontSize:   11,
    fontWeight: 600,
    color:      '#374151',
  },
  sel: {
    fontSize:     11,
    padding:      '3px 5px',
    border:       '1px solid #d1d5db',
    borderRadius: 3,
    background:   '#f9fafb',
    outline:      'none',
    height:       24,
    width:        '100%',
  },
  hint: {
    fontSize:  10,
    color:     '#6b7280',
    margin:    0,
    lineHeight: 1.4,
  },
  emptyHint: {
    fontSize:  10,
    color:     '#9ca3af',
    fontStyle: 'italic' as const,
    margin:    0,
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'flex-end',
    gap:            10,
    borderTop:      '1px solid #f0f0f0',
  },
  preview: {
    fontSize:   11,
    color:      '#15803d',
    fontWeight: 600,
    flex:       1,
  },
  runBtn: {
    background:   HEADER_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 14px',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
  },
  inHandle: {
    width:      10,
    height:     10,
    background: HEADER_COLOR,
    border:     '2px solid #fff',
    boxShadow:  `0 0 0 1px ${HEADER_COLOR}`,
  },
  outHandle: {
    width:      10,
    height:     10,
    background: HEADER_COLOR,
    border:     '2px solid #fff',
    boxShadow:  `0 0 0 1px ${HEADER_COLOR}`,
    top:        13,
  },
}
