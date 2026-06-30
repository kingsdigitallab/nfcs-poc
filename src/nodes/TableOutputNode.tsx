import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react'
import { setNodeResults } from '../store/resultsStore'
import { getNote, setNote, subscribeNotes } from '../store/notesStore'
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

const CORE_UNIFIED_FIELDS = new Set([
  'id', 'title', 'description', 'creator', 'date', 'subject', 'language',
  'type', 'format', 'collection', 'spatialCoverage', 'country',
  'periodStart', 'periodEnd', 'periodName',
  'scientificName', 'kingdom', 'phylum', 'class', 'order', 'family',
  'genus', 'species', 'eventDate', 'decimalLatitude', 'decimalLongitude',
  'basisOfRecord', 'institutionCode', 'datasetName',
])

/** Ordered list of fields shown in the row hover summary popup. */
const POPUP_FIELD_ORDER = [
  '_source', 'title', 'description', 'creator', 'date', 'country',
  'subject', 'language', 'type', 'collection', 'spatialCoverage',
  'periodStart', 'periodEnd', 'periodName',
  'scientificName', 'basisOfRecord', 'institutionCode', 'datasetName',
  'decimalLatitude', 'decimalLongitude',
]

/** Format a field value as plain text for the hover popup card. */
function formatPopupVal(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (isReconciledValue(v)) return (v as ReconciliationResult).label ?? String(v)
  if (Array.isArray(v)) {
    if (v.length > 0 && isReconciledValue(v[0]))
      return (v as ReconciliationResult[]).map(r => r.label ?? '').filter(Boolean).join(', ')
    return v.filter(x => x != null).join(', ')
  }
  if (typeof v === 'object') return ''  // skip namespace sub-objects in popup
  const s = String(v)
  return s.length > 120 ? s.slice(0, 117) + '…' : s
}

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
    .filter(k => !(DEFAULT_COLS as readonly string[]).includes(k) && k !== '_note')
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
  if (Array.isArray(v)) {
    if (v.length > 0 && isReconciledValue(v[0])) return (v as ReconciliationResult[]).map(r => r.label ?? '').join(', ')
    return v.join(', ')
  }
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
  // F2: row selection
  selectedIds:  Set<string>
  onToggleRow:  (id: string) => void
  onToggleAll:  (ids: string[], checked: boolean) => void
  // Notes
  notes:        Record<string, string>
  onNoteChange: (recordId: string, text: string) => void
}

const DEFAULT_COL_W = 140
const CHECKBOX_COL_W = 28
const NOTES_COL_W   = 160

function RecordTable({ records, columns, page, pageSize, compact = false, sortCol, sortDir, onSort, onSelectCandidate, selectedIds, onToggleRow, onToggleAll, notes, onNoteChange }: TableProps) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null)
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null)
  const [noteEditId, setNoteEditId] = useState<string | null>(null)
  const [noteDraft,  setNoteDraft]  = useState('')
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null)

  // F1: hover popup state
  const [hovered, setHovered] = useState<{ rec: UnifiedRecord; x: number; y: number } | null>(null)

  // F2: header checkbox states
  const allChecked = records.length > 0 && records.every(r => selectedIds.has(r.id))
  const someChecked = records.some(r => selectedIds.has(r.id))

  // Clean up document listeners if the component unmounts mid-drag
  useEffect(() => () => {
    if (listenersRef.current) {
      document.removeEventListener('mousemove', listenersRef.current.move)
      document.removeEventListener('mouseup',   listenersRef.current.up)
      document.body.style.cursor = ''
    }
  }, [])

  // Auto-focus textarea when a note cell enters edit mode
  useEffect(() => {
    if (noteEditId) noteTextareaRef.current?.focus()
  }, [noteEditId])

  function openNoteEditor(recordId: string) {
    setNoteDraft(notes[recordId] ?? '')
    setNoteEditId(recordId)
  }

  function commitNote() {
    if (noteEditId !== null) {
      onNoteChange(noteEditId, noteDraft)
      setNoteEditId(null)
    }
  }

  function cancelNote() {
    setNoteEditId(null)
  }

  function startResize(e: React.MouseEvent, col: string) {
    e.preventDefault()
    e.stopPropagation()
    const startW = colWidths[col] ?? DEFAULT_COL_W
    resizingRef.current = { col, startX: e.clientX, startW }
    document.body.style.cursor = 'col-resize'

    const onMove = (mv: MouseEvent) => {
      const r = resizingRef.current
      if (!r) return
      const newW = Math.max(48, r.startW + (mv.clientX - r.startX))
      setColWidths(prev => ({ ...prev, [r.col]: newW }))
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

  // F1: fields for the popup card (only rows with a value)
  const popupFields = hovered
    ? POPUP_FIELD_ORDER
        .map(f => ({ label: f, val: formatPopupVal((hovered.rec as Record<string, unknown>)[f]) }))
        .filter(r => r.val !== '')
    : []

  return (
    <>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', minWidth: '100%', fontSize: fs }}>
        <thead>
          <tr>
            {/* F2: select-all checkbox */}
            <th style={{ ...thStyle, width: CHECKBOX_COL_W, minWidth: CHECKBOX_COL_W, maxWidth: CHECKBOX_COL_W, padding: '4px 6px', textAlign: 'center', cursor: 'default', left: 0, zIndex: 3 }}>
              <input
                type="checkbox"
                className="nodrag"
                style={{ cursor: 'pointer' }}
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                onChange={e => onToggleAll(records.map(r => r.id), e.target.checked)}
                title={allChecked ? 'Deselect all' : 'Select all (filtered)'}
              />
            </th>
            {/* Notes column */}
            <th style={{ ...thStyle, width: NOTES_COL_W, minWidth: NOTES_COL_W, maxWidth: NOTES_COL_W, padding: pad, cursor: 'default', left: CHECKBOX_COL_W, zIndex: 3, borderRight: '2px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '1px 4px' }}>
                  notes
                </span>
              </div>
            </th>
            {columns.map(col => {
              const w        = colWidths[col] ?? DEFAULT_COL_W
              const isActive = sortCol === col
              const isCore   = CORE_UNIFIED_FIELDS.has(col)
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
                    background: isActive ? '#e5e7eb' : isCore ? '#f0fdf4' : '#f3f4f6',
                  }}
                  onClick={() => onSort?.(col)}
                  title={title}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0 }}>
                      {col}
                      {isActive && (
                        <span style={{ marginLeft: 3, fontSize: '0.85em' }}>
                          {sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </span>
                    {isCore && (
                      <span style={{ flexShrink: 0, fontSize: 9, lineHeight: 1.4, fontWeight: 600, background: '#bbf7d0', color: '#15803d', borderRadius: 3, padding: '1px 4px' }}>
                        core
                      </span>
                    )}
                  </div>
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
          {rows.map((rec, i) => {
            const rowBg = selectedIds.has(rec.id) ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#f9fafb'
            return (
            <tr
              key={start + i}
              style={{ background: rowBg }}
              onMouseMove={e => setHovered({ rec, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHovered(null)}
            >
              {/* F2: per-row checkbox */}
              <td style={{ ...tdStyle, width: CHECKBOX_COL_W, maxWidth: CHECKBOX_COL_W, padding: '2px 6px', textAlign: 'center', overflow: 'visible', position: 'sticky', left: 0, zIndex: 1, background: rowBg }}>
                <input
                  type="checkbox"
                  className="nodrag"
                  style={{ cursor: 'pointer' }}
                  checked={selectedIds.has(rec.id)}
                  onChange={() => onToggleRow(rec.id)}
                />
              </td>
              {/* Notes cell */}
              <td
                className="nodrag"
                style={{ ...tdStyle, width: NOTES_COL_W, maxWidth: NOTES_COL_W, padding: '2px 4px', overflow: 'visible', whiteSpace: 'normal', verticalAlign: 'top', position: 'sticky', left: CHECKBOX_COL_W, zIndex: 1, background: rowBg, borderRight: '2px solid #e5e7eb' }}
                onClick={() => { if (noteEditId !== rec.id) openNoteEditor(rec.id) }}
              >
                {noteEditId === rec.id ? (
                  <textarea
                    ref={noteTextareaRef}
                    className="nodrag"
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    onBlur={commitNote}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { e.preventDefault(); cancelNote() }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNote() }
                    }}
                    style={{
                      width: '100%', minHeight: 48, resize: 'vertical',
                      fontSize: fs, fontFamily: 'system-ui, sans-serif',
                      border: '1px solid #f59e0b', borderRadius: 3,
                      padding: '2px 4px', outline: 'none', background: '#fffbeb',
                      color: '#1f2937', lineHeight: 1.4,
                    }}
                    title="Enter to save · Shift+Enter for new line · Escape to cancel"
                  />
                ) : (
                  <div
                    title={notes[rec.id] ? notes[rec.id] : 'Click to add a note'}
                    style={{
                      minHeight: 18, cursor: 'text',
                      color: notes[rec.id] ? '#1f2937' : '#d1d5db',
                      fontSize: fs, lineHeight: 1.4,
                      display: '-webkit-box', WebkitBoxOrient: 'vertical' as const,
                      WebkitLineClamp: 3, overflow: 'hidden',
                    }}
                  >
                    {notes[rec.id] ?? '✎'}
                  </div>
                )}
              </td>
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
            )
          })}
        </tbody>
      </table>

      {/* F1: hover summary popup — rendered into document.body to escape React Flow transforms */}
      {hovered && popupFields.length > 0 && createPortal(
        <div
          className="nodrag nowheel"
          style={{
            position:      'fixed',
            left:          Math.min(hovered.x + 18, window.innerWidth  - 270),
            top:           Math.max(8,  Math.min(hovered.y - 12, window.innerHeight - 420)),
            zIndex:        99999,
            pointerEvents: 'none',
            background:    '#1e2130',
            color:         '#e2e8f0',
            borderRadius:  8,
            boxShadow:     '0 8px 24px rgba(0,0,0,0.45)',
            padding:       '8px 10px',
            minWidth:      200,
            maxWidth:      260,
            fontSize:      11,
            fontFamily:    'system-ui, sans-serif',
            lineHeight:    1.5,
          }}
        >
          {popupFields.map(({ label, val }) => (
            <div key={label} style={{ display: 'flex', gap: 6, borderBottom: '1px solid #2d3348', padding: '2px 0' }}>
              <span style={{ color: '#6b7280', flexShrink: 0, width: 82, textAlign: 'right', fontFamily: 'monospace', fontSize: 10 }}>
                {label}
              </span>
              <span style={{ color: '#e2e8f0', wordBreak: 'break-word', minWidth: 0 }}>
                {val}
              </span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export function TableOutputNode({ id, data, selected }: NodeProps) {
  const { records, count, status, connected, sourceCount } = useUpstreamRecords(id)
  const { updateNodeData } = useReactFlow()
  const [page,             setPage]             = useState(0)
  const [showAll,          setShowAll]          = useState(true)
  const [expandNamespaces, setExpandNamespaces] = useState(false)
  const [pageSize,         setPageSize]         = useState<number>(PAGE_SIZES[1])
  const [sortCol,          setSortCol]          = useState<string | null>(null)
  const [sortDir,          setSortDir]          = useState<'asc' | 'desc'>('asc')
  const [filterText,       setFilterText]       = useState('')
  const [notesVersion,     setNotesVersion]     = useState(0)

  useEffect(() => subscribeNotes(() => setNotesVersion(v => v + 1)), [])

  const tableWrapRef = useRef<HTMLDivElement>(null)

  // Reconciliation candidate overrides — shared with ExpandedOutputPanel via node data.
  // Key = `${recordId}::${colName}`, value = the chosen ReconciliationResult.
  const selections = ((data as Record<string, unknown>).selections ?? {}) as Record<string, ReconciliationResult>

  // F2: row selection (record IDs) — transient, not persisted to workflow file
  const rowSelectionsArr = ((data as Record<string, unknown>).rowSelections ?? []) as string[]

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

  // Inject the resolved _note into each record so it flows downstream and
  // appears in field pickers of KCL/Ollama nodes for comparison prompts.
  // Resolved = a note authored at THIS node overrides one inherited from
  // upstream (carried in the record's _note field). This is forward-only.
  const effectiveRecordsWithNotes = useMemo<UnifiedRecord[] | null>(() => {
    if (!effectiveRecords) return null
    return effectiveRecords.map(r => {
      const own = getNote(id, r.id)
      const resolved = own ?? (r._note as string | undefined)
      return resolved != null ? { ...r, _note: resolved } as UnifiedRecord : r
    })
  // notesVersion triggers recompute when any note is saved/deleted
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRecords, notesVersion, id])

  function handleSelectCandidate(recordId: string, col: string, result: ReconciliationResult) {
    updateNodeData(id, {
      selections: { ...selections, [`${recordId}::${col}`]: result },
    })
  }

  // F2: row-selection helpers
  const rowSelectionSet = useMemo(() => new Set(rowSelectionsArr), [rowSelectionsArr])

  // validSelected = IDs that still exist in the current result set
  const validSelected = useMemo(() => {
    if (!effectiveRecords) return []
    const idSet = new Set(effectiveRecords.map(r => r.id))
    return rowSelectionsArr.filter(sid => idSet.has(sid))
  }, [effectiveRecords, rowSelectionsArr])

  const handleToggleRow = (recId: string) => {
    const cur = new Set(rowSelectionsArr)
    cur.has(recId) ? cur.delete(recId) : cur.add(recId)
    updateNodeData(id, { rowSelections: [...cur] })
  }

  const handleToggleAll = (ids: string[], checked: boolean) => {
    const cur = new Set(rowSelectionsArr)
    if (checked) ids.forEach(sid => cur.add(sid))
    else ids.forEach(sid => cur.delete(sid))
    updateNodeData(id, { rowSelections: [...cur] })
  }

  const filteredRecords = useMemo<UnifiedRecord[] | null>(() => {
    if (!effectiveRecordsWithNotes) return null
    const q = filterText.trim().toLowerCase()
    if (!q) return effectiveRecordsWithNotes
    return effectiveRecordsWithNotes.filter(r =>
      Object.values(r).some(v => {
        if (v === null || v === undefined) return false
        if (isReconciledValue(v)) return (v as ReconciliationResult).label?.toLowerCase().includes(q) ?? false
        if (Array.isArray(v) && v.length > 0 && isReconciledValue(v[0])) {
          return (v as ReconciliationResult[]).some(r => r.label?.toLowerCase().includes(q))
        }
        if (typeof v === 'object' && !Array.isArray(v)) {
          return Object.values(v as Record<string, unknown>).some(
            sv => sv != null && String(sv).toLowerCase().includes(q),
          )
        }
        return String(v).toLowerCase().includes(q)
      }),
    )
  }, [effectiveRecordsWithNotes, filterText])

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
  // Sync merged (and optionally row-filtered) records into the out-of-band store
  // so downstream nodes (Map, Timeline, Export) can read them.
  // F2: when rows are selected, only those records flow downstream.
  // Fingerprint includes notesVersion so downstream re-renders when notes change.
  const prevFingerprintRef = useRef('')
  useEffect(() => {
    const recs   = effectiveRecordsWithNotes ?? []
    const selKey = Object.entries(selections).map(([k, v]) => `${k}=${v.qid}`).join(',')
    const selFp  = validSelected.join(',')
    const fp     = `${status}:${selKey}:${recs.length}:${recs[0]?.id ?? ''}:${recs[recs.length - 1]?.id ?? ''}:${selFp}:${notesVersion}`
    if (fp === prevFingerprintRef.current) return
    prevFingerprintRef.current = fp

    // F2: filter to selected rows if any are ticked; otherwise pass all
    const passRecords = validSelected.length > 0
      ? recs.filter(r => validSelected.includes(r.id))
      : recs

    const version = setNodeResults(id, passRecords as Record<string, unknown>[])
    updateNodeData(id, {
      count:          passRecords.length,
      status,
      resultsVersion: version,
    })
  }, [effectiveRecordsWithNotes, selections, validSelected, status, id, updateNodeData, notesVersion])

  // Scroll the table back to the top whenever the page or sort changes
  useEffect(() => {
    tableWrapRef.current?.scrollTo({ top: 0 })
  }, [page, sortCol, sortDir])

  const columns = effectiveRecordsWithNotes
    ? showAll
      ? allFlatColumns(effectiveRecordsWithNotes, expandNamespaces)
      : DEFAULT_COLS.filter(c => effectiveRecordsWithNotes.some(r => r[c] != null))
    : []

  const displayRecords = sortedRecords ?? effectiveRecordsWithNotes
  const totalPages = displayRecords ? Math.ceil(displayRecords.length / pageSize) : 0
  const selectionCount = Object.keys(selections).length

  // Resolved notes (own override ?? inherited) keyed by record id, for display.
  const currentNotes = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    if (effectiveRecordsWithNotes) {
      for (const r of effectiveRecordsWithNotes) {
        if (r._note != null) m[r.id] = r._note as string
      }
    }
    return m
  }, [effectiveRecordsWithNotes])

  // Editing writes an override at THIS node; text equal to the inherited note
  // (or empty) clears the override so the inherited value shows through again.
  const handleNoteChange = (recordId: string, text: string) => {
    const rec = effectiveRecords?.find(r => r.id === recordId)
    const inherited = (rec?._note as string | undefined) ?? ''
    setNote(id, recordId, text === inherited ? '' : text)
  }

  return (
    <>
      <NodeResizer
        minWidth={520} minHeight={260} isVisible={selected}
        lineStyle={{ borderColor: '#0d9488' }}
        handleStyle={{ background: '#0d9488', borderColor: '#fff', width: 8, height: 8 }}
      />
      <div style={styles.card}>
      <Handle type="target" position={Position.Left}  id="data"    style={styles.inputHandle} />
      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />

      <div style={styles.header}>
        <span style={styles.title}>Table Output</span>
        {connected && effectiveRecordsWithNotes && (
          <span style={styles.badge}>
            {effectiveRecordsWithNotes.length} rows
            {sourceCount > 1 ? ` · ${sourceCount} sources` : ''}
          </span>
        )}
        {selectionCount > 0 && (
          <span style={{ ...styles.badge, color: '#fde68a' }}>
            {selectionCount} override{selectionCount !== 1 ? 's' : ''}
          </span>
        )}
        {/* F2: selected-rows badge */}
        {validSelected.length > 0 && (
          <span style={{ ...styles.badge, color: '#a5f3fc', display: 'flex', alignItems: 'center', gap: 2 }}>
            {validSelected.length} selected
            <button
              className="nodrag"
              style={{ background: 'none', border: 'none', color: '#a5f3fc', cursor: 'pointer', padding: '0 0 0 3px', fontSize: 12, lineHeight: 1 }}
              onClick={() => updateNodeData(id, { rowSelections: [] })}
              title="Clear row selection (all rows will pass downstream)"
            >
              ×
            </button>
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

      {connected && !effectiveRecordsWithNotes && status !== 'loading' && (
        <div style={styles.placeholder}>Run the upstream node to see results</div>
      )}

      {connected && effectiveRecordsWithNotes && effectiveRecordsWithNotes.length === 0 && (
        <div style={styles.placeholder}>Query returned 0 results</div>
      )}

      {connected && effectiveRecordsWithNotes && effectiveRecordsWithNotes.length > 0 && (
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
              selectedIds={rowSelectionSet}
              onToggleRow={handleToggleRow}
              onToggleAll={handleToggleAll}
              notes={currentNotes}
              onNoteChange={handleNoteChange}
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
    </>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '1.5px solid #d1d5db',
    borderRadius: 8,
    width: '100%',
    height: '100%',
    minWidth: 520,
    minHeight: 260,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
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
    flex: 1,
    minHeight: 0,
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
  // zIndex: 2 so sticky headers clear frozen body cells (zIndex: 1) on vertical scroll;
  // frozen header corner cells use zIndex: 3 to sit above both.
  zIndex:       2,
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
