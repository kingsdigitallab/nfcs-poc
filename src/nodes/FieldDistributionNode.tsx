/**
 * FieldDistributionNode — display-only bar chart of value frequencies for any
 * field in upstream records.
 *
 * Array-valued fields (subject, country, creator, …) are expanded so each
 * element is counted individually. Bars are sorted by count descending and
 * capped at maxBars (default 20). Useful for categorical fields: type,
 * country, subject, _source, language, etc.
 *
 * No runner, no output handle.
 */

import { useState, useMemo, useEffect } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'

const HEADER_COLOR = '#047857'   // emerald-700
const BAR_COLOR    = '#34d399'   // emerald-400
const LABEL_W      = 108
const BAR_AREA     = 130
const COUNT_W      = 34
const SVG_W        = LABEL_W + BAR_AREA + COUNT_W
const BAR_H        = 14
const BAR_GAP      = 4

export interface FieldDistributionNodeData {
  selectedField: string
  maxBars:       number
  expandArrays:  boolean
  [key: string]: unknown
}

// Fields that are internal/structural and should not appear in picker by default
const HIDDEN_FIELDS = new Set([
  'resultsVersion', 'status', 'statusMessage', 'count', 'inputCount',
  'outputCount', '_capped', '_total',
])

export function FieldDistributionNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const { records, connected } = useUpstreamRecords(id)
  const d = data as FieldDistributionNodeData

  const recs = (records ?? []) as Record<string, unknown>[]

  // Derive available fields from the first record
  const availableFields = useMemo(() => {
    if (recs.length === 0) return []
    return Object.keys(recs[0]).filter(k => {
      if (HIDDEN_FIELDS.has(k)) return false
      const v = recs[0][k]
      // Skip deeply-nested namespace objects (gbif, ads, llds…) but keep arrays + primitives
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return false
      return true
    })
  }, [recs])

  const selectedField  = (d.selectedField as string) || availableFields[0] || ''
  const maxBars        = (d.maxBars as number)       || 20
  const expandArrays   = (d.expandArrays as boolean) ?? true

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
    return {
      bars:           sorted.slice(0, maxBars),
      totalValues,
      distinctValues: counts.size,
    }
  }, [recs, selectedField, maxBars, expandArrays])

  const maxCount = bars[0]?.[1] ?? 1
  const svgH     = bars.length > 0 ? bars.length * (BAR_H + BAR_GAP) + 6 : 0

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

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
              onChange={e => updateNodeData(id, { selectedField: e.target.value })}
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

        {/* Bar chart */}
        {bars.length > 0 && (
          <div className="nodrag nowheel" style={styles.chartWrap}>
            <svg width={SVG_W} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
              {bars.map(([label, count], i) => {
                const y    = i * (BAR_H + BAR_GAP) + 3
                const barW = Math.max(2, (count / maxCount) * BAR_AREA)
                const pct  = totalValues > 0 ? Math.round((count / totalValues) * 100) : 0
                return (
                  <g key={label}>
                    {/* Value label */}
                    <text
                      x={LABEL_W - 5}
                      y={y + BAR_H * 0.72}
                      textAnchor="end"
                      fontSize={9}
                      fill="#374151"
                      style={{ fontFamily: 'monospace' }}
                    >
                      {label.length > 16 ? label.slice(0, 15) + '…' : label}
                    </text>

                    {/* Bar */}
                    <rect
                      x={LABEL_W}
                      y={y}
                      width={barW}
                      height={BAR_H}
                      fill={BAR_COLOR}
                      rx={2}
                    />

                    {/* Count + % */}
                    <text
                      x={LABEL_W + barW + 4}
                      y={y + BAR_H * 0.72}
                      fontSize={9}
                      fill="#6b7280"
                    >
                      {count} <tspan fill="#9ca3af">({pct}%)</tspan>
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        )}

        {/* Summary footer */}
        {recs.length > 0 && selectedField && (
          <div style={styles.summary}>
            {distinctValues} unique value{distinctValues !== 1 ? 's' : ''}
            {distinctValues > maxBars && ` — showing top ${maxBars}`}
            {' · '}{totalValues} total occurrences
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
    background:   '#fff',
    border:       '2px solid #d1d5db',
    borderRadius: 8,
    width:        SVG_W + 24,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
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
    color:      '#6b7280',
    width:      36,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
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
    color:    '#6b7280',
  },
  placeholder: {
    fontSize:  10,
    color:     '#9ca3af',
    fontStyle: 'italic',
  },
  chartWrap: {
    overflowX: 'auto' as const,
    marginTop: 2,
  },
  summary: {
    fontSize:  9,
    color:     '#9ca3af',
    marginTop: 2,
  },
  empty: {
    fontSize:  10,
    color:     '#9ca3af',
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
}
