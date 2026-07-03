import { useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { downloadAsFixture, fixtureFilename, resolveFixtureQuery } from '../utils/fixtureUtils'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type SMGStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface SMGSearchNodeData {
  inlineQuery:   string
  inlineLimit:   string
  fetchAll:      boolean
  museum:        string
  dateFrom:      string
  dateTo:        string
  searchType:    string
  useFixture?:   boolean
  status:        SMGStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  [key: string]: unknown
}

// ── Facet options ─────────────────────────────────────────────────────────────

const MUSEUM_OPTIONS = [
  { value: '',           label: '— all museums —' },
  { value: 'Science Museum', label: 'Science Museum (London)' },
  { value: 'National Railway Museum', label: 'National Railway Museum (York)' },
  { value: 'National Science and Media Museum', label: 'National Science and Media Museum (Bradford)' },
  { value: 'Museum of Science and Industry', label: 'Museum of Science and Industry (Manchester)' },
  { value: 'Locomotion', label: 'Locomotion (Shildon)' },
]

const SEARCH_TYPE_OPTIONS = [
  { value: 'objects',   label: 'Objects' },
  { value: 'people',    label: 'People' },
  { value: 'documents', label: 'Documents' },
]

// ── Layout ────────────────────────────────────────────────────────────────────

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

const WIRABLE_ROWS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'e.g. steam engine', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',                rowIndex: 1 },
] as const

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

const STATUS_BORDER: Record<SMGStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
  cached:  '#22c55e',
}

const STATUS_BADGE: Record<SMGStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
  cached:  '#86efac',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SMGSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as SMGSearchNodeData
  const [filtersOpen, setFiltersOpen] = useState(false)

  const fetchAll    = d.fetchAll ?? false
  const borderColor = STATUS_BORDER[d.status as SMGStatus] ?? '#d1d5db'

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => nodeRunners.smgSearch(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    updateNodeData(id, { [key]: e.target.value })

  const activeFilterCount = [d.museum, d.dateFrom, d.dateTo].filter(Boolean).length

  return (
    <div style={{ ...styles.card, borderColor }}>
      {WIRABLE_ROWS.map(({ handleId, rowIndex }) => (
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

      <div style={styles.header}>
        <span style={styles.headerTitle}>Science Museum Group</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: STATUS_BADGE[d.status as SMGStatus] ?? '#9ca3af' }}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      <div style={styles.body}>
        {WIRABLE_ROWS.map(({ handleId, dataKey, label, placeholder }) => {
          const isLimit  = handleId === 'limit'
          const disabled = isLimit && fetchAll
          const connected = isConnected(handleId)
          return (
            <div key={handleId} style={styles.row}>
              <span style={styles.paramLabel}>{label}</span>
              {connected ? (
                <span style={styles.connectedBadge}>↔ wired</span>
              ) : disabled ? (
                <span style={styles.disabledHint}>all results</span>
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

        <div style={styles.row}>
          <span style={styles.paramLabel}>type</span>
          <select style={styles.select} value={d.searchType || 'objects'} onChange={set('searchType')} className="nodrag">
            {SEARCH_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={fetchAll}
            onChange={e => updateNodeData(id, { fetchAll: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Fetch all results
        </label>

        <button
          style={styles.filterToggle}
          onClick={() => setFiltersOpen(o => !o)}
          className="nodrag"
        >
          {filtersOpen ? '▾' : '▸'} Filters
          {activeFilterCount > 0 && (
            <span style={styles.filterBadge}>{activeFilterCount}</span>
          )}
        </button>

        {filtersOpen && (
          <div style={styles.filterSection}>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Museum</span>
              <select style={styles.select} value={d.museum || ''} onChange={set('museum')} className="nodrag">
                {MUSEUM_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Date from</span>
              <input
                style={styles.inlineInput}
                value={d.dateFrom || ''}
                onChange={set('dateFrom')}
                placeholder="e.g. 1850"
                className="nodrag"
              />
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Date to</span>
              <input
                style={styles.inlineInput}
                value={d.dateTo || ''}
                onChange={set('dateTo')}
                placeholder="e.g. 1900"
                className="nodrag"
              />
            </div>

            {activeFilterCount > 0 && (
              <button
                style={styles.clearBtn}
                onClick={() => updateNodeData(id, { museum: '', dateFrom: '', dateTo: '' })}
                className="nodrag"
              >
                ✕ Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <div style={styles.fixtureControls}>
          <label style={styles.fixtureToggle} className="nodrag" title="Use pre-baked fixture from public/fixtures/ instead of live API">
            <input type="checkbox" checked={!!d.useFixture} onChange={e => updateNodeData(id, { useFixture: e.target.checked })} className="nodrag" />
            <span style={{ color: d.useFixture ? '#701a75' : '#9ca3af' }}>📦</span>
          </label>
          {(d.status === 'success' || d.status === 'cached') && (
            <button
              style={styles.fixtureSaveBtn} className="nodrag"
              title={`Download fixture: ${fixtureFilename('smgSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}`}
              onClick={() => downloadAsFixture(id, 'smgSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}
            >💾</button>
          )}
        </div>
        <button
          style={{ ...styles.runBtn, opacity: d.status === 'loading' ? 0.6 : 1 }}
          onClick={handleRun}
          disabled={d.status === 'loading'}
          className="nodrag"
        >
          {d.status === 'loading' ? 'Running…' : d.useFixture ? '▶ Load fixture' : '▶  Run'}
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

// ── Styles ────────────────────────────────────────────────────────────────────

const HEADER_COLOR  = '#701a75'
const RUN_BTN_COLOR = '#86198f'

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 264,
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
    height: ROW_H - 5,
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
  select: {
    flex: 1,
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
    background: '#fff',
    minWidth: 0,
  },
  connectedBadge: {
    fontSize: 10,
    color: '#3b82f6',
    fontStyle: 'italic' as const,
  },
  disabledHint: {
    fontSize: 10,
    color: '#9ca3af',
    fontStyle: 'italic' as const,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#374151',
    cursor: 'pointer',
    userSelect: 'none' as const,
    paddingTop: 2,
  },
  filterToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    color: '#701a75',
    background: '#fdf4ff',
    border: '1px solid #e9d5ff',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
    marginTop: 2,
    width: '100%',
    textAlign: 'left' as const,
  },
  filterBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: '#701a75',
    color: '#fff',
    borderRadius: 8,
    padding: '0 5px',
    marginLeft: 2,
  },
  filterSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 5,
    padding: '6px 6px 4px',
    background: '#fdf4ff',
    borderRadius: 4,
    border: '1px solid #e9d5ff',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  filterLabel: {
    fontSize: 10,
    color: '#6b7280',
    width: 62,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  clearBtn: {
    fontSize: 10,
    color: '#701a75',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 0',
    textAlign: 'left' as const,
    marginTop: 2,
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
    justifyContent: 'space-between',
  },
  fixtureControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  fixtureToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: 13,
  },
  fixtureSaveBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 2px',
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 1,
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
