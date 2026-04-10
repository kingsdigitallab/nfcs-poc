import { useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runADSNode } from '../utils/runADSNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type ADSStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ADSSearchNodeData {
  inlineQuery: string
  inlineLimit: string
  status: ADSStatus
  statusMessage: string
  results: UnifiedRecord[] | undefined
  count: number
  [key: string]: unknown
}

const PARAMS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'e.g. Stonehenge', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',              rowIndex: 1 },
] as const

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

const STATUS_BORDER: Record<ADSStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

const STATUS_BADGE: Record<ADSStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
}

export function ADSSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as ADSSearchNodeData

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => runADSNode(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const borderColor = STATUS_BORDER[d.status as ADSStatus] ?? '#d1d5db'

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
            background: isConnected(handleId) ? '#3b82f6' : '#9ca3af',
            boxShadow: `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#9ca3af'}`,
          }}
        />
      ))}

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>ADS Search</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: STATUS_BADGE[d.status as ADSStatus] ?? '#9ca3af' }}>
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
        <button
          style={{ ...styles.runBtn, opacity: d.status === 'loading' ? 0.6 : 1 }}
          onClick={handleRun}
          disabled={d.status === 'loading'}
          className="nodrag"
        >
          {d.status === 'loading' ? 'Running…' : '▶  Run'}
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

const HEADER_COLOR  = '#7c2d12'   // dark terracotta — distinct from LLDS amber
const RUN_BTN_COLOR = '#6b2111'

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 240,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
  },
  header: {
    height: HEADER_H,
    background: HEADER_COLOR,
    borderRadius: '6px 6px 0 0',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  body: {
    paddingTop: BODY_PAD,
    paddingLeft: 14,
    paddingRight: 10,
    paddingBottom: 4,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 5,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 22,
  },
  paramLabel: {
    fontSize: 11,
    color: '#6b7280',
    width: 40,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  inlineInput: {
    flex: 1,
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    minWidth: 0,
    height: 22,
  },
  connectedBadge: {
    fontSize: 10,
    color: '#3b82f6',
    fontStyle: 'italic' as const,
  },
  inputHandle: {
    width: 8,
    height: 8,
    border: '2px solid #fff',
    position: 'absolute' as const,
    left: -5,
    borderRadius: '50%',
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  runBtn: {
    background: RUN_BTN_COLOR,
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  outputHandle: {
    width: 10,
    height: 10,
    background: '#22c55e',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
  },
}
