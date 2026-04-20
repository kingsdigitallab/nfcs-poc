import { useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runADSAdvancedNode } from '../utils/runADSAdvancedNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type ADSAdvStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ADSSearchAdvancedNodeData {
  inlineQuery:    string
  inlineLimit:    string
  fetchAll:       boolean
  ariadneSubject: string
  derivedSubject: string
  nativeSubject:  string
  country:        string
  dataType:       string
  temporal:       string
  sort:           string
  order:          string
  status:         ADSAdvStatus
  statusMessage:  string
  results:        UnifiedRecord[] | undefined
  count:          number
  [key: string]:  unknown
}

// ── Facet options (from getSearchAggregationData with q='') ───────────────────

const ARIADNE_SUBJECT_OPTIONS = [
  '', 'Site/monument', 'Artefact', 'Coin', 'Fieldwork', 'Fieldwork report',
  'Maritime', 'Monument', 'Inscription', 'Date', 'Fieldwork archive',
  'Rock Art', 'Building survey', 'E-Publication', 'Scientific analysis',
  'Not provided', 'Burial',
]

const DATA_TYPE_OPTIONS = [
  '', 'Structured Data', 'Still Image', 'Text', 'Geospatial',
  'CAD', 'Numeric', '3D', 'Video', 'Other', 'Audio', 'Software',
]

const COUNTRY_OPTIONS = [
  '', 'England', 'Scotland', 'Wales', 'Isle of Man', 'United Kingdom',
  'Northern Ireland', 'Ireland', 'Great Britain', 'Republic of Ireland',
  'Cyprus', 'Greece', 'Italy', 'Egypt', 'France', 'Syria', 'Turkey',
  'Channel Islands', 'Russia', 'Germany', 'Iraq',
]

const TEMPORAL_OPTIONS = [
  '', 'post medieval', 'roman', 'medieval', '19th century', 'bronze age',
  '20th century', 'early medieval', 'iron age', 'neolithic', 'prehistoric',
  'second world war', 'mesolithic', 'modern', '18th century',
  'later prehistoric', 'unknown', 'palaeolithic', 'late iron age',
  'early bronze age', 'late bronze age',
]

// Top suggestions for open-ended text fields
const DERIVED_SUBJECT_SUGGESTIONS = [
  'early western world coins', 'houses', 'archaeological sites',
  'vessels (containers)', 'earthworks (engineering works)', 'buckles (strap accessories)',
  'brooches', 'penny coins', 'agricultural settlements', 'buildings (structures)',
  'wrecks (sites)', 'farms', 'ditches', 'pits (earthworks)', 'glass (material)',
  'windows', 'stained-glass windows', 'conservation (discipline)', 'boundaries',
  'coins (money)',
]

const NATIVE_SUBJECT_SUGGESTIONS = [
  'coin', 'geophysical survey', 'house', 'vessel', 'extant building',
  'findspot', 'buckle', 'site', 'brooch', 'building', 'wreck', 'earthwork',
  'penny', 'enclosure', 'find', 'pit', 'farmstead', 'ditch', 'field system',
  'cemetery',
]

// ── Layout constants ──────────────────────────────────────────────────────────

const HEADER_H  = 32
const BODY_PAD  = 8
const ROW_H     = 27

// Rows that get a left-side input handle (wirable from ParamNode)
const WIRABLE_ROWS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'e.g. Stonehenge', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',              rowIndex: 1 },
] as const

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

// ── Status colours ────────────────────────────────────────────────────────────

const STATUS_BORDER: Record<ADSAdvStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

const STATUS_BADGE: Record<ADSAdvStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ADSSearchAdvancedNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as ADSSearchAdvancedNodeData
  const [filtersOpen, setFiltersOpen] = useState(false)

  const fetchAll    = d.fetchAll ?? false
  const borderColor = STATUS_BORDER[d.status as ADSAdvStatus] ?? '#d1d5db'

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => runADSAdvancedNode(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    updateNodeData(id, { [key]: e.target.value })

  const activeFilterCount = [
    d.ariadneSubject, d.derivedSubject, d.nativeSubject,
    d.country, d.dataType, d.temporal,
  ].filter(Boolean).length

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Left handles for wirable rows */}
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

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>ADS Search (Advanced)</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: STATUS_BADGE[d.status as ADSAdvStatus] ?? '#9ca3af' }}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>

        {/* Wirable rows: query + limit */}
        {WIRABLE_ROWS.map(({ handleId, dataKey, label, placeholder }) => {
          const isLimit   = handleId === 'limit'
          const disabled  = isLimit && fetchAll
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

        {/* Fetch all toggle */}
        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={fetchAll}
            onChange={e => updateNodeData(id, { fetchAll: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Fetch all results
        </label>

        {/* Sort + order */}
        <div style={styles.row}>
          <span style={styles.paramLabel}>sort</span>
          <select style={styles.select} value={d.sort || '_score'} onChange={set('sort')} className="nodrag">
            <option value="_score">Relevance</option>
            <option value="title">Title</option>
            <option value="issued">Date issued</option>
          </select>
          <select style={{ ...styles.select, width: 52 }} value={d.order || 'desc'} onChange={set('order')} className="nodrag">
            <option value="desc">↓</option>
            <option value="asc">↑</option>
          </select>
        </div>

        {/* Collapsible filters section */}
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

            {/* Resource type (ariadneSubject) */}
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Resource type</span>
              <select style={styles.select} value={d.ariadneSubject || ''} onChange={set('ariadneSubject')} className="nodrag">
                {ARIADNE_SUBJECT_OPTIONS.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            {/* Getty AAT subject (derivedSubject) */}
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Getty subject</span>
              <input
                list={`${id}-derived`}
                style={styles.inlineInput}
                value={d.derivedSubject || ''}
                onChange={set('derivedSubject')}
                placeholder="e.g. barrows"
                className="nodrag"
              />
              <datalist id={`${id}-derived`}>
                {DERIVED_SUBJECT_SUGGESTIONS.map(v => <option key={v} value={v} />)}
              </datalist>
            </div>

            {/* Native / original subject */}
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Native subject</span>
              <input
                list={`${id}-native`}
                style={styles.inlineInput}
                value={d.nativeSubject || ''}
                onChange={set('nativeSubject')}
                placeholder="e.g. bowl barrow"
                className="nodrag"
              />
              <datalist id={`${id}-native`}>
                {NATIVE_SUBJECT_SUGGESTIONS.map(v => <option key={v} value={v} />)}
              </datalist>
            </div>

            {/* Country */}
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Country</span>
              <select style={styles.select} value={d.country || ''} onChange={set('country')} className="nodrag">
                {COUNTRY_OPTIONS.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            {/* Data type */}
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Data type</span>
              <select style={styles.select} value={d.dataType || ''} onChange={set('dataType')} className="nodrag">
                {DATA_TYPE_OPTIONS.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            {/* Temporal */}
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Period</span>
              <select style={styles.select} value={d.temporal || ''} onChange={set('temporal')} className="nodrag">
                {TEMPORAL_OPTIONS.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            {activeFilterCount > 0 && (
              <button
                style={styles.clearBtn}
                onClick={() => updateNodeData(id, {
                  ariadneSubject: '', derivedSubject: '', nativeSubject: '',
                  country: '', dataType: '', temporal: '',
                })}
                className="nodrag"
              >
                ✕ Clear all filters
              </button>
            )}
          </div>
        )}
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

// ── Styles ────────────────────────────────────────────────────────────────────

const HEADER_COLOR  = '#78350f'  // amber-900 — distinct from basic ADS (#7c2d12)
const RUN_BTN_COLOR = '#92400e'

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
    color: '#78350f',
    background: '#fef3c7',
    border: '1px solid #fde68a',
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
    background: '#78350f',
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
    background: '#fffbeb',
    borderRadius: 4,
    border: '1px solid #fde68a',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  filterLabel: {
    fontSize: 10,
    color: '#6b7280',
    width: 74,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  clearBtn: {
    fontSize: 10,
    color: '#92400e',
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
