/**
 * ReconciliationNode — processing node that reconciles a field in upstream
 * records against a named authority (Wikidata, with VIAF/GeoNames as stubs).
 *
 * Position in the workflow:
 *   SearchNode / TableOutputNode  →  [data]  ReconciliationNode  [results]  →  Table / Map / etc.
 *
 * The node reads upstream records via the `data` input handle to populate the
 * field selector, then writes augmented records to `data.results` after running
 * so downstream output nodes can read them via useUpstreamRecords.
 */

import { useCallback, useMemo } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { runReconciliationNode } from '../utils/runReconciliationNode'
import {
  authoritiesForField,
  candidateFields,
  type AuthorityConfig,
} from '../utils/reconciliationService'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import type { UnifiedRecord } from '../types/UnifiedRecord'

// ─── data type ────────────────────────────────────────────────────────────────

export type ReconciliationStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ReconciliationNodeData {
  selectedField:       string
  selectedAuthority:   string
  confidenceThreshold: number
  status:              ReconciliationStatus
  statusMessage:       string
  results:             UnifiedRecord[] | undefined
  count:               number
  resolvedCount:       number
  reviewCount:         number
  [key: string]: unknown
}

// ─── layout constants (shared with ADSSearchNode pattern) ─────────────────────

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

// ─── status colours ───────────────────────────────────────────────────────────

const STATUS_BORDER: Record<ReconciliationStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}
const STATUS_BADGE: Record<ReconciliationStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
}

// ─── component ────────────────────────────────────────────────────────────────

export function ReconciliationNode({ id }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: snap } = useReactFlow()
  const liveEdges = useEdges()
  const { records: upstreamRecords } = useUpstreamRecords(id)

  // Read node's own data from the RF store
  const nodeData = getNodes().find(n => n.id === id)?.data as ReconciliationNodeData | undefined
  const d: ReconciliationNodeData = {
    selectedField:       '',
    selectedAuthority:   '',
    confidenceThreshold: 0.8,
    status:              'idle',
    statusMessage:       '',
    results:             undefined,
    count:               0,
    resolvedCount:       0,
    reviewCount:         0,
    ...nodeData,
  }

  const availableFields = upstreamRecords?.length
    ? candidateFields(upstreamRecords as unknown as Record<string, unknown>[])
    : []

  // When field changes, reset authority to first for that field
  const handleFieldChange = useCallback((field: string) => {
    const firstAuthority = authoritiesForField(field)[0]?.value ?? ''
    updateNodeData(id, { selectedField: field, selectedAuthority: firstAuthority })
  }, [id, updateNodeData])

  const authorities: AuthorityConfig[] = authoritiesForField(d.selectedField)

  const isDataConnected = useMemo(
    () => liveEdges.some(e => e.target === id && e.targetHandle === 'data'),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => runReconciliationNode(id, getNodes, snap(), updateNodeData),
    [id, getNodes, snap, updateNodeData],
  )

  const borderColor = STATUS_BORDER[d.status] ?? '#d1d5db'
  const badgeColor  = STATUS_BADGE[d.status]  ?? '#9ca3af'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* data input handle — aligned with first body row */}
      <Handle
        type="target"
        position={Position.Left}
        id="data"
        style={{
          ...styles.inputHandle,
          top: HEADER_H + BODY_PAD + 0 * ROW_H + 11,
          background: isDataConnected ? '#7c3aed' : '#c4b5fd',
          boxShadow: `0 0 0 1px ${isDataConnected ? '#7c3aed' : '#c4b5fd'}`,
        }}
      />

      {/* results output handle — aligned with header */}
      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={styles.outputHandle}
      />

      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Reconciliation</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: badgeColor }}>
            {d.statusMessage}
          </span>
        ) : null}
      </div>

      {/* ── Body ── */}
      <div style={styles.body}>

        {/* Row 0: field selector */}
        <div style={styles.row}>
          <span style={styles.label}>field</span>
          <select
            style={styles.select}
            value={d.selectedField}
            onChange={e => handleFieldChange(e.target.value)}
            disabled={!isDataConnected || availableFields.length === 0}
            className="nodrag"
          >
            {!isDataConnected || availableFields.length === 0 ? (
              <option value="">Connect an upstream node first</option>
            ) : (
              <>
                <option value="">— select field —</option>
                {availableFields.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </>
            )}
          </select>
        </div>

        {/* Row 1: authority selector */}
        <div style={styles.row}>
          <span style={styles.label}>authority</span>
          <select
            style={styles.select}
            value={d.selectedAuthority}
            onChange={e => updateNodeData(id, { selectedAuthority: e.target.value })}
            disabled={!d.selectedField}
            className="nodrag"
          >
            {authorities.map(a => (
              <option
                key={a.value}
                value={a.value}
                disabled={a.comingSoon}
                title={a.comingSoon ? 'Coming soon' : undefined}
              >
                {a.label}{a.comingSoon ? ' (coming soon)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Row 2: confidence threshold */}
        <div style={styles.sliderBlock}>
          <div style={styles.sliderRow}>
            <span style={styles.label}>confidence</span>
            <span style={styles.sliderValue}>
              {d.confidenceThreshold.toFixed(2)}
            </span>
            <input
              type="range"
              min={0.5}
              max={1.0}
              step={0.05}
              value={d.confidenceThreshold}
              onChange={e => updateNodeData(id, { confidenceThreshold: parseFloat(e.target.value) })}
              style={styles.slider}
              className="nodrag"
            />
          </div>
          <p style={styles.hint}>
            Records below this threshold are flagged for review but still passed through
          </p>
        </div>

        {/* Live configuration summary */}
        {d.selectedField && d.selectedAuthority && (
          <div style={styles.summary}>
            Reconciling <strong>{d.selectedField}</strong> → <strong>
              {authorities.find(a => a.value === d.selectedAuthority)?.label ?? d.selectedAuthority}
            </strong>
          </div>
        )}

        {/* Post-run status counts */}
        {d.status === 'success' && (
          <div style={styles.counts}>
            <span style={styles.resolved}>{d.resolvedCount} resolved</span>
            <span style={styles.review}>{d.reviewCount} for review</span>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={styles.footer}>
        <button
          style={{ ...styles.runBtn, opacity: d.status === 'loading' ? 0.6 : 1 }}
          onClick={handleRun}
          disabled={d.status === 'loading' || !d.selectedField || !isDataConnected}
          className="nodrag"
        >
          {d.status === 'loading' ? 'Running…' : '▶  Reconcile'}
        </button>
      </div>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const HEADER_COLOR  = '#7c3aed'   // violet-600 — "transform" identity
const RUN_BTN_COLOR = '#6d28d9'   // violet-700

const styles = {
  card: {
    background:   '#fff',
    border:       '2px solid #d1d5db',
    borderRadius: 8,
    minWidth:     260,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
    transition:   'border-color 0.25s',
  },
  header: {
    height:         HEADER_H,
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
  statusBadge: {
    fontSize:     10,
    fontWeight:   600,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  body: {
    paddingTop:    BODY_PAD,
    paddingLeft:   14,
    paddingRight:  10,
    paddingBottom: 4,
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           5,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    height:     ROW_H - 5,
  },
  label: {
    fontSize:   11,
    color:      '#6b7280',
    width:      60,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    background:   '#f9fafb',
    outline:      'none',
    height:       22,
    minWidth:     0,
  },
  sliderBlock: {
    paddingTop: 4,
  },
  sliderRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  sliderValue: {
    fontSize:   11,
    color:      '#374151',
    fontFamily: 'monospace',
    width:      32,
    flexShrink: 0,
  },
  slider: {
    flex:    1,
    height:  4,
    cursor:  'pointer',
    accentColor: HEADER_COLOR,
  },
  hint: {
    margin:     '3px 0 0 66px',
    fontSize:   9,
    color:      '#9ca3af',
    lineHeight: 1.3,
  },
  summary: {
    marginTop:  4,
    fontSize:   10,
    color:      '#4b5563',
    background: '#f5f3ff',
    border:     '1px solid #ede9fe',
    borderRadius: 4,
    padding:    '3px 7px',
  },
  counts: {
    display: 'flex',
    gap:     8,
    fontSize: 10,
    fontWeight: 600,
  },
  resolved: {
    color:        '#15803d',
    background:   '#dcfce7',
    border:       '1px solid #86efac',
    borderRadius: 10,
    padding:      '1px 7px',
  },
  review: {
    color:        '#92400e',
    background:   '#fef9c3',
    border:       '1px solid #fde68a',
    borderRadius: 10,
    padding:      '1px 7px',
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    justifyContent: 'flex-end',
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
  inputHandle: {
    width:        8,
    height:       8,
    border:       '2px solid #fff',
    position:     'absolute' as const,
    left:         -5,
    borderRadius: '50%',
  },
  outputHandle: {
    width:      10,
    height:     10,
    background: '#7c3aed',
    border:     '2px solid #fff',
    boxShadow:  '0 0 0 1px #7c3aed',
    top:        13,
  },
}
