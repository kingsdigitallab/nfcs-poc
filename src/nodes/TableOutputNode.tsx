import { useState, useEffect, useRef, useMemo } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { ReconciliationResult } from '../utils/reconciliationService'
import { isReconciledValue } from '../utils/reconciliationService'
import { renderCell }        from './ReconciledCell'

export interface TableOutputNodeData {
  [key: string]: unknown
}

/**
 * Default columns shown for any mix of services.
 * Columns with no non-null values in the current records are auto-hidden,
 * so GBIF-only results won't show empty 'title'/'creator' columns, and
 * LLDS-only results won't show empty 'scientificName' columns.
 */
const DEFAULT_COLS = [
  '_source',
  'title',
  'creator',
  'date',
  'country',
  'subject',
  'language',
  'scientificName',
  'basisOfRecord',
  'institutionCode',
] as const

const PAGE_SIZE = 25

/**
 * All displayable (flat) columns across records.
 * Arrays count as flat (creator, subject). Nested objects (gbif:{}, llds:{})
 * are service namespaces and are excluded from column detection — except
 * *_reconciled objects which have their own dedicated renderer.
 */
function allFlatColumns(records: UnifiedRecord[]): string[] {
  const keys = new Set<string>()
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (v === null) continue
      if (typeof v !== 'object' || Array.isArray(v) || isReconciledValue(v)) keys.add(k)
    }
  }
  // Default cols first (preserving order), then any extras alphabetically
  const ordered = DEFAULT_COLS.filter(c => keys.has(c))
  const extras = [...keys]
    .filter(k => !(DEFAULT_COLS as readonly string[]).includes(k))
    .sort()
  return [...ordered, ...extras]
}


interface TableProps {
  records:  UnifiedRecord[]
  columns:  string[]
  page:     number
  pageSize: number
  compact?: boolean
  onSelectCandidate?: (recordId: string, col: string, result: ReconciliationResult) => void
}

function RecordTable({ records, columns, page, pageSize, compact = false, onSelectCandidate }: TableProps) {
  const start = page * pageSize
  const rows = records.slice(start, start + pageSize)
  const fs = compact ? 11 : 12
  const pad = compact ? '3px 6px' : '5px 8px'

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: fs }}>
      <thead>
        <tr>
          {columns.map(col => (
            <th key={col} style={{ ...thStyle, padding: pad, whiteSpace: 'nowrap' }}>
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((rec, i) => (
          <tr key={rec.id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
            {columns.map(col => {
              const val = rec[col as keyof UnifiedRecord]
              const handleSelect = onSelectCandidate
                ? (result: ReconciliationResult) => onSelectCandidate(rec.id, col, result)
                : undefined
              return (
                <td key={col} style={{ ...tdStyle, padding: pad }}>
                  {renderCell(val, handleSelect)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TableOutputNode({ id, data }: NodeProps) {
  const { records, count, status, connected, sourceCount } = useUpstreamRecords(id)
  const { updateNodeData } = useReactFlow()
  const [page,    setPage]    = useState(0)
  const [showAll, setShowAll] = useState(false)

  // Selections live in node data so ExpandedOutputPanel can share them.
  // Key = `${recordId}::${colName}`, value = the chosen ReconciliationResult.
  const selections = ((data as Record<string, unknown>).selections ?? {}) as Record<string, ReconciliationResult>

  // Overlay user selections onto upstream records
  const effectiveRecords = useMemo<UnifiedRecord[] | null>(() => {
    if (!records) return null
    if (Object.keys(selections).length === 0) return records
    return records.map(rec => {
      const patch: Record<string, unknown> = {}
      for (const [key, result] of Object.entries(selections)) {
        const sep = key.indexOf('::')
        if (sep === -1) continue
        const recId = key.slice(0, sep)
        const col   = key.slice(sep + 2)
        if (rec.id === recId) patch[col] = result
      }
      return Object.keys(patch).length > 0 ? { ...rec, ...patch } as UnifiedRecord : rec
    })
  }, [records, selections])

  function handleSelectCandidate(recordId: string, col: string, result: ReconciliationResult) {
    updateNodeData(id, {
      selections: { ...selections, [`${recordId}::${col}`]: result },
    })
  }

  // ── pass-through output ───────────────────────────────────────────────────
  // Sync merged records into this node's own data so downstream nodes
  // (e.g. MapOutputNode) can read them via useUpstreamRecords.
  // Key includes selection state so downstream sees user overrides.
  const prevKeyRef = useRef('')
  useEffect(() => {
    const selKey = Object.entries(selections).map(([k, v]) => `${k}=${v.qid}`).join(',')
    const key = `${status}:${selKey}:${(effectiveRecords ?? []).map(r => r.id).join('\n')}`
    if (key === prevKeyRef.current) return
    prevKeyRef.current = key
    updateNodeData(id, {
      results: effectiveRecords ?? [],
      count:   effectiveRecords?.length ?? 0,
      status,
    })
  }, [effectiveRecords, selections, status, id, updateNodeData])

  const columns = effectiveRecords
    ? showAll
      ? allFlatColumns(effectiveRecords)
      : DEFAULT_COLS.filter(c => effectiveRecords.some(r => r[c] != null))
    : []

  const totalPages = effectiveRecords ? Math.ceil(effectiveRecords.length / PAGE_SIZE) : 0
  const selectionCount = Object.keys(selections).length

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left}  id="data"    style={styles.inputHandle} />
      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />

      <div style={styles.header}>
        <span style={styles.title}>Table Output</span>
        {connected && effectiveRecords && (
          <span style={styles.badge}>
            {effectiveRecords.length}{count > effectiveRecords.length ? ` / ${count.toLocaleString()} total` : ''} rows
            {sourceCount > 1 ? ` · ${sourceCount} sources` : ''}
          </span>
        )}
        {selectionCount > 0 && (
          <span style={{ ...styles.badge, color: '#fde68a' }}>
            {selectionCount} override{selectionCount !== 1 ? 's' : ''}
          </span>
        )}
        {connected && status === 'loading' && (
          <span style={{ ...styles.badge, color: '#93c5fd' }}>loading…</span>
        )}
      </div>

      {!connected && (
        <div style={styles.placeholder}>
          Connect a search node to the input handle
        </div>
      )}

      {connected && !effectiveRecords && status !== 'loading' && (
        <div style={styles.placeholder}>Run the upstream node to see results</div>
      )}

      {connected && effectiveRecords && effectiveRecords.length === 0 && (
        <div style={styles.placeholder}>Query returned 0 results</div>
      )}

      {connected && effectiveRecords && effectiveRecords.length > 0 && (
        <>
          <div style={styles.toolbar}>
            <label style={styles.toggleLabel} className="nodrag">
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => { setShowAll(e.target.checked); setPage(0) }}
                className="nodrag"
              />
              {' '}show all columns
            </label>
            <span style={styles.colCount}>{columns.length} col{columns.length !== 1 ? 's' : ''}</span>
          </div>

          <div style={styles.tableWrap} className="nodrag nowheel">
            <RecordTable
              records={effectiveRecords}
              columns={columns}
              page={page}
              pageSize={PAGE_SIZE}
              compact
              onSelectCandidate={handleSelectCandidate}
            />
          </div>

          {totalPages > 1 && (
            <div style={styles.pager} className="nodrag">
              <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                ‹ Prev
              </button>
              <span style={styles.pageInfo}>
                {page + 1} / {totalPages}
              </span>
              <button style={styles.pageBtn} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>
                Next ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '1.5px solid #d1d5db',
    borderRadius: 8,
    minWidth: 520,
    maxWidth: 700,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  header: {
    background: '#0d9488',
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
  },
  badge: {
    color: '#99f6e4',
    fontSize: 10,
    fontWeight: 600,
  },
  placeholder: {
    padding: '20px 16px',
    color: '#9ca3af',
    fontSize: 12,
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 10px',
    borderBottom: '1px solid #f0f0f0',
    background: '#f9fafb',
  },
  toggleLabel: {
    fontSize: 11,
    color: '#6b7280',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  colCount: {
    fontSize: 10,
    color: '#9ca3af',
  },
  tableWrap: {
    overflowX: 'auto' as const,
    overflowY: 'auto' as const,
    maxHeight: 300,
  },
  pager: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '5px 10px',
    borderTop: '1px solid #f0f0f0',
    background: '#f9fafb',
  },
  pageBtn: {
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 11,
    cursor: 'pointer',
  },
  pageInfo: {
    fontSize: 11,
    color: '#6b7280',
  },
  inputHandle: {
    width:     10,
    height:    10,
    background: '#0d9488',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #0d9488',
  },
  // Pass-through output — positioned at the top-right to align with the header
  outputHandle: {
    width:     10,
    height:    10,
    background: '#0d9488',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #0d9488',
    top:       13,
  },
}

const thStyle: React.CSSProperties = {
  background: '#f3f4f6',
  borderBottom: '2px solid #e5e7eb',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  position: 'sticky',
  top: 0,
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid #f0f0f0',
  color: '#4b5563',
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
