/**
 * FieldDistributionNode — bar chart of value frequencies for any upstream field.
 *
 * Click a bar to select that value as a filter. Selected values are passed to
 * the results output handle so downstream nodes receive only matching records.
 * When nothing is selected all records pass through. Useful for faceted
 * exploration: type, country, subject, _source, language, etc.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

const HEADER_COLOR   = '#37624a'   // emerald-700
const BAR_COLOR      = '#34d399'   // emerald-400
const BAR_ACTIVE     = '#059669'   // emerald-600 — selected
const BAR_DIM        = '#a7f3d0'   // emerald-200 — non-selected when some selected
const LABEL_W        = 108
const BAR_AREA       = 130
const COUNT_W        = 34
const SVG_W          = LABEL_W + BAR_AREA + COUNT_W
const BAR_H          = 14
const BAR_GAP        = 4

export interface FieldDistributionNodeData {
  selectedField:  string
  maxBars:        number
  expandArrays:   boolean
  filteredValues: string[]
  [key: string]: unknown
}

// Fields that are internal/structural and should not appear in picker
const HIDDEN_FIELDS = new Set([
  'resultsVersion', 'status', 'statusMessage', 'count', 'inputCount',
  'outputCount', '_capped', '_total',
])

export function FieldDistributionNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const { records, connected } = useUpstreamRecords(id)
  const d = data as FieldDistributionNodeData

  const recs = (records ?? []) as Record<string, unknown>[]

  const availableFields = useMemo(() => {
    if (recs.length === 0) return []
    return Object.keys(recs[0]).filter(k => {
      if (HIDDEN_FIELDS.has(k)) return false
      const v = recs[0][k]
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return false
      return true
    })
  }, [recs])

  const selectedField  = (d.selectedField as string) || availableFields[0] || ''
  const maxBars        = (d.maxBars as number)       || 20
  const expandArrays   = (d.expandArrays as boolean) ?? true
  const filteredValues = (d.filteredValues as string[] | undefined) ?? []

  // Auto-select first field when records arrive
  useEffect(() => {
    if (!d.selectedField && availableFields.length > 0) {
      updateNodeData(id, { selectedField: availableFields[0] })
    }
  }, [availableFields, d.selectedField, id, updateNodeData])

  // Compute value distribution
  const { bars, totalValues, distinctValues } = useMemo(() => {
    const counts = new Map<string, number>()
    let totalValues = 0
    for (const r of recs) {
      const v = r[selectedField]
      if (v === null || v === undefined) continue
      const vals = (expandArrays && Array.isArray(v)) ? v : [v]
      for (const val of vals) {
        if (val === null || val === undefined || val === '') continue
        const key = String(val)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        totalValues++
      }
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
    return { bars: sorted.slice(0, maxBars), totalValues, distinctValues: counts.size }
  }, [recs, selectedField, maxBars, expandArrays])

  // Reactively store filtered output so downstream nodes can read it
  const prevFp = useRef('')
  useEffect(() => {
    const fp = `${recs.length}|${selectedField}|${expandArrays}|${JSON.stringify(filteredValues)}`
    if (prevFp.current === fp) return
    prevFp.current = fp

    if (recs.length === 0) {
      clearNodeResults(id)
      updateNodeData(id, { resultsVersion: 0, outputCount: 0 })
      return
    }

    const output: Record<string, unknown>[] = filteredValues.length === 0
      ? recs
      : recs.filter(r => {
          const v = r[selectedField]
          if (v === null || v === undefined) return false
          const vals = (expandArrays && Array.isArray(v))
            ? (v as unknown[]).map(String)
            : [String(v)]
          return vals.some(val => filteredValues.includes(val))
        })

    clearNodeResults(id)
    const version = setNodeResults(id, output)
    updateNodeData(id, { resultsVersion: version, outputCount: output.length })
  }, [recs, selectedField, expandArrays, d.filteredValues, id, updateNodeData])  // eslint-disable-line react-hooks/exhaustive-deps

  const toggleValue = (value: string) => {
    const next = filteredValues.includes(value)
      ? filteredValues.filter(v => v !== value)
      : [...filteredValues, value]
    updateNodeData(id, { filteredValues: next })
  }

  const [hoveredBar, setHoveredBar] = useState<string | null>(null)

  const outputCount = (d.outputCount as number | undefined) ?? recs.length
  const anySelected = filteredValues.length > 0
  const maxCount    = bars[0]?.[1] ?? 1
  const svgH        = bars.length > 0 ? bars.length * (BAR_H + BAR_GAP) + 6 : 0

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left}  id="data"    style={styles.inputHandle} />
      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />

      <div style={styles.header}>
        <span style={styles.headerTitle}>Field Distribution</span>
        {recs.length > 0 && (
          <span style={styles.headerCount}>{recs.length} records</span>
        )}
      </div>

      <div style={styles.body}>
        {/* Field picker */}
        <div style={styles.row}>
          <span style={styles.label}>Field</span>
          {availableFields.length > 0 ? (
            <select
              style={styles.select}
              value={selectedField}
              onChange={e => updateNodeData(id, { selectedField: e.target.value, filteredValues: [] })}
              className="nodrag"
            >
              {availableFields.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          ) : (
            <span style={styles.placeholder}>
              {connected ? 'Run upstream node first' : 'Connect a data source'}
            </span>
          )}
        </div>

        {/* Options row */}
        <div style={{ ...styles.row, gap: 10 }}>
          <div style={styles.row}>
            <span style={styles.label}>Top</span>
            <input
              type="number"
              min={1}
              max={100}
              style={{ ...styles.select, width: 48, flex: 'none' }}
              value={maxBars}
              onChange={e => updateNodeData(id, { maxBars: Math.max(1, parseInt(e.target.value) || 20) })}
              className="nodrag"
            />
          </div>
          <label style={styles.checkRow} className="nodrag">
            <input
              type="checkbox"
              checked={expandArrays}
              onChange={e => updateNodeData(id, { expandArrays: e.target.checked })}
              className="nodrag"
            />
            <span style={styles.checkLabel}>expand arrays</span>
          </label>
        </div>

        {/* Bar chart — click a bar to toggle filter, hover to preview action */}
        {bars.length > 0 && (
          <>
            <div className="nodrag nowheel" style={styles.chartWrap}>
              <svg width={SVG_W} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
                {bars.map(([label, count], i) => {
                  const y          = i * (BAR_H + BAR_GAP) + 3
                  const barW       = Math.max(2, (count / maxCount) * BAR_AREA)
                  const pct        = totalValues > 0 ? Math.round((count / totalValues) * 100) : 0
                  const isSelected = filteredValues.includes(label)
                  const isHovered  = hoveredBar === label
                  // Hovered bar always shows at full brightness regardless of dim state
                  const fillColor  = isHovered
                    ? (isSelected ? BAR_ACTIVE : BAR_COLOR)
                    : anySelected
                      ? (isSelected ? BAR_ACTIVE : BAR_DIM)
                      : BAR_COLOR
                  const textColor  = (isSelected || isHovered) ? '#047857' : '#33302a'
                  return (
                    <g
                      key={label}
                      onClick={() => toggleValue(label)}
                      onMouseEnter={() => setHoveredBar(label)}
                      onMouseLeave={() => setHoveredBar(null)}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Row background on hover — rendered first so it sits behind everything */}
                      {isHovered && (
                        <rect x={1} y={y - 2} width={SVG_W - 2} height={BAR_H + 4}
                          fill="#ecfdf5" rx={3} />
                      )}
                      {/* Wide transparent hit area */}
                      <rect x={0} y={y - 1} width={SVG_W} height={BAR_H + 2} fill="transparent" />
                      <text
                        x={LABEL_W - 5}
                        y={y + BAR_H * 0.72}
                        textAnchor="end"
                        fontSize={9}
                        fill={textColor}
                        fontWeight={(isSelected || isHovered) ? 700 : 400}
                        style={{ fontFamily: 'monospace' }}
                      >
                        {label.length > 16 ? label.slice(0, 15) + '…' : label}
                      </text>
                      <rect x={LABEL_W} y={y} width={barW} height={BAR_H} fill={fillColor} rx={2} />
                      {(isSelected || isHovered) && (
                        <rect x={LABEL_W} y={y} width={barW} height={BAR_H} fill="none"
                          stroke={isSelected ? '#047857' : '#6ee7b7'}
                          strokeWidth={isHovered ? 1.5 : 1} rx={2} />
                      )}
                      <text x={LABEL_W + barW + 4} y={y + BAR_H * 0.72} fontSize={9} fill="#8a8168">
                        {count} <tspan fill="#b0a891">({pct}%)</tspan>
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>

            {/* Hover hint — space always reserved to prevent layout jitter */}
            <div style={{
              ...styles.hintLine,
              visibility: hoveredBar ? 'visible' : 'hidden',
            }}>
              {hoveredBar
                ? filteredValues.includes(hoveredBar)
                  ? `↩ click to deselect "${hoveredBar.length > 22 ? hoveredBar.slice(0, 21) + '…' : hoveredBar}"`
                  : `↓ click to filter by "${hoveredBar.length > 20 ? hoveredBar.slice(0, 19) + '…' : hoveredBar}"`
                : ''
              }
            </div>
          </>
        )}

        {/* Filter status bar */}
        {anySelected && (
          <div style={styles.filterBar}>
            <span style={styles.filterLabel}>
              ↓ {outputCount} record{outputCount !== 1 ? 's' : ''} match
            </span>
            <button
              style={styles.clearBtn}
              onClick={() => updateNodeData(id, { filteredValues: [] })}
              className="nodrag"
            >
              ✕ clear
            </button>
          </div>
        )}

        {/* Summary footer */}
        {recs.length > 0 && selectedField && (
          <div style={styles.summary}>
            {distinctValues} unique value{distinctValues !== 1 ? 's' : ''}
            {distinctValues > maxBars && ` — showing top ${maxBars}`}
            {' · '}{totalValues} total
            {!anySelected && (
              <span style={{ color: '#a7f3d0', marginLeft: 4 }}>· click a bar to filter</span>
            )}
          </div>
        )}

        {connected && recs.length === 0 && (
          <div style={styles.empty}>Run the upstream node to see distribution.</div>
        )}
        {!connected && (
          <div style={styles.empty}>Connect a data source.</div>
        )}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background:   '#fffdf7',
    border:       '2px solid #d6ccb5',
    borderRadius: 8,
    width:        SVG_W + 24,
    boxShadow:    '0 1px 4px rgba(50,42,26,0.10)',
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
  headerCount: {
    fontSize:  10,
    color:     '#a7f3d0',
    fontWeight: 600,
  },
  body: {
    padding:       '8px 10px 8px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  label: {
    fontSize:   11,
    color:      '#8a8168',
    width:      36,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d6ccb5',
    borderRadius: 4,
    outline:      'none',
    height:       22,
  },
  checkRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    cursor:     'pointer',
  },
  checkLabel: {
    fontSize: 10,
    color:    '#8a8168',
  },
  placeholder: {
    fontSize:  10,
    color:     '#b0a891',
    fontStyle: 'italic',
  },
  chartWrap: {
    overflowX: 'auto' as const,
    marginTop: 2,
  },
  summary: {
    fontSize:  9,
    color:     '#b0a891',
    marginTop: 2,
  },
  empty: {
    fontSize:  10,
    color:     '#b0a891',
    fontStyle: 'italic',
  },
  inputHandle: {
    width:        8,
    height:       8,
    background:   HEADER_COLOR,
    border:       '2px solid #fff',
    boxShadow:    `0 0 0 1px ${HEADER_COLOR}`,
    position:     'absolute' as const,
    left:         -5,
    borderRadius: '50%',
  },
  outputHandle: {
    width:      10,
    height:     10,
    background: '#22c55e',
    border:     '2px solid #fff',
    boxShadow:  '0 0 0 1px #22c55e',
  },
  filterBar: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    background:     '#ecfdf5',
    border:         '1px solid #6ee7b7',
    borderRadius:   4,
    padding:        '3px 6px',
    marginTop:      2,
  },
  filterLabel: {
    fontSize:   10,
    color:      '#047857',
    fontWeight: 600,
  },
  clearBtn: {
    background:   'none',
    border:       'none',
    color:        '#8a8168',
    fontSize:     10,
    cursor:       'pointer',
    padding:      '0 2px',
  },
  hintLine: {
    fontSize:    9,
    color:       '#059669',
    fontStyle:   'italic',
    height:      13,
    lineHeight:  '13px',
    overflow:    'hidden',
    whiteSpace:  'nowrap' as const,
    marginTop:   -2,
  },
}
