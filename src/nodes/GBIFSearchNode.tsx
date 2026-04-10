import { useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runGBIFNode } from '../utils/runGBIFNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type RunStatus = 'idle' | 'loading' | 'success' | 'error'

export interface GBIFSearchNodeData {
  inlineQ: string
  inlineScientificName: string
  inlineCountry: string
  inlineYear: string
  inlineLimit: string
  status: RunStatus
  statusMessage: string
  /** Normalised output — consumed by downstream output/processing nodes */
  results: UnifiedRecord[] | undefined
  /** Total hits reported by the API (may exceed results.length due to pagination) */
  count: number
  [key: string]: unknown
}

// Each param: the handle id used in edges, and the key in node data for inline value
const PARAMS = [
  { handleId: 'q',              dataKey: 'inlineQ',              label: 'q',              placeholder: 'free text…' },
  { handleId: 'scientificName', dataKey: 'inlineScientificName', label: 'scientificName', placeholder: 'e.g. Quercus robur' },
  { handleId: 'country',        dataKey: 'inlineCountry',        label: 'country',        placeholder: 'e.g. GB' },
  { handleId: 'year',           dataKey: 'inlineYear',           label: 'year',           placeholder: 'e.g. 2010,2020' },
  { handleId: 'limit',          dataKey: 'inlineLimit',          label: 'limit',          placeholder: '20' },
] as const

// Layout constants — keep in sync with CSS values below
const HEADER_H  = 32   // px
const BODY_PAD  = 8    // padding-top of body
const ROW_H     = 27   // row height + gap (22px input + 5px gap)

function handleTop(rowIndex: number) {
  // centre of each row
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

export function GBIFSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as GBIFSearchNodeData

  const isConnected = useCallback(
    (handleId: string) =>
      liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => runGBIFNode(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const borderColor = {
    idle:    '#d1d5db',
    loading: '#3b82f6',
    success: '#22c55e',
    error:   '#ef4444',
  }[d.status as RunStatus] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* --- Left input handles, absolutely positioned --- */}
      {PARAMS.map(({ handleId }, i) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{
            ...styles.inputHandle,
            top: handleTop(i),
            background: isConnected(handleId) ? '#3b82f6' : '#9ca3af',
            boxShadow: `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#9ca3af'}`,
          }}
        />
      ))}

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>GBIF Search</span>
        {d.statusMessage ? (
          <span style={{
            ...styles.statusBadge,
            color: { loading: '#93c5fd', success: '#86efac', error: '#fca5a5' }[d.status as RunStatus] ?? '#9ca3af',
          }}>
            {d.statusMessage}
          </span>
        ) : null}
      </div>

      {/* Body — rows */}
      <div style={styles.body}>
        {PARAMS.map(({ handleId, dataKey, label, placeholder }) => {
          const connected = isConnected(handleId)
          return (
            <div key={handleId} style={styles.row}>
              <span style={styles.paramLabel}>{label}</span>
              {connected ? (
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
          )
        })}
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

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 270,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
  },
  header: {
    height: HEADER_H,
    background: '#0f4c81',
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
    width: 108,
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
    background: '#0f4c81',
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
