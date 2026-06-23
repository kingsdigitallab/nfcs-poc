/**
 * QuickNoteNode — see the full, untruncated value of any field and capture
 * a per-record note in the same view. Notes persist to the shared notesStore
 * (keyed by record.id) so they appear in TableOutputNode too.
 *
 * Display-only: no runner. Pass-through output handle injects _note so notes
 * flow to downstream Export nodes.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { isReconciledValue } from '../utils/reconciliationService'
import type { ReconciliationResult } from '../utils/reconciliationService'
import { getNote, setNote, subscribeNotes } from '../store/notesStore'
import { setNodeResults } from '../store/resultsStore'

const HEADER_COLOR = '#0f766e'

export interface QuickNoteNodeData {
  selectedField: string
  count?: number
  status?: string
  resultsVersion?: number
  [key: string]: unknown
}

function isImageDataUrl(val: unknown): boolean {
  return typeof val === 'string' && val.startsWith('data:image/')
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (isReconciledValue(val)) {
    const r = val as { id?: string; name?: string; label?: string; qid?: string; score?: number; confidence?: number; match?: boolean }
    const label = r.label ?? r.name ?? '?'
    const id    = r.qid ?? r.id ?? ''
    const conf  = r.confidence != null ? Math.round(r.confidence * 100) : (r.score != null ? String(r.score) : '?')
    return `${label} (${id}) — ${conf}%`
  }
  if (Array.isArray(val)) {
    if (val.length > 0 && isReconciledValue(val[0])) {
      return (val as ReconciliationResult[])
        .map(r => `${r.label ?? '?'} (${r.qid ?? ''}) ${Math.round((r.confidence ?? 0) * 100)}%`)
        .join('\n')
    }
    return val.join('\n')
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

export function QuickNoteNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const { records, connected } = useUpstreamRecords(id)
  const d = data as QuickNoteNodeData

  const [recordIndex, setRecordIndex]   = useState(0)
  const [noteDraft,   setNoteDraft]     = useState('')
  const [notesVersion, setNotesVersion] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Subscribe to external note changes (e.g. typed in TableOutputNode)
  useEffect(() => subscribeNotes(() => setNotesVersion(v => v + 1)), [])

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

  // Resolve the note shown for the current record: a note authored at THIS node
  // overrides one inherited from upstream (carried in the record's _note field).
  const inheritedNote = (currentRecord?._note as string | undefined) ?? ''

  // Sync note draft from store whenever the viewed record (or its inherited
  // note) changes. Deliberately NOT keyed on notesVersion, so an edit in another
  // node doesn't reset this textarea mid-typing.
  useEffect(() => {
    const own = currentRecord?.id ? getNote(id, currentRecord.id as string) : undefined
    setNoteDraft(own ?? inheritedNote)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRecord?.id, inheritedNote])

  function commitNote() {
    if (currentRecord?.id) {
      // Only store an override if it differs from the inherited note; writing
      // text equal to the inherited value (or empty) clears the local override.
      setNote(id, currentRecord.id as string, noteDraft === inheritedNote ? '' : noteDraft)
    }
  }

  function navigateTo(newIndex: number) {
    // Commit any unsaved draft before leaving this record
    commitNote()
    setRecordIndex(newIndex)
  }

  const recordLabel = currentRecord
    ? String(
        (currentRecord.title   as string | undefined) ||
        (currentRecord.filename as string | undefined) ||
        (currentRecord.id      as string | undefined) ||
        `Record ${safeIndex + 1}`
      )
    : ''

  // ── Pass-through: inject the resolved _note and push to out-of-band store ────
  // Resolved note = own note (authored here) overrides the inherited _note that
  // flowed in from upstream. This is what propagates forward to descendants.
  const effectiveRecordsWithNotes = useMemo(() => {
    if (!records) return null
    return records.map(r => {
      const rid = (r as Record<string, unknown>).id as string
      const own = getNote(id, rid)
      const resolved = own ?? ((r as Record<string, unknown>)._note as string | undefined)
      return resolved != null ? { ...r, _note: resolved } : r
    })
  // notesVersion triggers recompute when any note is saved/deleted
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, notesVersion, id])

  const prevFingerprintRef = useRef('')
  useEffect(() => {
    const recs = effectiveRecordsWithNotes ?? []
    const fp = `${recs.length}:${(recs[0] as Record<string,unknown> | undefined)?.id ?? ''}:${(recs[recs.length - 1] as Record<string,unknown> | undefined)?.id ?? ''}:${notesVersion}`
    if (fp === prevFingerprintRef.current) return
    prevFingerprintRef.current = fp

    const version = setNodeResults(id, recs as Record<string, unknown>[])
    updateNodeData(id, {
      count:          recs.length,
      status:         recs.length > 0 ? 'success' : 'idle',
      resultsVersion: version,
    })
  }, [effectiveRecordsWithNotes, notesVersion, id, updateNodeData])

  return (
    <>
      <NodeResizer
        minWidth={320}
        minHeight={300}
        isVisible={selected}
        lineStyle={{ borderColor: HEADER_COLOR }}
        handleStyle={{ background: HEADER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />

      <div style={styles.card}>
        <Handle type="target" position={Position.Left}  id="data"    style={styles.inputHandle} />
        <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />

        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>Quick Note</span>
          {records && records.length > 0 && (
            <div style={styles.navGroup}>
              <button
                style={styles.navBtn}
                onClick={() => navigateTo(Math.max(0, safeIndex - 1))}
                disabled={safeIndex === 0}
                className="nodrag"
                title="Previous record"
              >
                ‹
              </button>
              <span style={styles.navLabel}>{safeIndex + 1} / {records.length}</span>
              <button
                style={styles.navBtn}
                onClick={() => navigateTo(Math.min(records.length - 1, safeIndex + 1))}
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
              }}
              className="nodrag"
            >
              {availableFields.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          ) : (
            <span style={styles.emptyHint}>
              {connected ? 'Run upstream node first' : 'Connect a node'}
            </span>
          )}
        </div>

        {/* Record label */}
        {recordLabel && (
          <div style={styles.recordLabel} title={recordLabel}>{recordLabel}</div>
        )}

        {/* Field content — untruncated */}
        {!connected ? (
          <div style={{ ...styles.contentWrap, ...styles.placeholder }}>Connect a node to the input handle</div>
        ) : !records ? (
          <div style={{ ...styles.contentWrap, ...styles.placeholder }}>Run the upstream node to see results</div>
        ) : !selectedField ? (
          <div style={{ ...styles.contentWrap, ...styles.placeholder }}>No fields available</div>
        ) : isImage ? (
          <div style={{ ...styles.contentWrap, ...styles.placeholder }}>
            Image data — use an <strong>ImageViewNode</strong> to display it
          </div>
        ) : (
          <div style={styles.contentWrap} className="nodrag nowheel">
            <pre style={styles.content}>{fieldValue}</pre>
          </div>
        )}

        {/* Divider */}
        <div style={styles.divider} />

        {/* Notes area */}
        <div style={styles.notesArea} className="nodrag">
          <div style={styles.notesLabel}>
            Note
            {currentRecord && inheritedNote && noteDraft === inheritedNote && (
              <span style={styles.inheritedTag} title="This note was authored upstream; editing here creates a local override">
                {' '}· inherited
              </span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            className="nodrag"
            value={noteDraft}
            placeholder={currentRecord ? 'Type a note for this record…' : ''}
            disabled={!currentRecord}
            onChange={e => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNote(); textareaRef.current?.blur() }
            }}
            style={styles.textarea}
            title="Enter to save · Shift+Enter for new line"
          />
        </div>
      </div>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background:    '#fff',
    border:        '1.5px solid #d1d5db',
    borderRadius:  8,
    width:         '100%',
    height:        '100%',
    boxShadow:     '0 1px 4px rgba(0,0,0,0.08)',
    display:       'flex',
    flexDirection: 'column' as const,
    overflow:      'hidden',
  },
  header: {
    background:     HEADER_COLOR,
    borderRadius:   '6px 6px 0 0',
    padding:        '0 10px',
    height:         32,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
    flexShrink:     0,
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
    background:     'rgba(255,255,255,0.15)',
    border:         'none',
    color:          '#fff',
    borderRadius:   3,
    width:          20,
    height:         20,
    fontSize:       14,
    lineHeight:     1,
    cursor:         'pointer',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        0,
    fontWeight:     700,
  },
  navLabel: {
    color:      '#99f6e4',
    fontSize:   11,
    minWidth:   42,
    textAlign:  'center' as const,
    fontFamily: 'monospace',
  },
  toolbar: {
    display:      'flex',
    alignItems:   'center',
    gap:          6,
    padding:      '6px 10px',
    borderBottom: '1px solid #f1f5f9',
    flexShrink:   0,
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
  emptyHint: {
    fontSize:   11,
    color:      '#9ca3af',
    fontStyle:  'italic' as const,
  },
  recordLabel: {
    fontSize:     11,
    color:        '#374151',
    fontWeight:   600,
    padding:      '4px 10px 2px',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
    borderBottom: '1px solid #f1f5f9',
    flexShrink:   0,
  },
  contentWrap: {
    flex:      1,
    overflowY: 'auto' as const,
    minHeight: 0,
  },
  content: {
    margin:     0,
    padding:    '10px 12px',
    fontSize:   11,
    lineHeight: 1.6,
    fontFamily: "'Consolas', 'Menlo', monospace",
    color:      '#111827',
    whiteSpace: 'pre-wrap' as const,
    wordBreak:  'break-word' as const,
  },
  placeholder: {
    display:    'flex',
    alignItems: 'center',
    justifyContent: 'center' as const,
    padding:    '20px 16px',
    color:      '#9ca3af',
    fontSize:   11,
    fontStyle:  'italic' as const,
    textAlign:  'center' as const,
  },
  divider: {
    height:     1,
    background: '#e5e7eb',
    flexShrink: 0,
  },
  notesArea: {
    flexShrink: 0,
    padding:    '6px 10px 8px',
    display:    'flex',
    flexDirection: 'column' as const,
    gap:        4,
  },
  notesLabel: {
    fontSize:   10,
    fontWeight: 600,
    color:      '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  inheritedTag: {
    fontWeight:    500,
    color:         '#0f766e',
    fontStyle:     'italic' as const,
    textTransform: 'none' as const,
    letterSpacing: 'normal',
  },
  textarea: {
    width:        '100%',
    minHeight:    72,
    resize:       'vertical' as const,
    fontSize:     11,
    fontFamily:   'system-ui, sans-serif',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    padding:      '4px 6px',
    outline:      'none',
    background:   '#fffbeb',
    color:        '#1f2937',
    lineHeight:   1.5,
    boxSizing:    'border-box' as const,
  },
  inputHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
  outputHandle: {
    width:     10,
    height:    10,
    background: '#0d9488',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #0d9488',
  },
}
