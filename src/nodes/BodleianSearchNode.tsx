import { useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { downloadAsFixture, fixtureFilename, resolveFixtureQuery } from '../utils/fixtureUtils'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type BodleianStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface BodleianSearchNodeData {
  inlineQuery:       string
  inlineLimit:       string
  fetchAll:          boolean
  sort:              string
  fqCompleteness?:   string   // '' | 'Yes' | 'No'
  fqOrigins?:        string
  fqLanguages?:      string
  fqMusicalNotation?: string  // '' | 'Yes' | 'No'
  fqDateFrom?:       string
  fqDateTo?:         string
  useFixture?:       boolean
  status:            BodleianStatus
  statusMessage:     string
  results:           UnifiedRecord[] | undefined
  count:             number
  [key: string]:     unknown
}

// ── Options ───────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'relevance',     label: 'Relevance' },
  { value: 'shelfmark',     label: 'Shelfmark' },
  { value: 'date asc',      label: 'Date ↑' },
  { value: 'date desc',     label: 'Date ↓' },
  { value: 'published asc', label: 'Published ↑' },
]

// ── Layout ────────────────────────────────────────────────────────────────────

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

const WIRABLE_ROWS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'e.g. psalter', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',              rowIndex: 1 },
] as const

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

const STATUS_BORDER: Record<BodleianStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
  cached:  '#0e7490',
}

const STATUS_BADGE: Record<BodleianStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
  cached:  '#67e8f9',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BodleianSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as BodleianSearchNodeData
  const [filtersOpen, setFiltersOpen] = useState(false)

  const fetchAll    = d.fetchAll ?? false
  const borderColor = STATUS_BORDER[d.status as BodleianStatus] ?? '#d1d5db'

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => nodeRunners.bodleianSearch(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    updateNodeData(id, { [key]: e.target.value })

  const hasFilter = !!(d.fqCompleteness || d.fqOrigins ||
    d.fqLanguages || d.fqMusicalNotation || d.fqDateFrom || d.fqDateTo)

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
        <span style={styles.headerTitle}>Bodleian Digital Collections</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: STATUS_BADGE[d.status as BodleianStatus] ?? '#9ca3af' }}>
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

        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={fetchAll}
            onChange={e => updateNodeData(id, { fetchAll: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Fetch all (up to 500)
        </label>

        <div style={styles.row}>
          <span style={styles.paramLabel}>sort</span>
          <select style={styles.select} value={d.sort || 'relevance'} onChange={set('sort')} className="nodrag">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <button
          style={styles.filterToggle}
          onClick={() => setFiltersOpen(o => !o)}
          className="nodrag"
        >
          {filtersOpen ? '▾' : '▸'} Filters
          {hasFilter && (
            <span style={styles.filterBadge}>
              {[d.fqCompleteness, d.fqOrigins,
                d.fqLanguages, d.fqMusicalNotation, d.fqDateFrom || d.fqDateTo
              ].filter(Boolean).length}
            </span>
          )}
        </button>

        {filtersOpen && (
          <div style={styles.filterSection}>
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Complete</span>
              <select style={styles.select} value={d.fqCompleteness ?? ''} onChange={set('fqCompleteness')} className="nodrag">
                <option value="">Any</option>
                <option value="Yes">Fully digitised</option>
                <option value="No">Partial only</option>
              </select>
            </div>
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Origins</span>
              <input style={styles.filterInput} value={d.fqOrigins ?? ''} onChange={set('fqOrigins')}
                placeholder="e.g. England, France" className="nodrag" />
            </div>
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Language</span>
              <input style={styles.filterInput} value={d.fqLanguages ?? ''} onChange={set('fqLanguages')}
                placeholder="e.g. Latin, Hebrew" className="nodrag" />
            </div>
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Music</span>
              <select style={styles.select} value={d.fqMusicalNotation ?? ''} onChange={set('fqMusicalNotation')} className="nodrag">
                <option value="">Any</option>
                <option value="Yes">Has musical notation</option>
                <option value="No">No musical notation</option>
              </select>
            </div>
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Date from</span>
              <input style={{ ...styles.filterInput, maxWidth: 70 }} value={d.fqDateFrom ?? ''} onChange={set('fqDateFrom')}
                placeholder="e.g. 1200" className="nodrag" />
              <span style={styles.filterLabel}>to</span>
              <input style={{ ...styles.filterInput, maxWidth: 70 }} value={d.fqDateTo ?? ''} onChange={set('fqDateTo')}
                placeholder="e.g. 1400" className="nodrag" />
            </div>
            {hasFilter && (
              <button
                style={styles.clearBtn}
                onClick={() => updateNodeData(id, {
                  fqCompleteness: '', fqOrigins: '',
                  fqLanguages: '', fqMusicalNotation: '', fqDateFrom: '', fqDateTo: '',
                })}
                className="nodrag"
              >
                ✕ Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <div style={styles.fixtureControls}>
          <label style={styles.fixtureToggle} className="nodrag" title="Use pre-baked fixture instead of live API">
            <input type="checkbox" checked={!!d.useFixture} onChange={e => updateNodeData(id, { useFixture: e.target.checked })} className="nodrag" />
            <span style={{ color: d.useFixture ? '#0e7490' : '#9ca3af' }}>📦</span>
          </label>
          {(d.status === 'success' || d.status === 'cached') && (
            <button
              style={styles.fixtureSaveBtn} className="nodrag"
              title={`Download fixture: ${fixtureFilename('bodleianSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}`}
              onClick={() => downloadAsFixture(id, 'bodleianSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}
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

const HEADER_COLOR  = '#003865'  // Oxford blue
const RUN_BTN_COLOR = '#005a9e'

const styles = {
  card: {
    background:  '#fff',
    border:      '2px solid #d1d5db',
    borderRadius: 8,
    minWidth:    264,
    boxShadow:   '0 1px 4px rgba(0,0,0,0.08)',
    position:    'relative' as const,
    transition:  'border-color 0.25s',
  },
  header: {
    height:          HEADER_H,
    background:      HEADER_COLOR,
    borderRadius:    '6px 6px 0 0',
    padding:         '0 10px',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'space-between',
    gap:             8,
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
    paddingTop:     BODY_PAD,
    paddingLeft:    14,
    paddingRight:   10,
    paddingBottom:  4,
    display:        'flex',
    flexDirection:  'column' as const,
    gap:            5,
  },
  row: {
    display:     'flex',
    alignItems:  'center',
    gap:         6,
    height:      ROW_H - 5,
  },
  paramLabel: {
    fontSize:    11,
    color:       '#6b7280',
    width:       40,
    flexShrink:  0,
    fontFamily:  'monospace',
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
  select: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    outline:      'none',
    height:       22,
    background:   '#fff',
    minWidth:     0,
  },
  connectedBadge: {
    fontSize:   10,
    color:      '#3b82f6',
    fontStyle:  'italic' as const,
  },
  disabledHint: {
    fontSize:   10,
    color:      '#9ca3af',
    fontStyle:  'italic' as const,
  },
  checkLabel: {
    display:     'flex',
    alignItems:  'center',
    fontSize:    11,
    color:       '#374151',
    cursor:      'pointer',
    userSelect:  'none' as const,
    paddingTop:  2,
  },
  filterToggle: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    fontSize:   11,
    fontWeight: 600,
    color:      HEADER_COLOR,
    background: '#e8f0f8',
    border:     '1px solid #b3cde0',
    borderRadius: 4,
    padding:    '3px 8px',
    cursor:     'pointer',
    marginTop:  2,
    width:      '100%',
    textAlign:  'left' as const,
  },
  filterBadge: {
    fontSize:     10,
    fontWeight:   700,
    background:   HEADER_COLOR,
    color:        '#fff',
    borderRadius: 8,
    padding:      '0 5px',
    marginLeft:   2,
  },
  filterSection: {
    display:        'flex',
    flexDirection:  'column' as const,
    gap:            5,
    padding:        '6px 6px 4px',
    background:     '#f0f5ff',
    borderRadius:   4,
    border:         '1px solid #b3cde0',
  },
  filterRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  filterLabel: {
    fontSize:   10,
    color:      '#6b7280',
    width:      74,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  filterInput: {
    flex:         1,
    fontSize:     10,
    padding:      '2px 5px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    outline:      'none',
    height:       20,
    minWidth:     0,
  },
  clearBtn: {
    fontSize:   10,
    color:      HEADER_COLOR,
    background: 'none',
    border:     'none',
    cursor:     'pointer',
    padding:    '2px 0',
    textAlign:  'left' as const,
    marginTop:  2,
  },
  inputHandle: {
    width:     8,
    height:    8,
    border:    '2px solid #fff',
    position:  'absolute' as const,
    left:      -5,
    borderRadius: '50%',
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  fixtureControls: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
  },
  fixtureToggle: {
    display:    'flex',
    alignItems: 'center',
    gap:        3,
    cursor:     'pointer',
    userSelect: 'none' as const,
    fontSize:   13,
  },
  fixtureSaveBtn: {
    background: 'none',
    border:     'none',
    cursor:     'pointer',
    padding:    '0 2px',
    fontSize:   13,
    color:      '#6b7280',
    lineHeight: 1,
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
    width:     10,
    height:    10,
    background: '#22c55e',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
  },
}
