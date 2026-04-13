import { useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runLLDSNode } from '../utils/runLLDSNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type LLDSStatus = 'idle' | 'loading' | 'success' | 'cached' | 'error'

export interface LLDSSearchNodeData {
  inlineQuery: string
  inlineLimit: string
  /** When true (default), a fresh localStorage cache is reused within 24 h.
   *  Uncheck to force a live fetch on the next Run. */
  useCache:      boolean
  status:        LLDSStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  [key: string]: unknown
}

// Two rows, both with left-side handles
const HANDLE_PARAMS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'e.g. Stonehenge', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',               rowIndex: 1 },
] as const

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

const STATUS_COLORS: Record<LLDSStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  cached:  '#f59e0b',
  error:   '#ef4444',
}

const STATUS_BADGE_COLORS: Record<LLDSStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  cached:  '#fcd34d',
  error:   '#fca5a5',
}

export function LLDSSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as LLDSSearchNodeData

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => runLLDSNode(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const status      = (d.status as LLDSStatus) ?? 'idle'
  const borderColor = STATUS_COLORS[status] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Left input handles */}
      {HANDLE_PARAMS.map(({ handleId, rowIndex }) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{
            ...styles.inputHandle,
            top: handleTop(rowIndex),
            background: isConnected(handleId) ? '#3b82f6' : '#9ca3af',
            boxShadow: `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#9ca3af'}`,
          }}
        />
      ))}

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>LLDS Search</span>
        {d.statusMessage ? (
          <span style={{
            ...styles.statusBadge,
            color: STATUS_BADGE_COLORS[status] ?? '#9ca3af',
          }}>
            {d.statusMessage}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {HANDLE_PARAMS.map(({ handleId, dataKey, label, placeholder }) => (
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
        <label
          style={styles.cacheToggle}
          className="nodrag"
          title="Reuse the locally cached result if less than 24 h old. Uncheck to force a live request."
        >
          <input
            type="checkbox"
            checked={d.useCache ?? true}
            onChange={e => updateNodeData(id, { useCache: e.target.checked })}
            className="nodrag"
          />
          <span style={{ color: (d.useCache ?? true) ? '#92400e' : '#6b7280' }}>
            {status === 'cached' ? '📦 cached' : 'use cache'}
          </span>
        </label>
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

const HEADER_COLOR  = '#92400e'
const RUN_BTN_COLOR = '#78350f'

const styles = {
  card: {
    background:   '#fff',
    border:       '2px solid #d1d5db',
    borderRadius: 8,
    minWidth:     240,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
    transition:   'border-color 0.25s',
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
    flex:         1,
    fontSize:     11,
    padding:      '2px 5px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    outline:      'none',
    minWidth:     0,
    height:       22,
  },
  connectedBadge: {
    fontSize:  10,
    color:     '#3b82f6',
    fontStyle: 'italic' as const,
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
    padding:        '6px 10px 8px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'flex-end',
    gap:            8,
  },
  cacheToggle: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    fontSize:   10,
    cursor:     'pointer',
    flex:       1,
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
  },
  outputHandle: {
    width:      10,
    height:     10,
    background: '#22c55e',
    border:     '2px solid #fff',
    boxShadow:  '0 0 0 1px #22c55e',
  },
}
