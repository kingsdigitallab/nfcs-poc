import { useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runADSLibraryNode } from '../utils/runADSLibraryNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type ADSLibraryStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ADSLibraryNodeData {
  inlineQuery: string
  inlineLimit: string
  status:        ADSLibraryStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  _capped:       boolean
  _total:        number
  [key: string]: unknown
}

const PARAMS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'e.g. Hadrian', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',           rowIndex: 1 },
] as const

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

const STATUS_BORDER: Record<ADSLibraryStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

const STATUS_BADGE: Record<ADSLibraryStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
}

const HEADER_COLOR  = '#1e3a5f'
const RUN_BTN_COLOR = '#162d4a'

export function ADSLibraryNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as ADSLibraryNodeData

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => runADSLibraryNode(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const borderColor = STATUS_BORDER[d.status as ADSLibraryStatus] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
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

      <div style={{ ...styles.header, background: HEADER_COLOR }}>
        <span style={styles.headerTitle}>ADS Library</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: STATUS_BADGE[d.status as ADSLibraryStatus] ?? '#9ca3af' }}>
            {d.statusMessage}
          </span>
        ) : null}
      </div>

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
        {d._capped ? (
          <span style={styles.cappedNote}>⚠ capped at {d.count}</span>
        ) : null}
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.runBtn, background: RUN_BTN_COLOR, opacity: d.status === 'loading' ? 0.6 : 1 }}
          onClick={handleRun}
          disabled={d.status === 'loading'}
          className="nodrag"
        >
          {d.status === 'loading' ? 'Running…' : '▶  Run'}
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={styles.outputHandle}
      />
    </div>
  )
}

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
  cappedNote: {
    fontSize: 10,
    color: '#d97706',
    fontStyle: 'italic' as const,
    paddingTop: 2,
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
