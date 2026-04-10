import { useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runMDSNode } from '../utils/runMDSNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type MDSStatus = 'idle' | 'loading' | 'success' | 'error'

export interface MDSSearchNodeData {
  inlineQuery: string
  inlineLimit: string
  status:        MDSStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  _capped:       boolean
  _total:        number
  [key: string]: unknown
}

// ─── handle layout (must match ADSSearchNode pattern exactly) ─────────────────

const PARAMS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'q', placeholder: 'e.g. Roman coin', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',               rowIndex: 1 },
] as const

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

// ─── status colours ───────────────────────────────────────────────────────────

const STATUS_BORDER: Record<MDSStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

const STATUS_BADGE: Record<MDSStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
}

// ─── component ────────────────────────────────────────────────────────────────

export function MDSSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as MDSSearchNodeData

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => runMDSNode(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const status      = (d.status as MDSStatus) ?? 'idle'
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'
  const badgeColor  = STATUS_BADGE[status]  ?? '#9ca3af'
  // Highlight the badge amber when results were capped
  const effectiveBadgeColor = d._capped ? '#fbbf24' : badgeColor

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Left input handles */}
      {PARAMS.map(({ handleId, rowIndex }) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{
            ...styles.inputHandle,
            top: handleTop(rowIndex),
            background:  isConnected(handleId) ? '#3b82f6' : '#9ca3af',
            boxShadow:  `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#9ca3af'}`,
          }}
        />
      ))}

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>MDS Search</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: effectiveBadgeColor }}>
            {d.statusMessage}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {PARAMS.map(({ handleId, dataKey, label, placeholder }) => (
          <div key={handleId} style={styles.row}>
            <span style={styles.paramLabel}>{label}</span>
            {isConnected(handleId) ? (
              <span style={styles.connectedBadge}>↔ wired</span>
            ) : (
              <input
                style={styles.inlineInput}
                value={(d[dataKey] as string | undefined) ?? ''}
                onChange={e => updateNodeData(id, { [dataKey]: e.target.value })}
                placeholder={placeholder}
                className="nodrag"
              />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <span style={styles.caption}>Scrapes museumdata.uk — not a formal API</span>
        <button
          style={{ ...styles.runBtn, opacity: status === 'loading' ? 0.6 : 1 }}
          onClick={handleRun}
          disabled={status === 'loading'}
          className="nodrag"
        >
          {status === 'loading' ? 'Running…' : '▶  Run'}
        </button>
      </div>

      {/* Right output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={styles.outputHandle}
      />
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const HEADER_COLOR  = '#1e3a8a'   // dark navy — distinct from all other nodes
const RUN_BTN_COLOR = '#1e40af'

const styles = {
  card: {
    background:  '#fff',
    border:      '2px solid #d1d5db',
    borderRadius: 8,
    minWidth:    240,
    boxShadow:   '0 1px 4px rgba(0,0,0,0.08)',
    position:    'relative' as const,
    transition:  'border-color 0.25s',
  },
  header: {
    height:         HEADER_H,
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
    paddingTop:    BODY_PAD,
    paddingLeft:   14,
    paddingRight:  10,
    paddingBottom: 4,
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           5,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    height:     22,
  },
  paramLabel: {
    fontSize:   11,
    color:      '#6b7280',
    width:      40,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  inlineInput: {
    flex:        1,
    fontSize:    11,
    padding:     '2px 5px',
    border:      '1px solid #d1d5db',
    borderRadius: 4,
    outline:     'none',
    minWidth:    0,
    height:      22,
  },
  connectedBadge: {
    fontSize:   10,
    color:      '#3b82f6',
    fontStyle:  'italic' as const,
  },
  inputHandle: {
    width:        8,
    height:       8,
    border:       '2px solid #fff',
    position:     'absolute' as const,
    left:         -5,
    borderRadius: '50%',
  },
  footer: {
    padding:        '5px 10px 8px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  caption: {
    fontSize:   9,
    color:      '#9ca3af',
    fontStyle:  'italic' as const,
    lineHeight: 1.3,
    maxWidth:   130,
  },
  runBtn: {
    background:   RUN_BTN_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 14px',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
    flexShrink:   0,
  },
  outputHandle: {
    width:     10,
    height:    10,
    background: '#22c55e',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
  },
}
