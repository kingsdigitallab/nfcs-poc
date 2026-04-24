/**
 * QuickViewNode — inspect the full, untruncated value of any field across
 * upstream records. Navigate records with prev/next buttons. Useful for
 * reviewing long fields like fetchedContent, ollamaResponse, description.
 *
 * Display-only: no runner, no output handle.
 */

import { useState, useMemo } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { isReconciledValue } from '../utils/reconciliationService'

const HEADER_COLOR = '#1e293b'
const ROWS_PER_PAGE = 50
const TEXT_LIMIT = 50_000

export interface QuickViewNodeData {
  selectedField: string
  [key: string]: unknown
}

function isImageDataUrl(val: unknown): boolean {
  return typeof val === 'string' && val.startsWith('data:image/')
}

function detectTabular(val: string): 'tsv' | 'csv' | null {
  const lines = val.split('\n').filter(l => l.trim())
  if (lines.length < 2) return null
  const sample = lines.slice(0, 6)
  const tabCounts = sample.map(l => (l.match(/\t/g) || []).length)
  if (tabCounts[0] > 0 && tabCounts.every(c => c === tabCounts[0])) return 'tsv'
  const commaCounts = sample.map(l => (l.match(/,/g) || []).length)
  if (commaCounts[0] > 0 && commaCounts.every(c => c === commaCounts[0])) return 'csv'
  return null
}

function parseTabularRows(val: string, delim: string): string[][] {
  return val.split('\n').filter(l => l.trim()).map(l => l.split(delim))
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (isReconciledValue(val)) {
    const r = val as { id?: string; name?: string; score?: number; match?: boolean }
    return `${r.name ?? '?'} (${r.id ?? ''}) — score: ${r.score ?? '?'}, match: ${String(r.match)}`
  }
  if (Array.isArray(val)) return val.join('\n')
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

export function QuickViewNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const { records, connected } = useUpstreamRecords(id)
  const d = data as QuickViewNodeData

  const [recordIndex, setRecordIndex] = useState(0)
  const [tabularPage, setTabularPage] = useState(0)
  const [copied, setCopied] = useState(false)

  const availableFields = useMemo<string[]>(() => {
    if (!records || records.length === 0) return []
    const keys = new Set<string>()
    for (const r of records.slice(0, 20)) {
      for (const k of Object.keys(r as Record<string, unknown>)) {
        keys.add(k)
      }
    }
    return [...keys].sort()
  }, [records])

  const selectedField = d.selectedField || availableFields[0] || ''

  const safeIndex = records && records.length > 0
    ? Math.min(recordIndex, records.length - 1)
    : 0

  const currentRecord = records?.[safeIndex] as Record<string, unknown> | undefined
  const rawFieldValue = currentRecord ? currentRecord[selectedField] : undefined
  const isImage = isImageDataUrl(rawFieldValue)
  const fieldValue = rawFieldValue != null && !isImage ? formatValue(rawFieldValue) : ''

  const tabularType = useMemo(() => {
    if (!fieldValue || fieldValue.length < 20) return null
    return detectTabular(fieldValue)
  }, [fieldValue])

  const tabularRows = useMemo(() => {
    if (!tabularType) return null
    return parseTabularRows(fieldValue, tabularType === 'tsv' ? '\t' : ',')
  }, [fieldValue, tabularType])

  const recordLabel = currentRecord
    ? String(
        (currentRecord.title as string | undefined) ||
        (currentRecord.filename as string | undefined) ||
        (currentRecord.id as string | undefined) ||
        `Record ${safeIndex + 1}`
      )
    : ''

  function handleCopy() {
    if (!fieldValue) return
    navigator.clipboard.writeText(fieldValue).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Quick View</span>
        {records && records.length > 0 && (
          <div style={styles.navGroup}>
            <button
              style={styles.navBtn}
              onClick={() => { setRecordIndex(i => Math.max(0, i - 1)); setTabularPage(0) }}
              disabled={safeIndex === 0}
              className="nodrag"
              title="Previous record"
            >
              ‹
            </button>
            <span style={styles.navLabel}>
              {safeIndex + 1} / {records.length}
            </span>
            <button
              style={styles.navBtn}
              onClick={() => { setRecordIndex(i => Math.min(records.length - 1, i + 1)); setTabularPage(0) }}
              disabled={safeIndex === records.length - 1}
              className="nodrag"
              title="Next record"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {/* Field picker */}
      <div style={styles.toolbar}>
        {availableFields.length > 0 ? (
          <select
            style={styles.fieldSelect}
            value={selectedField}
            onChange={e => {
              updateNodeData(id, { selectedField: e.target.value })
              setRecordIndex(0)
              setTabularPage(0)
            }}
            className="nodrag"
          >
            {availableFields.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
            {connected ? 'Run upstream node first' : 'Connect a node'}
          </span>
        )}
        {fieldValue && (
          <button
            style={{ ...styles.copyBtn, background: copied ? '#16a34a' : '#374151' }}
            onClick={handleCopy}
            className="nodrag"
            title="Copy value"
          >
            {copied ? '✓' : 'Copy'}
          </button>
        )}
      </div>

      {/* Record label */}
      {recordLabel && (
        <div style={styles.recordLabel} title={recordLabel}>
          {recordLabel}
        </div>
      )}

      {/* Content area */}
      {!connected ? (
        <div style={styles.placeholder}>Connect a node to the input handle</div>
      ) : !records ? (
        <div style={styles.placeholder}>Run the upstream node to see results</div>
      ) : !selectedField ? (
        <div style={styles.placeholder}>No fields available</div>
      ) : isImage ? (
        <div style={styles.placeholder}>
          Image data — use an <strong>ImageViewNode</strong> to display it
        </div>
      ) : tabularRows ? (() => {
        const header = tabularRows[0] ?? []
        const dataRows = tabularRows.slice(1)
        const pageStart = tabularPage * ROWS_PER_PAGE
        const pageRows = dataRows.slice(pageStart, pageStart + ROWS_PER_PAGE)
        const totalPages = Math.ceil(dataRows.length / ROWS_PER_PAGE)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
            <div style={styles.contentWrap} className="nodrag nowheel">
              <table style={styles.table}>
                <thead>
                  <tr>{header.map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {pageRows.map((row, ri) => (
                    <tr key={ri} style={ri % 2 === 1 ? { background: '#f8fafc' } : undefined}>
                      {row.map((cell, ci) => <td key={ci} style={styles.td}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div style={styles.pageBar} className="nodrag">
                <button style={styles.pageBtn} onClick={() => setTabularPage(p => Math.max(0, p - 1))} disabled={tabularPage === 0}>‹</button>
                <span style={styles.pageLabel}>
                  Rows {pageStart + 1}–{Math.min(pageStart + ROWS_PER_PAGE, dataRows.length)} of {dataRows.length}
                </span>
                <button style={styles.pageBtn} onClick={() => setTabularPage(p => Math.min(totalPages - 1, p + 1))} disabled={tabularPage === totalPages - 1}>›</button>
              </div>
            )}
          </div>
        )
      })() : (
        <div style={styles.contentWrap} className="nodrag nowheel">
          <pre style={styles.content}>
            {fieldValue.length > TEXT_LIMIT ? fieldValue.slice(0, TEXT_LIMIT) : fieldValue}
          </pre>
          {fieldValue.length > TEXT_LIMIT && (
            <div style={styles.truncNotice}>
              Showing first {TEXT_LIMIT.toLocaleString()} of {fieldValue.length.toLocaleString()} chars — copy for full value
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '1.5px solid #d1d5db',
    borderRadius: 8,
    minWidth: 300,
    maxWidth: 400,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    background:   HEADER_COLOR,
    borderRadius: '6px 6px 0 0',
    padding:      '0 10px',
    height:       32,
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'space-between',
    gap: 8,
    flexShrink: 0,
  },
  headerTitle: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
  },
  navGroup: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
  },
  navBtn: {
    background:  'rgba(255,255,255,0.15)',
    border:      'none',
    color:       '#fff',
    borderRadius: 3,
    width:       20,
    height:      20,
    fontSize:    14,
    lineHeight:  1,
    cursor:      'pointer',
    display:     'flex',
    alignItems:  'center',
    justifyContent: 'center',
    padding:     0,
    fontWeight:  700,
  },
  navLabel: {
    color:    '#94a3b8',
    fontSize: 11,
    minWidth: 42,
    textAlign: 'center' as const,
    fontFamily: 'monospace',
  },
  toolbar: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    padding:    '6px 10px',
    borderBottom: '1px solid #f1f5f9',
    flexShrink: 0,
  },
  fieldSelect: {
    flex:        1,
    fontSize:    11,
    padding:     '2px 4px',
    border:      '1px solid #d1d5db',
    borderRadius: 4,
    outline:     'none',
    height:      24,
    fontFamily:  'monospace',
  },
  copyBtn: {
    color:       '#fff',
    border:      'none',
    borderRadius: 4,
    padding:     '2px 8px',
    fontSize:    11,
    fontWeight:  600,
    cursor:      'pointer',
    flexShrink:  0,
    transition:  'background 0.2s',
  },
  recordLabel: {
    fontSize:    11,
    color:       '#374151',
    fontWeight:  600,
    padding:     '4px 10px 2px',
    overflow:    'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:  'nowrap' as const,
    borderBottom: '1px solid #f1f5f9',
    flexShrink:  0,
  },
  contentWrap: {
    overflowY:  'auto' as const,
    maxHeight:  320,
    minHeight:  80,
  },
  content: {
    margin:      0,
    padding:     '10px 12px',
    fontSize:    11,
    lineHeight:  1.6,
    fontFamily:  "'Consolas', 'Menlo', monospace",
    color:       '#111827',
    whiteSpace:  'pre-wrap' as const,
    wordBreak:   'break-word' as const,
  },
  placeholder: {
    padding:    '20px 16px',
    color:      '#9ca3af',
    fontSize:   11,
    fontStyle:  'italic' as const,
    textAlign:  'center' as const,
  },
  truncNotice: {
    padding:    '4px 12px 8px',
    color:      '#9ca3af',
    fontSize:   10,
    fontStyle:  'italic' as const,
    borderTop:  '1px solid #f1f5f9',
  },
  table: {
    borderCollapse: 'collapse' as const,
    width:          '100%',
    fontSize:       10,
    fontFamily:     "'Consolas', 'Menlo', monospace",
  },
  th: {
    padding:        '3px 6px',
    background:     '#f1f5f9',
    borderBottom:   '1px solid #d1d5db',
    fontWeight:     700,
    textAlign:      'left' as const,
    whiteSpace:     'nowrap' as const,
    position:       'sticky' as const,
    top:            0,
    color:          '#374151',
  },
  td: {
    padding:        '2px 6px',
    borderBottom:   '1px solid #f1f5f9',
    color:          '#111827',
    maxWidth:       180,
    overflow:       'hidden',
    textOverflow:   'ellipsis',
    whiteSpace:     'nowrap' as const,
  },
  pageBar: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    padding:        '4px 10px',
    borderTop:      '1px solid #f1f5f9',
    flexShrink:     0,
  },
  pageBtn: {
    background:     '#374151',
    color:          '#fff',
    border:         'none',
    borderRadius:   3,
    width:          20,
    height:         20,
    fontSize:       13,
    cursor:         'pointer',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        0,
    fontWeight:     700,
  },
  pageLabel: {
    fontSize:       10,
    color:          '#6b7280',
    fontFamily:     'monospace',
  },
  inputHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
}
