/**
 * QuickNoteNode — see the full, untruncated value of any field and capture
 * a per-record note in the same view. Notes persist to the shared notesStore
 * (keyed by record.id) so they appear in TableOutputNode too.
 *
 * Mode 'note' (default): free-text note → _note field.
 * Mode 'structured': per-field form → JSON object → configurable target field (default _note).
 * Mode 'score': constrained per-criterion human score → configurable target field
 *   (default 'human_score') plus flat human_c* keys. Scores persist in node data
 *   (scoresByRecord) and are saved via the standard workflow-save mechanism.
 *
 * Display-only: no runner. Pass-through output handle injects _note / human_score
 * so they flow to downstream Export and ComparisonReport nodes.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { isReconciledValue } from '../utils/reconciliationService'
import type { ReconciliationResult } from '../utils/reconciliationService'
import { getNote, setNote, subscribeNotes } from '../store/notesStore'
import { setNodeResults } from '../store/resultsStore'

const HEADER_COLOR = '#0f766e'

export interface FieldConfig {
  key: string
  label: string
}

export interface CriterionConfig {
  key: string
  label: string
  scale: number[]
}

export interface RecordScore {
  scores: Record<string, number>
  reasons: Record<string, string>
  scoredAt: string
}

export interface QuickNoteNodeData {
  selectedField: string
  mode?: 'note' | 'structured' | 'score'
  // structured mode
  fields?: FieldConfig[]
  structuredByRecord?: Record<string, Record<string, string>>
  structuredTargetField?: string
  // score mode
  criteria?: CriterionConfig[]
  targetField?: string
  displayFields?: string[]
  scoresByRecord?: Record<string, RecordScore>
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

function parseScale(raw: string): number[] {
  return raw.split(/[\s,]+/).map(s => Number(s.trim())).filter(n => Number.isFinite(n))
}

export function QuickNoteNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const { records, connected } = useUpstreamRecords(id)
  const d = data as QuickNoteNodeData

  const mode           = d.mode ?? 'note'
  const criteria       = (d.criteria ?? [{ key: 'c1', label: 'criterion 1', scale: [0, 1, 2] }]) as CriterionConfig[]
  // Stable dep signal for the configured criterion keys — lets memos/effects recompute when
  // the rubric changes even though criteria editors only call updateNodeData({ criteria }).
  const criteriaKeyStr = criteria.map(c => `${c.key}:${c.label}`).join('|')
  const targetField    = d.targetField ?? 'human_score'
  const displayFields  = (d.displayFields ?? []) as string[]
  const scoresByRecord = (d.scoresByRecord ?? {}) as Record<string, RecordScore>

  // structured mode derived values
  const fields               = (d.fields ?? [{ key: 'place', label: 'Place' }]) as FieldConfig[]
  const structuredTargetField = d.structuredTargetField ?? '_note'
  const structuredByRecord   = (d.structuredByRecord ?? {}) as Record<string, Record<string, string>>
  // Stable dep signals — let memos/effects recompute when field schema or structured data changes.
  // structuredKeyStr is content-based so it also reacts to external clears (App.tsx Clear notes).
  const fieldsKeyStr         = fields.map(f => `${f.key}:${f.label}`).join('|')
  const structuredKeyStr     = JSON.stringify(structuredByRecord)

  // ── Core state ───────────────────────────────────────────────────────────────
  const [recordIndex,       setRecordIndex]       = useState(0)
  const [noteDraft,         setNoteDraft]         = useState('')
  const [notesVersion,      setNotesVersion]      = useState(0)
  const [scoresVersion,     setScoresVersion]     = useState(0)
  const [confirmClearAll,   setConfirmClearAll]   = useState(false)
  const [configExpanded,    setConfigExpanded]    = useState(false)
  const [reasonDrafts,      setReasonDrafts]      = useState<Record<string, string>>({})
  const [structuredDrafts,  setStructuredDrafts]  = useState<Record<string, string>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => subscribeNotes(() => setNotesVersion(v => v + 1)), [])

  // ── Derived values ───────────────────────────────────────────────────────────
  const availableFields = useMemo<string[]>(() => {
    if (!records || records.length === 0) return []
    const keys = new Set<string>()
    for (const r of records.slice(0, 20)) {
      for (const k of Object.keys(r as Record<string, unknown>)) keys.add(k)
    }
    return [...keys].sort()
  }, [records])

  const selectedField   = d.selectedField || availableFields[0] || ''
  const safeIndex       = records && records.length > 0 ? Math.min(recordIndex, records.length - 1) : 0
  const currentRecord   = records?.[safeIndex] as Record<string, unknown> | undefined
  const currentRecordId = currentRecord?.id as string | undefined

  const rawFieldValue  = currentRecord ? currentRecord[selectedField] : undefined
  const isImage        = isImageDataUrl(rawFieldValue)
  const fieldValue     = rawFieldValue != null && !isImage ? formatValue(rawFieldValue) : ''
  const inheritedNote  = (currentRecord?._note as string | undefined) ?? ''
  const currentScore   = currentRecordId ? scoresByRecord[currentRecordId] : undefined
  const currentStructured = currentRecordId ? structuredByRecord[currentRecordId] : undefined

  const recordLabel = currentRecord
    ? String(
        (currentRecord.title    as string | undefined) ||
        (currentRecord.filename as string | undefined) ||
        (currentRecord.id       as string | undefined) ||
        `Record ${safeIndex + 1}`
      )
    : ''

  // ── Note-mode sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    const own = currentRecord?.id ? getNote(id, currentRecord.id as string) : undefined
    setNoteDraft(own ?? inheritedNote)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRecord?.id, inheritedNote, notesVersion])

  // ── Score-mode reason sync ───────────────────────────────────────────────────
  useEffect(() => {
    setReasonDrafts(currentScore?.reasons ?? {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRecordId])

  // ── Structured-mode draft sync ───────────────────────────────────────────────
  useEffect(() => {
    setStructuredDrafts(currentRecordId ? (structuredByRecord[currentRecordId] ?? {}) : {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRecordId])

  // ── Commit helpers ───────────────────────────────────────────────────────────
  function commitNote() {
    if (!currentRecord?.id) return
    const rid = currentRecord.id as string
    const isGenuineNote = noteDraft.trim() !== '' && noteDraft !== inheritedNote
    setNote(id, rid, isGenuineNote ? noteDraft : '')
    // Mutual exclusion: a genuine new prose note clears this record's structured entry
    if (isGenuineNote && structuredByRecord[rid]) {
      const updated = { ...structuredByRecord }
      delete updated[rid]
      updateNodeData(id, { structuredByRecord: updated })
    }
  }

  /** Write a score entry (or delete it if nothing to save). */
  function saveScoreEntry(
    scores: Record<string, number>,
    reasons: Record<string, string>,
    preserveTimestamp = false,
  ) {
    if (!currentRecordId) return
    const existing = scoresByRecord[currentRecordId]
    const scoredAt = preserveTimestamp && existing ? existing.scoredAt : new Date().toISOString()
    const hasContent =
      Object.keys(scores).length > 0 ||
      Object.values(reasons).some(r => r.trim())
    let updated: Record<string, RecordScore>
    if (hasContent) {
      updated = { ...scoresByRecord, [currentRecordId]: { scores, reasons, scoredAt } }
    } else {
      updated = { ...scoresByRecord }
      delete updated[currentRecordId]
    }
    updateNodeData(id, { scoresByRecord: updated })
    setScoresVersion(v => v + 1)
  }

  /** Commit the current reason drafts to node data (called on blur / navigate). */
  function commitReasons() {
    if (!currentRecordId) return
    const existingScores = currentScore?.scores ?? {}
    const cleanReasons = Object.fromEntries(
      Object.entries(reasonDrafts).filter(([, v]) => v.trim())
    )
    saveScoreEntry(existingScores, cleanReasons, true)
  }

  /** Commit the current structured drafts to node data (called on blur / navigate). */
  function commitStructured() {
    if (!currentRecordId) return
    const allBlank = Object.values(structuredDrafts).every(v => !v.trim())
    const updated = { ...structuredByRecord }
    if (allBlank) {
      delete updated[currentRecordId]
    } else {
      updated[currentRecordId] = { ...structuredDrafts }
      // Mutual exclusion: a non-blank structured entry clears this record's prose note
      if (getNote(id, currentRecordId)) setNote(id, currentRecordId, '')
    }
    updateNodeData(id, { structuredByRecord: updated })
  }

  function handlePickerClick(criterionKey: string, value: number) {
    if (!currentRecordId) return
    const existingScores  = currentScore?.scores ?? {}
    const existingReasons = currentScore?.reasons ?? {}
    const newScores = { ...existingScores }
    if (newScores[criterionKey] === value) {
      delete newScores[criterionKey]   // toggle: deselect by clicking same value
    } else {
      newScores[criterionKey] = value
    }
    saveScoreEntry(newScores, existingReasons)
  }

  function clearRecordScore() {
    if (!currentRecordId) return
    const updated = { ...scoresByRecord }
    delete updated[currentRecordId]
    updateNodeData(id, { scoresByRecord: updated })
    setScoresVersion(v => v + 1)
  }

  function clearRecordStructured() {
    if (!currentRecordId) return
    const updated = { ...structuredByRecord }
    delete updated[currentRecordId]
    updateNodeData(id, { structuredByRecord: updated })
    setStructuredDrafts({})
  }

  /** Clear ALL per-record scores on this node (scoped to this node's data only). */
  function clearAllScores() {
    updateNodeData(id, { scoresByRecord: {} })
    setScoresVersion(v => v + 1)
  }

  function navigateTo(newIndex: number) {
    commitNote()
    commitReasons()
    commitStructured()
    setRecordIndex(newIndex)
  }

  // ── Criteria config helpers ──────────────────────────────────────────────────
  function updateCriterion(idx: number, patch: Partial<CriterionConfig>) {
    updateNodeData(id, { criteria: criteria.map((c, i) => i === idx ? { ...c, ...patch } : c) })
  }
  function addCriterion() {
    const n = criteria.length + 1
    updateNodeData(id, { criteria: [...criteria, { key: `c${n}`, label: `criterion ${n}`, scale: [0, 1, 2] }] })
  }
  function removeCriterion(idx: number) {
    updateNodeData(id, { criteria: criteria.filter((_, i) => i !== idx) })
  }

  // ── Fields config helpers (structured mode) ──────────────────────────────────
  function updateField(idx: number, patch: Partial<FieldConfig>) {
    updateNodeData(id, { fields: fields.map((f, i) => i === idx ? { ...f, ...patch } : f) })
  }
  function addField() {
    const n = fields.length + 1
    updateNodeData(id, { fields: [...fields, { key: `field${n}`, label: `Field ${n}` }] })
  }
  function removeField(idx: number) {
    updateNodeData(id, { fields: fields.filter((_, i) => i !== idx) })
  }

  // ── Pass-through: inject _note and/or scores into downstream records.
  // _note authority is per-record and mode-independent: structured entry wins over prose over
  // inherited. A recordset can hold a mix of formats — most-recent-wins is enforced at commit time.
  // Score injection (separate target field) stays gated by mode === 'score'.
  // Unannotated records: the injected field is ABSENT (not zero/empty).
  const effectiveRecordsWithNotes = useMemo(() => {
    if (!records) return null
    // Read from `data` directly inside the memo to avoid stale closures —
    // structuredKeyStr in deps guarantees recomputation on every change, including external clears.
    const sbr     = ((data as QuickNoteNodeData).scoresByRecord    ?? {}) as Record<string, RecordScore>
    const strec   = ((data as QuickNoteNodeData).structuredByRecord ?? {}) as Record<string, Record<string, string>>
    const tf      = (data as QuickNoteNodeData).targetField          ?? 'human_score'
    const stf     = (data as QuickNoteNodeData).structuredTargetField ?? '_note'
    const m       = (data as QuickNoteNodeData).mode ?? 'note'
    const cfgFields = ((data as QuickNoteNodeData).fields ?? []) as FieldConfig[]

    return records.map(r => {
      const rid = (r as Record<string, unknown>).id as string
      // Per-record _note resolution: structured entry wins over prose over inherited.
      // Decoupled from the node's display mode — any record can hold either format,
      // and a recordset can freely mix both.
      const stored = strec[rid]
      let withNote: Record<string, unknown>
      if (stored && cfgFields.length > 0) {
        const obj: Record<string, string> = {}
        for (const f of cfgFields) obj[f.key] = stored[f.key] ?? ''
        withNote = { ...(r as Record<string, unknown>), [stf]: JSON.stringify(obj, null, 2) }
      } else {
        const ownNote  = getNote(id, rid)
        const resolved = ownNote ?? ((r as Record<string, unknown>)._note as string | undefined)
        withNote = resolved != null
          ? { ...(r as Record<string, unknown>), _note: resolved }
          : { ...(r as Record<string, unknown>) }
      }

      if (m === 'score') {
        const storedScore = sbr[rid]
        if (storedScore) {
          // Filter to only currently-configured criterion keys (non-destructive: scoresByRecord
          // is left intact so re-adding a criterion restores its values).
          const configuredCriteria = (((data as QuickNoteNodeData).criteria ?? []) as CriterionConfig[])
          const allowed    = new Set(configuredCriteria.map(c => c.key))
          const labelByKey = new Map(configuredCriteria.map(c => [c.key, c.label]))
          const scores: Record<string, number> = {}
          for (const [k, v] of Object.entries(storedScore.scores)) {
            if (allowed.has(k)) scores[k] = v
          }
          if (Object.keys(scores).length > 0) {
            const reasons: Record<string, string> = {}
            for (const [k, v] of Object.entries(storedScore.reasons ?? {})) {
              if (allowed.has(k)) reasons[k] = v
            }
            // Emit labels for scored keys so downstream nodes can show human-readable names
            const labels: Record<string, string> = {}
            for (const k of Object.keys(scores)) {
              const lbl = labelByKey.get(k)
              if (lbl) labels[k] = lbl
            }
            const flatKeys: Record<string, number> = {}
            for (const [k, v] of Object.entries(scores)) flatKeys[`human_${k}`] = v
            const scoped = { ...storedScore, scores, reasons, labels }
            return { ...withNote, [tf]: scoped, ...flatKeys }
          }
        }
      }

      return withNote
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, notesVersion, scoresVersion, structuredKeyStr, criteriaKeyStr, fieldsKeyStr, id])

  const prevFingerprintRef = useRef('')
  useEffect(() => {
    const recs    = effectiveRecordsWithNotes ?? []
    const firstId = (recs[0]  as Record<string, unknown> | undefined)?.id ?? ''
    const lastId  = (recs[recs.length - 1] as Record<string, unknown> | undefined)?.id ?? ''
    const fp      = `${recs.length}:${firstId}:${lastId}:${notesVersion}:${scoresVersion}:${structuredKeyStr}:${criteriaKeyStr}:${fieldsKeyStr}`
    if (fp === prevFingerprintRef.current) return
    prevFingerprintRef.current = fp
    const version = setNodeResults(id, recs as Record<string, unknown>[])
    updateNodeData(id, { count: recs.length, status: recs.length > 0 ? 'success' : 'idle', resultsVersion: version })
  }, [effectiveRecordsWithNotes, notesVersion, scoresVersion, structuredKeyStr, criteriaKeyStr, fieldsKeyStr, id, updateNodeData])

  // count how many fields are filled (persisted) for the structured status row
  const structuredFilledCount = currentRecordId
    ? fields.filter(f => (structuredByRecord[currentRecordId]?.[f.key] ?? '').trim()).length
    : 0

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <NodeResizer
        minWidth={320} minHeight={300} isVisible={selected}
        lineStyle={{ borderColor: HEADER_COLOR }}
        handleStyle={{ background: HEADER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      <div style={s.card}>
        <Handle type="target" position={Position.Left}  id="data"    style={s.inputHandle} />
        <Handle type="source" position={Position.Right} id="results" style={s.outputHandle} />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <span style={s.headerTitle}>Quick Note</span>
            {mode === 'structured' && <span style={s.modeBadge}>Structured</span>}
            {mode === 'score'      && <span style={s.modeBadge}>Score</span>}
          </div>
          <div style={s.headerRight}>
            {/* Note · Structured | Score  — reference modes adjacent, Score set apart */}
            <div style={s.modeToggle} className="nodrag">
              <button
                style={{ ...s.modeBtn, ...(mode === 'note' ? s.modeBtnActive : {}) }}
                onClick={() => updateNodeData(id, { mode: 'note' })}
              >Note</button>
              <button
                style={{ ...s.modeBtn, ...(mode === 'structured' ? s.modeBtnActive : {}) }}
                onClick={() => updateNodeData(id, { mode: 'structured' })}
              >Structured</button>
              <span style={s.modeSep} />
              <button
                style={{ ...s.modeBtn, ...(mode === 'score' ? s.modeBtnActive : {}) }}
                onClick={() => updateNodeData(id, { mode: 'score' })}
              >Score</button>
            </div>
            {records && records.length > 0 && (
              <div style={s.navGroup}>
                <button style={s.navBtn} className="nodrag"
                  onClick={() => navigateTo(Math.max(0, safeIndex - 1))}
                  disabled={safeIndex === 0} title="Previous record">‹</button>
                <span style={s.navLabel}>{safeIndex + 1} / {records.length}</span>
                <button style={s.navBtn} className="nodrag"
                  onClick={() => navigateTo(Math.min(records.length - 1, safeIndex + 1))}
                  disabled={safeIndex === records.length - 1} title="Next record">›</button>
              </div>
            )}
          </div>
        </div>

        {mode === 'note' ? (
          /* ── NOTE MODE (existing behaviour — unchanged) ─────────────────── */
          <>
            <div style={s.toolbar}>
              {availableFields.length > 0 ? (
                <select style={s.fieldSelect} value={selectedField} className="nodrag"
                  onChange={e => updateNodeData(id, { selectedField: e.target.value })}>
                  {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              ) : (
                <span style={s.emptyHint}>{connected ? 'Run upstream node first' : 'Connect a node'}</span>
              )}
            </div>

            {recordLabel && <div style={s.recordLabel} title={recordLabel}>{recordLabel}</div>}

            {!connected ? (
              <div style={{ ...s.contentWrap, ...s.placeholder }}>Connect a node to the input handle</div>
            ) : !records ? (
              <div style={{ ...s.contentWrap, ...s.placeholder }}>Run the upstream node to see results</div>
            ) : !selectedField ? (
              <div style={{ ...s.contentWrap, ...s.placeholder }}>No fields available</div>
            ) : isImage ? (
              <div style={{ ...s.contentWrap, ...s.placeholder }}>
                Image data — use an <strong>ImageViewNode</strong> to display it
              </div>
            ) : (
              <div style={s.contentWrap} className="nodrag nowheel">
                <pre style={s.content}>{fieldValue}</pre>
              </div>
            )}

            <div style={s.divider} />

            <div style={s.notesArea} className="nodrag">
              <div style={s.notesLabel}>
                Note
                {currentRecord && inheritedNote && noteDraft === inheritedNote && (
                  <span style={s.inheritedTag} title="This note was authored upstream; editing here creates a local override">
                    {' '}· inherited
                  </span>
                )}
                {currentRecordId && structuredByRecord[currentRecordId] && (
                  <span style={s.crossFormatTag} title="A structured note exists for this record — saving prose here will replace it">
                    {' '}· structured
                  </span>
                )}
              </div>
              <textarea
                ref={textareaRef} className="nodrag"
                value={noteDraft}
                placeholder={currentRecord ? 'Type a note for this record…' : ''}
                disabled={!currentRecord}
                onChange={e => setNoteDraft(e.target.value)}
                onBlur={commitNote}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNote(); textareaRef.current?.blur() }
                }}
                style={s.textarea}
                title="Enter to save · Shift+Enter for new line"
              />
            </div>
          </>
        ) : mode === 'structured' ? (
          /* ── STRUCTURED MODE ────────────────────────────────────────────── */
          <>
            {/* Config section — collapsible, set once */}
            <div style={s.configSection} className="nodrag">
              <button style={s.configToggleBtn} onClick={() => setConfigExpanded(v => !v)}>
                <span>{configExpanded ? '▾' : '▸'}</span>
                {' '}Configure fields
                <span style={s.configCountHint}> · {fields.length} {fields.length === 1 ? 'field' : 'fields'}</span>
              </button>
              {configExpanded && (
                <div style={s.configBody}>
                  <div style={s.configRow}>
                    <label style={s.configLabel}>Target field</label>
                    <input style={s.configInput} value={structuredTargetField} placeholder="_note"
                      onChange={e => updateNodeData(id, { structuredTargetField: e.target.value })} />
                  </div>
                  <div style={s.configRow}>
                    <label style={s.configLabel}>Display fields</label>
                    <select multiple style={{ ...s.configInput, height: 54, fontSize: 10 }}
                      value={displayFields}
                      onChange={e => updateNodeData(id, {
                        displayFields: Array.from(e.target.selectedOptions, o => o.value),
                      })}>
                      {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div style={{ ...s.configLabel, marginBottom: 4 }}>Fields
                    <span style={{ fontWeight: 400, color: '#9ca3af' }}> (key · label)</span>
                  </div>
                  {fields.map((f, idx) => (
                    <div key={idx} style={s.criterionEditRow}>
                      <input style={{ ...s.configInput, width: 60 }} value={f.key}
                        onChange={e => updateField(idx, { key: e.target.value })}
                        placeholder="key" title="Short key, e.g. place" />
                      <input style={{ ...s.configInput, flex: 1 }} value={f.label}
                        onChange={e => updateField(idx, { label: e.target.value })}
                        placeholder="label" />
                      <button style={s.removeCriterionBtn} onClick={() => removeField(idx)} title="Remove">×</button>
                    </div>
                  ))}
                  <button style={s.addCriterionBtn} onClick={addField}>+ Add field</button>
                </div>
              )}
            </div>

            {/* Context fields — read-only, scrollable */}
            {displayFields.length > 0 ? (
              <div style={s.displayFieldsArea} className="nodrag nowheel">
                {displayFields.map(f => {
                  const val = currentRecord?.[f]
                  return (
                    <div key={f} style={s.displayFieldBlock}>
                      <div style={s.displayFieldLabel}>{f}</div>
                      {isImageDataUrl(val) ? (
                        <div style={{ padding: '4px 8px', color: '#9ca3af', fontSize: 10, fontStyle: 'italic' }}>
                          Image — use ImageViewNode
                        </div>
                      ) : (
                        <pre style={s.displayFieldContent}>{val != null ? formatValue(val) : '—'}</pre>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ ...s.contentWrap, ...s.placeholder }}>
                {!connected
                  ? 'Connect a node to the input handle'
                  : !records
                  ? 'Run the upstream node to see results'
                  : 'Select display fields in ▸ Configure fields above'}
              </div>
            )}

            {recordLabel && <div style={s.recordLabel} title={recordLabel}>{recordLabel}</div>}
            <div style={s.divider} />

            {/* Entry form — one labelled input per configured field */}
            <div style={s.scoreArea} className="nodrag nowheel">
              {!connected ? (
                <div style={s.placeholder}>Connect a node to the input handle</div>
              ) : !records ? (
                <div style={s.placeholder}>Run the upstream node to see results</div>
              ) : fields.length === 0 ? (
                <div style={s.placeholder}>Add fields in the config section above</div>
              ) : (
                <>
                  {fields.map(f => (
                    <div key={f.key} style={s.structuredFieldBlock}>
                      <label style={s.structuredFieldLabel}>{f.label}</label>
                      <input
                        style={s.structuredFieldInput}
                        value={structuredDrafts[f.key] ?? ''}
                        placeholder={`Enter ${f.label.toLowerCase()}…`}
                        onChange={e => setStructuredDrafts(prev => ({ ...prev, [f.key]: e.target.value }))}
                        onBlur={commitStructured}
                        disabled={!currentRecord}
                      />
                    </div>
                  ))}
                  <div style={s.scoreStatusRow}>
                    <span style={s.scoreStatusText}>
                      {structuredFilledCount > 0
                        ? `${structuredFilledCount}/${fields.length} fields filled`
                        : 'Not yet entered'}
                      {currentRecordId && getNote(id, currentRecordId) && (
                        <span style={s.crossFormatTag} title="A prose note exists for this record — filling fields here will replace it">
                          {' '}· note
                        </span>
                      )}
                    </span>
                    {currentStructured && (
                      <button style={s.clearScoreBtn} onClick={clearRecordStructured}
                        title="Clear entries for this record only">
                        Clear
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          /* ── SCORE MODE ─────────────────────────────────────────────────── */
          <>
            {/* Config section — collapsible, set once */}
            <div style={s.configSection} className="nodrag">
              <button style={s.configToggleBtn} onClick={() => setConfigExpanded(v => !v)}>
                <span>{configExpanded ? '▾' : '▸'}</span>
                {' '}Configure criteria
                <span style={s.configCountHint}> · {criteria.length} {criteria.length === 1 ? 'criterion' : 'criteria'}</span>
              </button>
              {configExpanded && (
                <div style={s.configBody}>
                  <div style={s.configRow}>
                    <label style={s.configLabel}>Target field</label>
                    <input style={s.configInput} value={targetField} placeholder="human_score"
                      onChange={e => updateNodeData(id, { targetField: e.target.value })} />
                  </div>
                  <div style={s.configRow}>
                    <label style={s.configLabel}>Display fields</label>
                    <select multiple style={{ ...s.configInput, height: 54, fontSize: 10 }}
                      value={displayFields}
                      onChange={e => updateNodeData(id, {
                        displayFields: Array.from(e.target.selectedOptions, o => o.value),
                      })}>
                      {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div style={{ ...s.configLabel, marginBottom: 4 }}>Criteria
                    <span style={{ fontWeight: 400, color: '#9ca3af' }}> (key · label · scale)</span>
                  </div>
                  {criteria.map((c, idx) => (
                    <div key={idx} style={s.criterionEditRow}>
                      <input style={{ ...s.configInput, width: 44 }} value={c.key}
                        onChange={e => updateCriterion(idx, { key: e.target.value })}
                        placeholder="key" title="Short key, e.g. c1" />
                      <input style={{ ...s.configInput, flex: 1 }} value={c.label}
                        onChange={e => updateCriterion(idx, { label: e.target.value })}
                        placeholder="label" />
                      <input style={{ ...s.configInput, width: 56 }} value={c.scale.join(',')}
                        onChange={e => updateCriterion(idx, { scale: parseScale(e.target.value) })}
                        placeholder="0,1,2" title="Scale values, comma-separated" />
                      <button style={s.removeCriterionBtn} onClick={() => removeCriterion(idx)} title="Remove">×</button>
                    </div>
                  ))}
                  <button style={s.addCriterionBtn} onClick={addCriterion}>+ Add criterion</button>
                </div>
              )}
            </div>

            {/* Context fields — read-only, scrollable */}
            {displayFields.length > 0 ? (
              <div style={s.displayFieldsArea} className="nodrag nowheel">
                {displayFields.map(f => {
                  const val = currentRecord?.[f]
                  return (
                    <div key={f} style={s.displayFieldBlock}>
                      <div style={s.displayFieldLabel}>{f}</div>
                      {isImageDataUrl(val) ? (
                        <div style={{ padding: '4px 8px', color: '#9ca3af', fontSize: 10, fontStyle: 'italic' }}>
                          Image — use ImageViewNode
                        </div>
                      ) : (
                        <pre style={s.displayFieldContent}>{val != null ? formatValue(val) : '—'}</pre>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ ...s.contentWrap, ...s.placeholder }}>
                {!connected
                  ? 'Connect a node to the input handle'
                  : !records
                  ? 'Run the upstream node to see results'
                  : 'Select display fields in ▸ Configure criteria above'}
              </div>
            )}

            {recordLabel && <div style={s.recordLabel} title={recordLabel}>{recordLabel}</div>}
            <div style={s.divider} />

            {/* Score pickers */}
            <div style={s.scoreArea} className="nodrag nowheel">
              {!connected ? (
                <div style={s.placeholder}>Connect a node to the input handle</div>
              ) : !records ? (
                <div style={s.placeholder}>Run the upstream node to see results</div>
              ) : criteria.length === 0 ? (
                <div style={s.placeholder}>Add criteria in the config section above</div>
              ) : (
                <>
                  {criteria.map(c => {
                    const scored = currentScore?.scores[c.key]
                    return (
                      <div key={c.key} style={s.criterionScoreBlock}>
                        <div style={s.criterionHeader}>
                          <span style={s.criterionKeyTag}>{c.key}</span>
                          <span style={s.criterionLabelText}>{c.label}</span>
                        </div>
                        <div style={s.pickerRow}>
                          {c.scale.map(v => (
                            <button
                              key={v}
                              style={{ ...s.pickerBtn, ...(scored === v ? s.pickerBtnActive : {}) }}
                              onClick={() => handlePickerClick(c.key, v)}
                              title={`Score ${v}`}
                            >{v}</button>
                          ))}
                        </div>
                        <textarea
                          style={s.reasonTextarea}
                          value={reasonDrafts[c.key] ?? ''}
                          placeholder="Reason (optional)"
                          onChange={e => setReasonDrafts(prev => ({ ...prev, [c.key]: e.target.value }))}
                          onBlur={commitReasons}
                          rows={2}
                        />
                      </div>
                    )
                  })}
                  <div style={s.scoreStatusRow}>
                    <span style={s.scoreStatusText}>
                      {currentScore && Object.keys(currentScore.scores).length > 0
                        ? `Scored ${Object.keys(currentScore.scores).length}/${criteria.length} criteria`
                        : 'Not yet scored'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {currentScore && (
                        <button style={s.clearScoreBtn} onClick={clearRecordScore}
                          title="Clear scores for this record only">
                          Clear
                        </button>
                      )}
                      {Object.keys(scoresByRecord).length > 0 && (
                        <button
                          style={confirmClearAll ? s.clearAllScoresBtnConfirm : s.clearAllScoresBtn}
                          onClick={() => {
                            if (confirmClearAll) { clearAllScores(); setConfirmClearAll(false) }
                            else setConfirmClearAll(true)
                          }}
                          onBlur={() => setConfirmClearAll(false)}
                          title="Clear human scores for ALL records on this node"
                        >
                          {confirmClearAll
                            ? 'Confirm?'
                            : `Clear all (${Object.keys(scoresByRecord).length})`}
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  // ── Shared / note-mode ───────────────────────────────────────────────────────
  card: {
    background: '#fff', border: '1.5px solid #d1d5db', borderRadius: 8,
    width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  header: {
    background: HEADER_COLOR, borderRadius: '6px 6px 0 0', padding: '0 10px', height: 32,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 6 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 6 },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 12 },
  modeBadge: {
    background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 9,
    fontWeight: 700, padding: '1px 5px', borderRadius: 3, letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
  },
  modeToggle: {
    display: 'flex', gap: 1, alignItems: 'center',
    background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: 2,
  },
  modeBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.7)',
    fontSize: 10, fontWeight: 600, borderRadius: 3, padding: '2px 6px', cursor: 'pointer',
  },
  modeBtnActive: { background: 'rgba(255,255,255,0.25)', color: '#fff' },
  modeSep: {
    display: 'inline-block' as const, width: 1, height: 14,
    background: 'rgba(255,255,255,0.3)', margin: '0 2px', flexShrink: 0,
  },
  navGroup: { display: 'flex', alignItems: 'center', gap: 4 },
  navBtn: {
    background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 3,
    width: 20, height: 20, fontSize: 14, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700,
  },
  navLabel: { color: '#99f6e4', fontSize: 11, minWidth: 42, textAlign: 'center' as const, fontFamily: 'monospace' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
    borderBottom: '1px solid #f1f5f9', flexShrink: 0,
  },
  fieldSelect: {
    flex: 1, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db',
    borderRadius: 4, outline: 'none', height: 24, fontFamily: 'monospace',
  },
  emptyHint: { fontSize: 11, color: '#9ca3af', fontStyle: 'italic' as const },
  recordLabel: {
    fontSize: 11, color: '#374151', fontWeight: 600, padding: '4px 10px 2px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    borderBottom: '1px solid #f1f5f9', flexShrink: 0,
  },
  contentWrap: { overflowY: 'auto' as const, maxHeight: 280 },
  content: {
    margin: 0, padding: '10px 12px', fontSize: 11, lineHeight: 1.6,
    fontFamily: "'Consolas', 'Menlo', monospace", color: '#111827',
    whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const,
  },
  placeholder: {
    display: 'flex', alignItems: 'center', justifyContent: 'center' as const,
    padding: '20px 16px', color: '#9ca3af', fontSize: 11,
    fontStyle: 'italic' as const, textAlign: 'center' as const,
  },
  divider: { height: 1, background: '#e5e7eb', flexShrink: 0 },
  notesArea: {
    flexShrink: 0, padding: '6px 10px 8px',
    display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  notesLabel: {
    fontSize: 10, fontWeight: 600, color: '#6b7280',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  },
  inheritedTag: {
    fontWeight: 500, color: '#0f766e', fontStyle: 'italic' as const,
    textTransform: 'none' as const, letterSpacing: 'normal',
  },
  // Shown in one mode when the other format already exists for this record —
  // warns user that saving here will replace the other format (most-recent-wins safety net).
  crossFormatTag: {
    fontWeight: 500, color: '#b45309', fontStyle: 'italic' as const,
    textTransform: 'none' as const, letterSpacing: 'normal',
  },
  textarea: {
    width: '100%', minHeight: 72, resize: 'vertical' as const, fontSize: 11,
    fontFamily: 'system-ui, sans-serif', border: '1px solid #d1d5db', borderRadius: 4,
    padding: '4px 6px', outline: 'none', background: '#fffbeb', color: '#1f2937',
    lineHeight: 1.5, boxSizing: 'border-box' as const,
  },
  inputHandle: {
    width: 10, height: 10, background: HEADER_COLOR,
    border: '2px solid #fff', boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
  outputHandle: {
    width: 10, height: 10, background: '#0d9488',
    border: '2px solid #fff', boxShadow: '0 0 0 1px #0d9488',
  },

  // ── Shared: score mode + structured mode config UI ───────────────────────────
  configSection: {
    flexShrink: 0, borderBottom: '1px solid #f1f5f9',
    background: '#f8fafc',
  },
  configToggleBtn: {
    width: '100%', textAlign: 'left' as const, background: 'none', border: 'none',
    padding: '5px 10px', fontSize: 10, fontWeight: 600, color: '#374151',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
  },
  configCountHint: { color: '#9ca3af', fontWeight: 400 },
  configBody: {
    padding: '4px 10px 8px', display: 'flex', flexDirection: 'column' as const, gap: 6,
  },
  configRow: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  configLabel: {
    fontSize: 10, fontWeight: 600, color: '#6b7280',
    textTransform: 'uppercase' as const, letterSpacing: '0.04em',
  },
  configInput: {
    fontSize: 10, padding: '2px 5px', border: '1px solid #d1d5db',
    borderRadius: 3, outline: 'none', fontFamily: 'monospace',
    background: '#fff', color: '#111827',
  },
  criterionEditRow: { display: 'flex', alignItems: 'center', gap: 4 },
  removeCriterionBtn: {
    background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer',
    fontSize: 13, padding: '0 2px', lineHeight: 1, fontWeight: 700,
  },
  addCriterionBtn: {
    alignSelf: 'flex-start' as const, background: '#f0fdf4', border: '1px solid #86efac',
    color: '#15803d', fontSize: 10, fontWeight: 600, padding: '2px 8px',
    borderRadius: 3, cursor: 'pointer',
  },
  displayFieldsArea: {
    flexShrink: 0,
  },
  displayFieldBlock: { borderBottom: '1px solid #f1f5f9' },
  displayFieldLabel: {
    fontSize: 9, fontWeight: 700, color: '#9ca3af', padding: '4px 10px 0',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  },
  displayFieldContent: {
    margin: 0, padding: '2px 10px 6px', fontSize: 11, lineHeight: 1.55,
    fontFamily: 'system-ui, sans-serif', color: '#111827',
    whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const,
  },
  scoreArea: {
    flexShrink: 0,
    padding: '6px 10px 8px', display: 'flex', flexDirection: 'column' as const, gap: 8,
  },
  scoreStatusRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 2,
  },
  scoreStatusText: { fontSize: 10, color: '#9ca3af', fontStyle: 'italic' as const },
  clearScoreBtn: {
    background: 'none', border: '1px solid #fca5a5', color: '#ef4444',
    fontSize: 10, padding: '1px 7px', borderRadius: 3, cursor: 'pointer',
  },

  // ── Structured mode specific ─────────────────────────────────────────────────
  structuredFieldBlock: {
    display: 'flex', flexDirection: 'column' as const, gap: 3,
    padding: '4px 0', borderBottom: '1px solid #f3f4f6',
  },
  structuredFieldLabel: {
    fontSize: 10, fontWeight: 600, color: '#374151',
  },
  structuredFieldInput: {
    width: '100%', fontSize: 11, padding: '3px 6px', border: '1px solid #d1d5db',
    borderRadius: 4, outline: 'none', background: '#fffbeb', color: '#1f2937',
    fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' as const,
  },

  // ── Score mode specific ───────────────────────────────────────────────────────
  criterionScoreBlock: {
    display: 'flex', flexDirection: 'column' as const, gap: 4,
    padding: '4px 0', borderBottom: '1px solid #f3f4f6',
  },
  criterionHeader: { display: 'flex', alignItems: 'center', gap: 6 },
  criterionKeyTag: {
    fontSize: 9, fontWeight: 700, color: '#0f766e', background: '#f0fdfa',
    border: '1px solid #99f6e4', borderRadius: 3, padding: '1px 4px',
    fontFamily: 'monospace', textTransform: 'uppercase' as const,
  },
  criterionLabelText: { fontSize: 11, color: '#374151', fontWeight: 500 },
  pickerRow: { display: 'flex', gap: 4, flexWrap: 'wrap' as const },
  pickerBtn: {
    background: '#f9fafb', border: '1.5px solid #d1d5db', color: '#374151',
    fontSize: 12, fontWeight: 700, width: 32, height: 28, borderRadius: 4,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, fontFamily: 'monospace',
  },
  pickerBtnActive: {
    background: '#0f766e', border: '1.5px solid #0f766e',
    color: '#fff', boxShadow: '0 0 0 2px rgba(15,118,110,0.25)',
  },
  reasonTextarea: {
    width: '100%', fontSize: 10, fontFamily: 'system-ui, sans-serif',
    border: '1px solid #e5e7eb', borderRadius: 3, padding: '3px 5px',
    outline: 'none', resize: 'vertical' as const, lineHeight: 1.4,
    color: '#374151', background: '#fafafa', boxSizing: 'border-box' as const,
  },
  clearAllScoresBtn: {
    background: '#ef4444', border: '1px solid #ef4444', color: '#fff',
    fontSize: 10, padding: '1px 7px', borderRadius: 3, cursor: 'pointer',
  },
  clearAllScoresBtnConfirm: {
    background: '#b91c1c', border: '1px solid #b91c1c', color: '#fff',
    fontSize: 10, padding: '1px 7px', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
  },
}
