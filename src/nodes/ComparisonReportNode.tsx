/**
 * ComparisonReportNode — read-only evaluation comparison surface.
 *
 * Shows one evaluation pipeline as per-record cards + aggregate agreement
 * summary. Computes only counts/means/agreement — no writes, no statistics.
 *
 * Display-only: no runner. Excluded from Run All, same as other pure-output views.
 * Double-click to open full-screen reading panel (projector-legible).
 */

import { useMemo } from 'react'
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { ComparisonReportView } from './ComparisonReportView'
import type { ComparisonReportConfig } from './ComparisonReportView'

const HEADER_COLOR = '#3a3a6e'

export interface ComparisonReportNodeData {
  originalField:   string
  noteField:       string
  responseField:   string
  judgeScoreField: string
  humanScoreField: string
  [key: string]: unknown
}

export function ComparisonReportNode({ id, data, selected }: NodeProps) {
  const { records, connected, count } = useUpstreamRecords(id)
  const d = data as ComparisonReportNodeData

  const config: ComparisonReportConfig = {
    originalField:   d.originalField   ?? '',
    noteField:       d.noteField       ?? '',
    responseField:   d.responseField   ?? '',
    judgeScoreField: d.judgeScoreField ?? '',
    humanScoreField: d.humanScoreField ?? '',
  }

  // Available fields for role-mapping dropdowns — derived from upstream records
  const availableFields = useMemo<string[]>(() => {
    if (!records || records.length === 0) return []
    const keys = new Set<string>()
    for (const r of records.slice(0, 20)) {
      for (const k of Object.keys(r as Record<string, unknown>)) keys.add(k)
    }
    return [...keys].sort()
  }, [records])

  const { updateNodeData } = useReactFlow()

  function field(
    role: keyof ComparisonReportNodeData,
    label: string,
    hint?: string,
  ) {
    return (
      <div style={s.cfgRow}>
        <label style={s.cfgLabel}>{label}</label>
        {availableFields.length > 0 ? (
          <select
            style={s.cfgSelect}
            value={(d[role] as string) || ''}
            onChange={e => updateNodeData(id, { [role]: e.target.value })}
            className="nodrag"
          >
            <option value="">— none —</option>
            {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        ) : (
          <input
            style={s.cfgInput}
            value={(d[role] as string) || ''}
            placeholder={hint ?? ''}
            onChange={e => updateNodeData(id, { [role]: e.target.value })}
            className="nodrag"
          />
        )}
      </div>
    )
  }

  return (
    <>
      <NodeResizer
        minWidth={420} minHeight={480} isVisible={selected}
        lineStyle={{ borderColor: HEADER_COLOR }}
        handleStyle={{ background: HEADER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      <div style={s.card}>
        <Handle type="target" position={Position.Left} id="data" style={s.inputHandle} />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={s.header}>
          <span style={s.headerTitle}>Comparison Report</span>
          <span style={s.headerMeta}>
            {connected
              ? count != null && count > 0 ? `${count} records` : 'no records'
              : 'not connected'}
          </span>
        </div>

        {/* ── Role mapping ────────────────────────────────────────────────── */}
        <div style={s.configPanel} className="nodrag">
          <div style={s.configTitle}>Role mapping  <span style={s.configHint}>(double-click to expand)</span></div>
          {field('originalField',   'Source',         'description')}
          {field('noteField',       'Gold note',      '_note')}
          {field('responseField',   'Model response', 'inference_output')}
          {field('judgeScoreField', 'Judge score',    'eval')}
          {field('humanScoreField', 'Human score',    'human_score')}
        </div>

        {/* ── Report body ─────────────────────────────────────────────────── */}
        <div style={s.body} className="nodrag nowheel">
          <ComparisonReportView records={records} config={config} />
        </div>
      </div>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  card: {
    background: '#fff', border: '1.5px solid #d1d5db', borderRadius: 8,
    width: '100%', height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  header: {
    background: HEADER_COLOR, borderRadius: '6px 6px 0 0', padding: '0 12px',
    height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, flexShrink: 0,
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 12 },
  headerMeta:  { color: 'rgba(255,255,255,0.65)', fontSize: 10 },
  configPanel: {
    flexShrink: 0, padding: '8px 12px', borderBottom: '2px solid #e5e7eb',
    background: '#f8fafc', display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  configTitle: {
    fontSize: 10, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const,
    letterSpacing: '0.05em', marginBottom: 4,
  },
  configHint: {
    fontWeight: 400, textTransform: 'none' as const, color: '#9ca3af', letterSpacing: 0,
  },
  cfgRow: { display: 'flex', alignItems: 'center', gap: 8 },
  cfgLabel: { fontSize: 10, color: '#6b7280', minWidth: 96, flexShrink: 0, fontWeight: 600 },
  cfgSelect: {
    flex: 1, fontSize: 10, padding: '2px 4px', border: '1px solid #d1d5db',
    borderRadius: 3, outline: 'none', background: '#fff', color: '#111827',
    fontFamily: 'monospace', height: 22,
  },
  cfgInput: {
    flex: 1, fontSize: 10, padding: '2px 5px', border: '1px solid #d1d5db',
    borderRadius: 3, outline: 'none', fontFamily: 'monospace', height: 22,
  },
  body: { flex: 1, overflowY: 'auto' as const, minHeight: 0 },
  inputHandle: {
    width: 10, height: 10, background: HEADER_COLOR,
    border: '2px solid #fff', boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
}
