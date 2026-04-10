import { useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runLLDSNode } from '../utils/runLLDSNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type LLDSStatus = 'idle' | 'loading' | 'success' | 'cached' | 'error'

export interface LLDSSearchNodeData {
  inlineQuery: string
  language: string
  inlineLimit: string
  /** When true (default), a fresh localStorage cache is used rather than re-fetching.
   *  Uncheck on the node to force a live request on the next Run. */
  useCache: boolean
  status: LLDSStatus
  statusMessage: string
  results: UnifiedRecord[] | undefined
  count: number
  [key: string]: unknown
}

// Rows that have a left-side handle, with their visual row index in the body.
// 'language' is row 1 but has no handle — so 'limit' is at rowIndex 2.
const HANDLE_PARAMS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query',  placeholder: 'e.g. English corpus', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit',  placeholder: '20',                  rowIndex: 2 },
] as const

const LANGUAGES: { value: string; label: string }[] = [
  { value: '',   label: 'any language' },
  { value: 'en', label: 'English' },
  { value: 'cy', label: 'Welsh' },
  { value: 'ga', label: 'Irish' },
  { value: 'gd', label: 'Scottish Gaelic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'la', label: 'Latin' },
]

// Layout — keep in sync with styles.body below
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

  const borderColor = STATUS_COLORS[d.status as LLDSStatus] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Left input handles — absolutely positioned to align with their rows */}
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
            color: STATUS_BADGE_COLORS[d.status as LLDSStatus] ?? '#9ca3af',
          }}>
            {d.statusMessage}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* Row 0 — query (has handle) */}
        <div style={styles.row}>
          <span style={styles.paramLabel}>query</span>
          {isConnected('query') ? (
            <span style={styles.connectedBadge}>↔ wired</span>
          ) : (
            <input
              style={styles.inlineInput}
              value={d.inlineQuery}
              onChange={e => updateNodeData(id, { inlineQuery: e.target.value })}
              placeholder="e.g. English corpus"
              className="nodrag"
            />
          )}
        </div>

        {/* Row 1 — language (inline dropdown, no handle) */}
        <div style={styles.row}>
          <span style={styles.paramLabel}>language</span>
          <select
            style={styles.inlineSelect}
            value={d.language}
            onChange={e => updateNodeData(id, { language: e.target.value })}
            className="nodrag"
          >
            {LANGUAGES.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Row 2 — limit (has handle) */}
        <div style={styles.row}>
          <span style={styles.paramLabel}>limit</span>
          {isConnected('limit') ? (
            <span style={styles.connectedBadge}>↔ wired</span>
          ) : (
            <input
              style={styles.inlineInput}
              value={d.inlineLimit}
              onChange={e => updateNodeData(id, { inlineLimit: e.target.value })}
              placeholder="20"
              className="nodrag"
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <label style={styles.cacheToggle} className="nodrag" title="When checked, reuses the locally stored item list if it is less than 24 h old. Uncheck to force a fresh request.">
          <input
            type="checkbox"
            checked={d.useCache}
            onChange={e => updateNodeData(id, { useCache: e.target.checked })}
            className="nodrag"
          />
          <span style={{ color: d.useCache ? '#92400e' : '#6b7280' }}>
            {d.status === 'cached' ? '📦 cached' : 'use cache'}
          </span>
        </label>
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

const HEADER_COLOR = '#92400e'   // warm amber-brown
const RUN_BTN_COLOR = '#78350f'

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 260,
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
    width: 70,
    flexShrink: 0,
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
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
  inlineSelect: {
    flex: 1,
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    background: '#f9fafb',
    outline: 'none',
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
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cacheToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    cursor: 'pointer',
    flex: 1,
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
