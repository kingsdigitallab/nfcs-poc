import { useState, useEffect, useRef, useMemo } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { setNodeResults } from '../store/resultsStore'
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

const PAGE_SIZES = [10, 25, 50, 100] as const

/**
 * All displayable columns across records.
 * Arrays count as flat (creator, subject). Plain nested objects are service
 * namespaces and excluded by default — except *_reconciled which has its own
 * renderer. When expandNamespaces=true, namespace objects are one-level-flattened
 * into dot-notation columns (e.g. "adsLibrary.detailProxy", "gbif.datasetKey").
 */
function allFlatColumns(records: UnifiedRecord[], expandNamespaces = false): string[] {
  const keys = new Set<string>()
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) continue
      if (typeof v !== 'object' || Array.isArray(v) || isReconciledValue(v)) {
        keys.add(k)
      } else if (expandNamespaces) {
        for (const [subk, subv] of Object.entries(v as Record<string, unknown>)) {
          if (subv !== null && subv !== undefined) keys.add(`${k}.${subk}`)
        }
      }
    }
  }
  const ordered = DEFAULT_COLS.filter(c => keys.has(c))
  const extras  = [...keys]
    .filter(k => !(DEFAULT_COLS as readonly string[]).includes(k))
    .sort()
  return [...ordered, ...extras]
}

/** Resolve a plain or dot-notation column key against a record. */
function getColValue(rec: UnifiedRecord, col: string): unknown {
  const dot = col.indexOf('.')
  if (dot === -1) return rec[col as keyof UnifiedRecord]
  const ns    = col.slice(0, dot)
  const key   = col.slice(dot + 1)
  const nsObj = rec[ns as keyof UnifiedRecord]
  if (nsObj && typeof nsObj === 'object' && !Array.isArray(nsObj)) {
    return (nsObj as Record<string, unknown>)[key]
  }
  return undefined
}


function sortValue(rec: UnifiedRecord, col: string): string | number {
  const v = getColValue(rec, col)
  if (v === null || v === undefined) return '￿'   // sort nulls last
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 0 : 1
  if (isReconciledValue(v)) return (v as ReconciliationResult).label ?? '￿'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

interface TableProps {
  records:   UnifiedRecord[]
  columns:   string[]
  page:      number
  pageSize:  number
  compact?:  boolean
  sortCol?:  string | null
  sortDir?:  'asc' | 'desc'
  onSort?:   (col: string) => void
  onSelectCandidate?: (recordId: string, col: string, result: ReconciliationResult) => void
}

const DEFAULT_COL_W = 140

function RecordTable({ records, columns, page, pageSize, compact = false, sortCol, sortDir, onSort, onSelectCandidate }: TableProps) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null)
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null)

  // Clean up document listeners if the component unmounts mid-drag
  useEffect(() => () => {
    if (listenersRef.current) {
      document.removeEventListener('mousemove', listenersRef.current.move)
      document.removeEventListener('mouseup',   listenersRef.current.up)
      document.body.style.cursor = ''
    }
  }, [])

  function startResize(e: React.MouseEvent, col: string) {
    e.preventDefault()
    e.stopPropagation()
    const startW = colWidths[col] ?? DEFAULT_COL_W
    resizingRef.current = { col, startX: e.clientX, startW }
    document.body.style.cursor = 'col-resize'

    const onMove = (mv: MouseEvent) => {
      if (!resizingRef.current) return
      const newW = Math.max(48, resizingRef.current.startW + (mv.clientX - resizingRef.current.startX))
      setColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }))
    }
    const onUp = () => {
      resizingRef.current = null
      listenersRef.current = null
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    listenersRef.current = { move: onMove, up: onUp }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  const start = page * pageSize
  const rows  = records.slice(start, start + pageSize)
  const fs    = compact ? 11 : 12
  const pad   = compact ? '3px 6px' : '5px 8px'

  return (
    <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', minWidth: '100%', fontSize: fs }}>
      <thead>
        <tr>
          {columns.map(col => {
            const w        = colWidths[col] ?? DEFAULT_COL_W
            const isActive = sortCol === col
            const title    = isActive
              ? sortDir === 'asc' ? 'Sorted A→Z — click for Z→A' : 'Sorted Z→A — click to clear'
              : `Sort by ${col}`
            return (
              <th
                key={col}
                style={{
                  ...thStyle, padding: pad,
                  width: w, minWidth: w, maxWidth: w,
                  cursor: 'pointer', userSelect: 'none',
                  background: isActive ? '#e5e7eb' : '#f3f4f6',
                }}
                onClick={() => onSort?.(col)}
                title={title}
              >
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 6 }}>
                  {col}
                  {isActive && (
                    <span style={{ marginLeft: 3, fontSize: '0.85em' }}>
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </span>
                {/* Resize handle — stopPropagation prevents triggering the sort click */}
                <div
                  className="nodrag"
                  style={resizeHandleStyle}
                  onMouseDown={e => startResize(e, col)}
                  title="Drag to resize"
                />
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((rec, i) => (
          <tr key={start + i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
            {columns.map(col => {
              const val = getColValue(rec, col)
              const w   = colWidths[col] ?? DEFAULT_COL_W
              const handleSelect = onSelectCandidate
                ? (result: ReconciliationResult) => onSelectCandidate(rec.id, col, result)
                : undefined
              return (
                <td key={col} style={{ ...tdStyle, padding: pad, width: w, maxWidth: w }}>
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
  const [page,             setPage]             = useState(0)
  const [showAll,          setShowAll]          = useState(false)
  const [expandNamespaces, setExpandNamespaces] = useState(false)
  const [pageSize,         setPageSize]         = useState<number>(PAGE_SIZES[1])
  const [sortCol,          setSortCol]          = useState<string | null>(null)
  const [sortDir,          setSortDir]          = useState<'asc' | 'desc'>('asc')
  const [filterText,       setFilterText]       = useState('')

  const tableWrapRef = useRef<HTMLDivElement>(null)

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

  const filteredRecords = useMemo<UnifiedRecord[] | null>(() => {
    if (!effectiveRecords) return null
    const q = filterText.trim().toLowerCase()
    if (!q) return effectiveRecords
    return effectiveRecords.filter(r =>
      Object.values(r).some(v => {
        if (v === null || v === undefined) return false
        if (isReconciledValue(v)) return (v as ReconciliationResult).label?.toLowerCase().includes(q)
        if (typeof v === 'object' && !Array.isArray(v)) {
          return Object.values(v as Record<string, unknown>).some(
            sv => sv != null && String(sv).toLowerCase().includes(q),
          )
        }
        return String(v).toLowerCase().includes(q)
      }),
    )
  }, [effectiveRecords, filterText])

  const sortedRecords = useMemo<UnifiedRecord[] | null>(() => {
    if (!filteredRecords || !sortCol) return filteredRecords
    return [...filteredRecords].sort((a, b) => {
      const av = sortValue(a, sortCol)
      const bv = sortValue(b, sortCol)
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const cmp = String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredRecords, sortCol, sortDir])

  function handleColSort(col: string) {
    if (sortCol === col) {
      if (sortDir === 'asc') {
        setSortDir('desc')
      } else {
        setSortCol(null)   // third click clears sort
      }
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
    setPage(0)
  }

  // ── pass-through output ───────────────────────────────────────────────────
  // Sync merged records into this node's own data so downstream nodes
  // (e.g. MapOutputNode) can read them via useUpstreamRecords.
  // Key includes selection state so downstream sees user overrides.
  // Pass-through: write merged records to the out-of-band store so downstream
  // nodes (Map, Timeline, Export) can read them. Uses a cheap fingerprint
  // instead of joining all IDs — avoids O(n) string creation on every render.
  const prevFingerprintRef = useRef('')
  useEffect(() => {
    const recs   = effectiveRecords ?? []
    const selKey = Object.entries(selections).map(([k, v]) => `${k}=${v.qid}`).join(',')
    const fp     = `${status}:${selKey}:${recs.length}:${recs[0]?.id ?? ''}:${recs[recs.length - 1]?.id ?? ''}`
    if (fp === prevFingerprintRef.current) return
    prevFingerprintRef.current = fp

    const version = setNodeResults(id, recs as Record<string, unknown>[])
    updateNodeData(id, {
      count:          recs.length,
      status,
      resultsVersion: version,
    })
  }, [effectiveRecords, selections, status, id, updateNodeData])

  // Scroll the table back to the top whenever the page or sort changes
  useEffect(() => {
    tableWrapRef.current?.scrollTo({ top: 0 })
  }, [page, sortCol, sortDir])

  const columns = effectiveRecords
    ? showAll
      ? allFlatColumns(effectiveRecords, expandNamespaces)
      : DEFAULT_COLS.filter(c => effectiveRecords.some(r => r[c] != null))
    : []

  const displayRecords = sortedRecords ?? effectiveRecords
  const totalPages = displayRecords ? Math.ceil(displayRecords.length / pageSize) : 0
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
            <div style={styles.toggleGroup}>
              <label style={styles.toggleLabel} className="nodrag">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={e => { setShowAll(e.target.checked); setPage(0) }}
                  className="nodrag"
                />
                {' '}show all columns
              </label>
              {showAll && (
                <label style={styles.toggleLabel} className="nodrag">
                  <input
                    type="checkbox"
                    checked={expandNamespaces}
                    onChange={e => setExpandNamespaces(e.target.checked)}
                    className="nodrag"
                  />
                  {' '}expand namespaces
                </label>
              )}
            </div>
            <div style={styles.toggleGroup}>
              <label style={{ ...styles.toggleLabel, gap: 4 }} className="nodrag">
                Rows:
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
                  className="nodrag"
                  style={styles.pageSizeSelect}
                >
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <span style={styles.colCount}>{columns.length} col{columns.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          <div style={styles.filterRow} className="nodrag">
            <input
              type="text"
              placeholder="Filter rows…"
              value={filterText}
              onChange={e => { setFilterText(e.target.value); setPage(0) }}
              style={styles.filterInput}
              className="nodrag"
            />
            {filterText && (
              <button
                onClick={() => { setFilterText(''); setPage(0) }}
                style={styles.filterClear}
                className="nodrag"
                title="Clear filter"
              >
                ×
              </button>
            )}
            {filterText && filteredRecords != null && (
              <span style={styles.filterCount}>
                {filteredRecords.length} match{filteredRecords.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          <div ref={tableWrapRef} style={styles.tableWrap} className="nodrag nowheel">
            <RecordTable
              records={displayRecords!}
              columns={columns}
              page={page}
              pageSize={pageSize}
              compact
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleColSort}
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
  toggleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
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
  pageSizeSelect: {
    fontSize:     11,
    border:       '1px solid #d1d5db',
    borderRadius: 3,
    padding:      '0 2px',
    background:   '#fff',
    cursor:       'pointer' as const,
  },
  filterRow: {
    display:     'flex',
    alignItems:  'center',
    gap:         4,
    padding:     '4px 8px',
    borderBottom: '1px solid #f0f0f0',
    background:  '#fff',
  },
  filterInput: {
    flex:         1,
    fontSize:     11,
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    padding:      '3px 7px',
    outline:      'none',
    color:        '#374151',
  },
  filterClear: {
    border:       'none',
    background:   'transparent',
    cursor:       'pointer' as const,
    fontSize:     15,
    lineHeight:   1,
    color:        '#9ca3af',
    padding:      '0 2px',
  },
  filterCount: {
    fontSize:   10,
    color:      '#6b7280',
    whiteSpace: 'nowrap' as const,
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
  background:   '#f3f4f6',
  borderBottom: '2px solid #e5e7eb',
  textAlign:    'left',
  fontWeight:   600,
  color:        '#374151',
  position:     'sticky',
  top:          0,
  // zIndex required so sticky headers stay above tbody rows in the same
  // stacking context — without it clicks on the header land on rows beneath
  zIndex:       1,
  overflow:     'hidden',
}

const resizeHandleStyle: React.CSSProperties = {
  position:   'absolute',
  right:      0,
  top:        0,
  bottom:     0,
  width:      5,
  cursor:     'col-resize',
  background: 'transparent',
}

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid #f0f0f0',
  color:        '#4b5563',
  overflow:     'hidden',
  textOverflow: 'ellipsis',
  whiteSpace:   'nowrap',
}
