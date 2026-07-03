import { useState, useCallback, useMemo } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { candidateFields } from '../utils/reconciliationService'
import { getNodeResults, setNodeResults } from '../store/resultsStore'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import type { GeoCandidate, GeoConfirmed } from '../types/UnifiedRecord'

export interface GeocodingNodeData {
  placeField:          string
  confidenceThreshold: number
  passNativeCoords:    boolean
  showReviewPanel:     boolean
  confirmedChoices:    Record<string, GeoConfirmed>
  status:              'idle' | 'loading' | 'success' | 'error'
  statusMessage:       string
  resolved:            number
  pending:             number
  failed:              number
  resultsVersion?:     number
  [key: string]:       unknown
}

// ── Status colours ─────────────────────────────────────────────────────────────

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d6ccb5',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── Review panel ──────────────────────────────────────────────────────────────

interface GeocodingRecord extends Record<string, unknown> {
  geocoding?: {
    geocoded:           string
    geocode_candidates?: GeoCandidate[]
    place_raw?:         string
    place_cleaned?:     string
    confidence?:        number
  }
}

interface ReviewPanelProps {
  nodeId:  string
  pending: GeocodingRecord[]
  onConfirm: (cleaned: string, choice: GeoConfirmed) => void
  onSkip:    (idx: number) => void
  onFail:    (cleaned: string) => void
}

function ReviewPanel({ nodeId, pending, onConfirm, onSkip, onFail }: ReviewPanelProps) {
  const [cursor, setCursor] = useState(0)
  const current = pending[Math.min(cursor, pending.length - 1)]
  if (!current) return <div style={rev.empty}>All pending records reviewed</div>

  const geo        = current.geocoding!
  const candidates = geo.geocode_candidates ?? []
  const cleaned    = geo.place_cleaned ?? ''

  return (
    <div style={rev.panel} className="nodrag">
      <div style={rev.nav}>
        <button style={rev.navBtn} disabled={cursor === 0} onClick={() => setCursor(c => c - 1)}>‹</button>
        <span style={rev.navLabel}>{Math.min(cursor + 1, pending.length)} / {pending.length} pending</span>
        <button style={rev.navBtn} disabled={cursor >= pending.length - 1} onClick={() => setCursor(c => c + 1)}>›</button>
      </div>

      <div style={rev.placeRow}>
        <span style={rev.placeRaw}>{geo.place_raw}</span>
        {cleaned && cleaned !== geo.place_raw && (
          <span style={rev.placeCleaned}>→ {cleaned}</span>
        )}
      </div>

      {candidates.length === 0 ? (
        <div style={rev.noResults}>No candidates found</div>
      ) : (
        <div style={rev.candidates}>
          {candidates.map((c, i) => (
            <div key={i} style={rev.card}>
              <div style={rev.cardHeader}>
                <span style={{ ...rev.sourceBadge, background: c.source === 'tgn' ? '#7c3aed' : '#1d4ed8' }}>
                  {c.source.toUpperCase()}
                </span>
                <span style={rev.cardLabel}>{c.label}</span>
                <span style={rev.scoreBar}>
                  <span style={{ ...rev.scoreFill, width: `${Math.round(c.score * 100)}%` }} />
                </span>
                <span style={rev.scoreNum}>{Math.round(c.score * 100)}%</span>
              </div>
              <div style={rev.cardMeta}>
                {c.placeType && <span>{c.placeType}</span>}
                {c.parentLabel && <span> · {c.parentLabel}</span>}
                <span style={rev.coords}> · {c.lat.toFixed(3)}, {c.lng.toFixed(3)}</span>
              </div>
              <button
                style={rev.confirmBtn}
                onClick={() => {
                  onConfirm(cleaned, { lat: c.lat, lng: c.lng, source: c.source, uri: c.uri, label: c.label })
                  // Update record in store directly so downstream reacts immediately
                  const all = (getNodeResults(nodeId) ?? []) as GeocodingRecord[]
                  const updated = all.map(r =>
                    r.geocoding?.place_cleaned === cleaned
                      ? {
                          ...r,
                          decimalLatitude:  c.lat,
                          decimalLongitude: c.lng,
                          geocoding: { ...r.geocoding, geocoded: 'manual', geocode_source: c.source, geocode_uri: c.uri, confidence: c.score },
                        }
                      : r,
                  )
                  setNodeResults(nodeId, updated)
                  setCursor(cur => Math.min(cur, pending.length - 2))
                }}
              >
                ✓ Confirm
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={rev.actions}>
        <button style={rev.skipBtn}    onClick={() => onSkip(cursor)}>Skip</button>
        <button style={rev.unresolBtn} onClick={() => {
          onFail(cleaned)
          const all = (getNodeResults(nodeId) ?? []) as GeocodingRecord[]
          const updated = all.map(r =>
            r.geocoding?.place_cleaned === cleaned
              ? { ...r, geocoding: { ...r.geocoding, geocoded: 'failed' } }
              : r,
          )
          setNodeResults(nodeId, updated)
          setCursor(cur => Math.min(cur, pending.length - 2))
        }}>
          ✗ Unresolvable
        </button>
      </div>
    </div>
  )
}

// ── Confirmed choices panel ───────────────────────────────────────────────────

interface ConfirmedPanelProps {
  choices:   Record<string, GeoConfirmed>
  onRemove:  (cleaned: string) => void
  onClearCache: () => void
}

function ConfirmedPanel({ choices, onRemove, onClearCache }: ConfirmedPanelProps) {
  const entries = Object.entries(choices)
  if (entries.length === 0) return null

  return (
    <div style={conf.panel} className="nodrag">
      <div style={conf.headerRow}>
        <span style={conf.header}>{entries.length} confirmed</span>
        <button style={conf.cacheBtn} onClick={onClearCache} title="Remove all cached gazetteer lookups — forces re-query on next run">
          clear cache
        </button>
      </div>
      <div style={conf.list}>
        {entries.map(([cleaned, choice]) => (
          <div key={cleaned} style={conf.row}>
            <span style={{ ...conf.badge, background: choice.source === 'tgn' ? '#7c3aed' : '#1d4ed8' }}>
              {choice.source.toUpperCase()}
            </span>
            <span style={conf.toponym}>{cleaned}</span>
            <span style={conf.arrow}>→</span>
            <span style={conf.choiceLabel}>{choice.label}</span>
            <button style={conf.removeBtn} onClick={() => onRemove(cleaned)} title="Remove confirmation — toponym will be re-evaluated on next run">
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Failed panel ──────────────────────────────────────────────────────────────

function FailedPanel({ records }: { records: GeocodingRecord[] }) {
  // Deduplicate by cleaned toponym so we show one row per unique place searched
  const unique = useMemo(() => {
    const seen = new Set<string>()
    return records.filter(r => {
      const key = r.geocoding?.place_cleaned ?? r.geocoding?.place_raw ?? ''
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [records])

  return (
    <div style={fail.panel} className="nodrag">
      <div style={fail.header}>
        {records.length} failed — no gazetteer match
      </div>
      <div style={fail.list}>
        {unique.map((r, i) => {
          const geo = r.geocoding!
          const raw     = geo.place_raw     ?? ''
          const cleaned = geo.place_cleaned ?? ''
          return (
            <div key={i} style={fail.row}>
              <span style={fail.raw}>{raw}</span>
              {cleaned && cleaned !== raw && (
                <span style={fail.cleaned}>→ {cleaned}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function GeocodingNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const d = data as GeocodingNodeData

  const { records, connected } = useUpstreamRecords(id)

  const availableFields = useMemo(
    () => (records?.length ? candidateFields(records as unknown as Record<string, unknown>[]) : []),
    [records],
  )

  const borderColor = STATUS_BORDER[d.status] ?? '#d6ccb5'

  // Pending and failed records for review panel
  const pendingRecords = useMemo<GeocodingRecord[]>(() => {
    if (!d.showReviewPanel || !d.resultsVersion) return []
    const all = (getNodeResults(id) ?? []) as GeocodingRecord[]
    return all.filter(r => r.geocoding?.geocoded === 'pending_review')
  }, [id, d.showReviewPanel, d.resultsVersion])

  const failedRecords = useMemo<GeocodingRecord[]>(() => {
    if (!d.showReviewPanel || !d.resultsVersion) return []
    const all = (getNodeResults(id) ?? []) as GeocodingRecord[]
    return all.filter(r => r.geocoding?.geocoded === 'failed')
  }, [id, d.showReviewPanel, d.resultsVersion])

  const handleRun = useCallback(
    () => nodeRunners.geocoding(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const handleConfirm = useCallback((cleaned: string, choice: GeoConfirmed) => {
    const next = { ...(d.confirmedChoices ?? {}), [cleaned]: choice }
    updateNodeData(id, {
      confirmedChoices: next,
      pending:  Math.max(0, (d.pending ?? 0) - 1),
      resolved: (d.resolved ?? 0) + 1,
      resultsVersion: (d.resultsVersion ?? 0) + 1,
    })
  }, [id, d, updateNodeData])

  const handleFail = useCallback((cleaned: string) => {
    void cleaned
    updateNodeData(id, {
      pending: Math.max(0, (d.pending ?? 0) - 1),
      failed:  (d.failed ?? 0) + 1,
      resultsVersion: (d.resultsVersion ?? 0) + 1,
    })
  }, [id, d, updateNodeData])

  const handleSkip = useCallback((_idx: number) => {
    // Skip just moves cursor in review panel — no store change
  }, [])

  const handleRemoveConfirmed = useCallback((cleaned: string) => {
    const next = { ...(d.confirmedChoices ?? {}) }
    delete next[cleaned]
    updateNodeData(id, { confirmedChoices: next })
  }, [id, d.confirmedChoices, updateNodeData])

  const handleClearCache = useCallback(() => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('geocache:v1:'))
    keys.forEach(k => localStorage.removeItem(k))
  }, [])

  const hasCounts = d.status === 'success' || d.status === 'error'

  return (
    <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      <div style={styles.header}>
        <span style={styles.headerTitle}>Geocoding</span>
        {d.statusMessage ? (
          <span style={styles.statusMsg}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      <div style={styles.body}>
        {/* Field picker */}
        <div style={styles.row}>
          <span style={styles.label}>field</span>
          {!connected ? (
            <span style={styles.hint}>waiting for upstream</span>
          ) : availableFields.length === 0 ? (
            <span style={styles.hint}>no text fields found</span>
          ) : (
            <select
              style={styles.select}
              value={d.placeField || ''}
              onChange={e => updateNodeData(id, { placeField: e.target.value })}
              className="nodrag"
            >
              <option value="">— pick field —</option>
              {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
        </div>

        {/* Confidence threshold */}
        <div style={styles.row}>
          <span style={styles.label}>threshold</span>
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={d.confidenceThreshold ?? 0.75}
            onChange={e => updateNodeData(id, { confidenceThreshold: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
            className="nodrag"
          />
          <span style={styles.sliderVal}>{((d.confidenceThreshold ?? 0.75) * 100).toFixed(0)}%</span>
        </div>

        {/* Toggles */}
        <label style={styles.toggle} className="nodrag">
          <input
            type="checkbox"
            checked={d.passNativeCoords ?? true}
            onChange={e => updateNodeData(id, { passNativeCoords: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Pass through records with native coordinates
        </label>

        <label style={styles.toggle} className="nodrag">
          <input
            type="checkbox"
            checked={d.showReviewPanel ?? true}
            onChange={e => updateNodeData(id, { showReviewPanel: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Show candidate review panel
        </label>

        {/* Summary badge */}
        {hasCounts && (
          <div style={styles.summary}>
            <span style={styles.countResolved}>{d.resolved ?? 0} resolved</span>
            <span style={styles.dot}>·</span>
            <span style={styles.countPending}>{d.pending ?? 0} pending</span>
            <span style={styles.dot}>·</span>
            <span style={styles.countFailed}>{d.failed ?? 0} failed</span>
          </div>
        )}

        {/* Confirmed choices */}
        {Object.keys(d.confirmedChoices ?? {}).length > 0 && (
          <ConfirmedPanel
            choices={d.confirmedChoices as Record<string, GeoConfirmed>}
            onRemove={handleRemoveConfirmed}
            onClearCache={handleClearCache}
          />
        )}

        {/* Review panel — pending */}
        {d.showReviewPanel && pendingRecords.length > 0 && (
          <ReviewPanel
            nodeId={id}
            pending={pendingRecords}
            onConfirm={handleConfirm}
            onSkip={handleSkip}
            onFail={handleFail}
          />
        )}

        {/* Review panel — failed (no candidates found) */}
        {d.showReviewPanel && failedRecords.length > 0 && (
          <FailedPanel records={failedRecords} />
        )}
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.runBtn, opacity: d.status === 'loading' ? 0.6 : 1 }}
          disabled={d.status === 'loading' || !d.placeField}
          onClick={handleRun}
          className="nodrag"
          title={!d.placeField ? 'Select a field first' : ''}
        >
          {d.status === 'loading' ? 'Running…' : '▶  Run'}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#2f5f57'

const styles = {
  card: {
    background:  '#fffdf7',
    border:      '2px solid #d6ccb5',
    borderRadius: 8,
    minWidth:    280,
    boxShadow:   '0 1px 4px rgba(50,42,26,0.10)',
    position:    'relative' as const,
    transition:  'border-color 0.25s',
  },
  header: {
    height:         32,
    background:     HEADER_COLOR,
    borderRadius:   '6px 6px 0 0',
    padding:        '0 10px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:             8,
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 },
  statusMsg:   { fontSize: 10, fontWeight: 600, color: '#6ee7b7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  body: {
    paddingTop: 8, paddingLeft: 14, paddingRight: 10, paddingBottom: 4,
    display: 'flex', flexDirection: 'column' as const, gap: 6,
  },
  row:    { display: 'flex', alignItems: 'center', gap: 6 },
  label:  { fontSize: 11, color: '#8a8168', width: 60, flexShrink: 0, fontFamily: 'monospace' },
  hint:   { fontSize: 10, color: '#b0a891', fontStyle: 'italic' as const },
  select: {
    flex: 1, fontSize: 11, padding: '2px 4px', border: '1px solid #d6ccb5',
    borderRadius: 4, outline: 'none', height: 22, background: '#fff', minWidth: 0,
  },
  sliderVal: { fontSize: 10, color: '#33302a', width: 30, textAlign: 'right' as const },
  toggle: {
    display: 'flex', alignItems: 'center', fontSize: 11, color: '#33302a',
    cursor: 'pointer', userSelect: 'none' as const,
  },
  summary: { display: 'flex', alignItems: 'center', gap: 5, paddingTop: 2 },
  countResolved: { fontSize: 11, fontWeight: 600, color: '#059669' },
  countPending:  { fontSize: 11, fontWeight: 600, color: '#d97706' },
  countFailed:   { fontSize: 11, fontWeight: 600, color: '#dc2626' },
  dot:           { fontSize: 11, color: '#b0a891' },
  footer: { padding: '6px 10px 8px', display: 'flex', justifyContent: 'flex-end' },
  runBtn: {
    background: HEADER_COLOR, color: '#fff', border: 'none', borderRadius: 5,
    padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  inputHandle: {
    width: 8, height: 8, border: '2px solid #fff', background: '#b0a891',
    position: 'absolute' as const, left: -5, borderRadius: '50%',
  },
  outputHandle: {
    width: 10, height: 10, background: '#22c55e',
    border: '2px solid #fff', boxShadow: '0 0 0 1px #22c55e',
  },
}

// ── Review panel styles ────────────────────────────────────────────────────────

const rev = {
  panel: {
    marginTop: 4, border: '1px solid #d1fae5', borderRadius: 6,
    background: '#f0fdf4', padding: '6px 8px', display: 'flex',
    flexDirection: 'column' as const, gap: 5,
  },
  nav: { display: 'flex', alignItems: 'center', gap: 6 },
  navBtn: {
    background: 'none', border: '1px solid #d6ccb5', borderRadius: 4,
    padding: '1px 6px', cursor: 'pointer', fontSize: 13, color: '#33302a',
  },
  navLabel: { fontSize: 11, color: '#8a8168', flex: 1, textAlign: 'center' as const },
  placeRow: { display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' as const },
  placeRaw:     { fontSize: 11, fontWeight: 600, color: '#2c2a24' },
  placeCleaned: { fontSize: 10, color: '#8a8168', fontStyle: 'italic' as const },
  noResults: { fontSize: 11, color: '#b0a891', textAlign: 'center' as const, padding: '4px 0' },
  candidates: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  card: {
    background: '#fffdf7', border: '1px solid #ece3d0', borderRadius: 5, padding: '5px 7px',
    display: 'flex', flexDirection: 'column' as const, gap: 3,
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 5 },
  sourceBadge: {
    fontSize: 9, fontWeight: 700, color: '#fff', borderRadius: 3,
    padding: '1px 4px', flexShrink: 0,
  },
  cardLabel: { fontSize: 11, fontWeight: 600, color: '#2c2a24', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  scoreBar: { width: 40, height: 5, background: '#ece3d0', borderRadius: 3, overflow: 'hidden', flexShrink: 0 },
  scoreFill: { display: 'block', height: '100%', background: '#059669', borderRadius: 3 },
  scoreNum: { fontSize: 9, color: '#8a8168', width: 26, textAlign: 'right' as const, flexShrink: 0 },
  cardMeta: { fontSize: 10, color: '#8a8168' },
  coords:   { fontSize: 10, color: '#b0a891', fontFamily: 'monospace' },
  confirmBtn: {
    alignSelf: 'flex-start' as const, fontSize: 10, fontWeight: 600,
    color: '#fff', background: '#059669', border: 'none', borderRadius: 4,
    padding: '2px 8px', cursor: 'pointer',
  },
  actions: { display: 'flex', gap: 6, paddingTop: 2 },
  skipBtn: {
    fontSize: 10, color: '#8a8168', background: 'none',
    border: '1px solid #d6ccb5', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
  },
  unresolBtn: {
    fontSize: 10, color: '#dc2626', background: 'none',
    border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
  },
  empty: { fontSize: 11, color: '#059669', textAlign: 'center' as const, padding: '6px 0' },
}

// ── Confirmed panel styles ─────────────────────────────────────────────────────

const conf = {
  panel: {
    marginTop: 4, border: '1px solid #e0e7ff', borderRadius: 6,
    background: '#f5f3ff', padding: '5px 8px',
    display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  header: { fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  cacheBtn: {
    fontSize: 9, color: '#8a8168', background: 'none',
    border: '1px solid #d6ccb5', borderRadius: 3, padding: '1px 5px', cursor: 'pointer',
  },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 2, maxHeight: 100, overflowY: 'auto' as const },
  row: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const },
  badge: {
    fontSize: 8, fontWeight: 700, color: '#fff', borderRadius: 3,
    padding: '1px 3px', flexShrink: 0,
  },
  toponym:     { fontSize: 10, fontWeight: 600, color: '#4338ca' },
  arrow:       { fontSize: 10, color: '#b0a891' },
  choiceLabel: { fontSize: 10, color: '#33302a', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  removeBtn: {
    fontSize: 11, fontWeight: 700, color: '#b0a891', background: 'none',
    border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0,
  },
}

// ── Failed panel styles ────────────────────────────────────────────────────────

const fail = {
  panel: {
    marginTop: 4, border: '1px solid #fee2e2', borderRadius: 6,
    background: '#fff5f5', padding: '6px 8px',
    display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  header: {
    fontSize: 10, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 2, maxHeight: 120, overflowY: 'auto' as const },
  row:  { display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' as const },
  raw:     { fontSize: 11, fontWeight: 600, color: '#991b1b' },
  cleaned: { fontSize: 10, color: '#b0a891', fontStyle: 'italic' as const },
}
