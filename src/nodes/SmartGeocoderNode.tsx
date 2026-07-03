import { useState, useCallback, useMemo, useEffect } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { candidateFields } from '../utils/reconciliationService'
import { getNodeResults, setNodeResults } from '../store/resultsStore'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { filterKCLModels } from '../utils/kclConfig'
import type { GeoCandidate, GeoConfirmed } from '../types/UnifiedRecord'

// ── Node data type ─────────────────────────────────────────────────────────────

export interface SmartGeocoderNodeData {
  apiKey:              string
  model:               string
  scanAllFields:       boolean
  selectedFields:      string[]
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

// ── Internal record shape with geocoding ──────────────────────────────────────

interface GeocodedRecord extends Record<string, unknown> {
  geocoding?: {
    geocoded:           string
    geocode_candidates?: GeoCandidate[]
    place_raw?:         string
    place_cleaned?:     string
    place_terms?:       string[]
    confidence?:        number
  }
}

// ── Source badge colour ────────────────────────────────────────────────────────

function sourceColor(source: string): string {
  if (source === 'tgn')      return '#7c3aed'
  if (source === 'wikidata') return '#1d4ed8'
  return '#16a34a'  // nominatim → OSM green
}

// ── Review panel ──────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  nodeId:    string
  pending:   GeocodedRecord[]
  onConfirm: (cleaned: string, choice: GeoConfirmed) => void
  onSkip:    () => void
  onFail:    (cleaned: string) => void
}

function ReviewPanel({ nodeId, pending, onConfirm, onSkip, onFail }: ReviewPanelProps) {
  const [cursor, setCursor] = useState(0)
  const current = pending[Math.min(cursor, pending.length - 1)]
  if (!current) return <div style={rev.empty}>All pending records reviewed</div>

  const geo        = current.geocoding!
  const candidates = geo.geocode_candidates ?? []
  const cleaned    = geo.place_cleaned ?? ''
  const terms      = geo.place_terms ?? []

  return (
    <div style={rev.panel} className="nodrag">
      <div style={rev.nav}>
        <button style={rev.navBtn} disabled={cursor === 0} onClick={() => setCursor(c => c - 1)}>‹</button>
        <span style={rev.navLabel}>{Math.min(cursor + 1, pending.length)} / {pending.length} pending</span>
        <button style={rev.navBtn} disabled={cursor >= pending.length - 1} onClick={() => setCursor(c => c + 1)}>›</button>
      </div>

      <div style={rev.placeRow}>
        <span style={rev.placeRaw}>{geo.place_raw}</span>
        {terms.length > 1 && (
          <span style={rev.termsList}>also: {terms.slice(1).join(', ')}</span>
        )}
      </div>

      {candidates.length === 0 ? (
        <div style={rev.noResults}>No candidates found</div>
      ) : (
        <div style={rev.candidates}>
          {candidates.map((c, i) => (
            <div key={i} style={rev.card}>
              <div style={rev.cardHeader}>
                <span style={{ ...rev.sourceBadge, background: sourceColor(c.source) }}>
                  {c.source === 'nominatim' ? 'OSM' : c.source.toUpperCase()}
                </span>
                <span style={rev.cardLabel}>{c.label}</span>
                <span style={rev.scoreBar}>
                  <span style={{ ...rev.scoreFill, width: `${Math.round(c.score * 100)}%` }} />
                </span>
                <span style={rev.scoreNum}>{Math.round(c.score * 100)}%</span>
              </div>
              {(c.placeType || c.parentLabel) && (
                <div style={rev.cardMeta}>
                  {c.placeType && <span>{c.placeType}</span>}
                  {c.parentLabel && <span> · {c.parentLabel}</span>}
                  <span style={rev.coords}> · {c.lat.toFixed(3)}, {c.lng.toFixed(3)}</span>
                </div>
              )}
              <button
                style={rev.confirmBtn}
                onClick={() => {
                  onConfirm(cleaned, { lat: c.lat, lng: c.lng, source: c.source as 'tgn' | 'wikidata', uri: c.uri, label: c.label })
                  const all = (getNodeResults(nodeId) ?? []) as GeocodedRecord[]
                  const updated = all.map(r =>
                    r.geocoding?.place_cleaned === cleaned
                      ? { ...r, decimalLatitude: c.lat, decimalLongitude: c.lng,
                          geocoding: { ...r.geocoding, geocoded: 'manual', geocode_source: c.source, geocode_uri: c.uri, confidence: c.score } }
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
        <button style={rev.skipBtn} onClick={onSkip}>Skip</button>
        <button style={rev.unresolBtn} onClick={() => {
          onFail(cleaned)
          const all = (getNodeResults(nodeId) ?? []) as GeocodedRecord[]
          const updated = all.map(r =>
            r.geocoding?.place_cleaned === cleaned
              ? { ...r, geocoding: { ...r.geocoding, geocoded: 'failed' } }
              : r,
          )
          setNodeResults(nodeId, updated)
          setCursor(cur => Math.min(cur, pending.length - 2))
        }}>✗ Unresolvable</button>
      </div>
    </div>
  )
}

// ── Confirmed choices panel ───────────────────────────────────────────────────

function ConfirmedPanel({ choices, onRemove, onClearCache }: {
  choices: Record<string, GeoConfirmed>
  onRemove: (k: string) => void
  onClearCache: () => void
}) {
  const entries = Object.entries(choices)
  if (entries.length === 0) return null
  return (
    <div style={conf.panel} className="nodrag">
      <div style={conf.headerRow}>
        <span style={conf.header}>{entries.length} confirmed</span>
        <button style={conf.cacheBtn} onClick={onClearCache}>clear cache</button>
      </div>
      <div style={conf.list}>
        {entries.map(([k, v]) => (
          <div key={k} style={conf.row}>
            <span style={{ ...conf.badge, background: sourceColor(v.source) }}>
              {v.source === 'nominatim' ? 'OSM' : v.source.toUpperCase()}
            </span>
            <span style={conf.toponym}>{k}</span>
            <span style={conf.arrow}>→</span>
            <span style={conf.choiceLabel}>{v.label}</span>
            <button style={conf.removeBtn} onClick={() => onRemove(k)}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Failed panel ──────────────────────────────────────────────────────────────

function FailedPanel({ records }: { records: GeocodedRecord[] }) {
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
      <div style={fail.header}>{records.length} failed</div>
      <div style={fail.list}>
        {unique.map((r, i) => {
          const geo   = r.geocoding!
          const raw   = geo.place_raw     ?? '(no terms extracted)'
          const terms = geo.place_terms ?? []
          return (
            <div key={i} style={fail.row}>
              <span style={fail.raw}>{raw || '—'}</span>
              {terms.length > 1 && <span style={fail.cleaned}>{terms.join(', ')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SmartGeocoderNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const d = data as SmartGeocoderNodeData

  const [models, setModels] = useState<string[]>([])
  const [apiOk, setApiOk]   = useState<boolean | null>(null)

  const { records, connected } = useUpstreamRecords(id)

  const availableFields = useMemo(
    () => (records?.length ? candidateFields(records as unknown as Record<string, unknown>[]) : []),
    [records],
  )

  // Fetch model list when API key changes
  useEffect(() => {
    const apiKey = d.apiKey ?? ''
    if (!apiKey) { setApiOk(false); setModels([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch('/kcl-proxy/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal:  AbortSignal.timeout(8_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { data?: Array<{ id: string }> }
        if (cancelled) return
        const ids = filterKCLModels((json.data ?? []).map(m => m.id)).sort()
        setModels(ids)
        setApiOk(true)
        if (!d.model || !ids.includes(d.model)) {
          updateNodeData(id, { model: ids.find(m => m === 'arc:lite') ?? ids[0] ?? '' })
        }
      } catch {
        if (!cancelled) { setApiOk(false); setModels([]) }
      }
    })()
    return () => { cancelled = true }
  }, [d.apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const pendingRecords = useMemo<GeocodedRecord[]>(() => {
    if (!d.showReviewPanel || !d.resultsVersion) return []
    return ((getNodeResults(id) ?? []) as GeocodedRecord[]).filter(r => r.geocoding?.geocoded === 'pending_review')
  }, [id, d.showReviewPanel, d.resultsVersion])

  const failedRecords = useMemo<GeocodedRecord[]>(() => {
    if (!d.showReviewPanel || !d.resultsVersion) return []
    return ((getNodeResults(id) ?? []) as GeocodedRecord[]).filter(r => r.geocoding?.geocoded === 'failed')
  }, [id, d.showReviewPanel, d.resultsVersion])

  const handleRun = useCallback(
    () => nodeRunners.smartGeocoder(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  const handleConfirm = useCallback((cleaned: string, choice: GeoConfirmed) => {
    updateNodeData(id, {
      confirmedChoices: { ...(d.confirmedChoices ?? {}), [cleaned]: choice },
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

  const handleRemoveConfirmed = useCallback((k: string) => {
    const next = { ...(d.confirmedChoices ?? {}) }
    delete next[k]
    updateNodeData(id, { confirmedChoices: next })
  }, [id, d.confirmedChoices, updateNodeData])

  const handleClearCache = useCallback(() => {
    Object.keys(localStorage).filter(k => k.startsWith('geocache:v1:')).forEach(k => localStorage.removeItem(k))
  }, [])

  const toggleField = (f: string) => {
    const cur = (d.selectedFields ?? []) as string[]
    const next = cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f]
    updateNodeData(id, { selectedFields: next })
  }

  const borderColor = STATUS_BORDER[d.status] ?? '#d1d5db'
  const hasCounts   = d.status === 'success' || d.status === 'error'
  const canRun      = d.status !== 'loading' && connected && !!d.apiKey && !!d.model

  return (
    <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      <div style={styles.header}>
        <span style={styles.headerTitle}>Smart Geocoder</span>
        {d.statusMessage
          ? <span style={styles.statusMsg}>{d.statusMessage as string}</span>
          : <span style={styles.headerSub}>LLM → place extraction → gazetteer</span>
        }
      </div>

      <div style={styles.body}>

        {/* API key — display-only, never shows the actual value */}
        <div style={styles.row}>
          <span style={styles.label}>API key</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              ...styles.input, flex: 1,
              color: d.apiKey ? '#15803d' : '#dc2626',
              background: d.apiKey ? '#f0fdf4' : '#fef2f2',
              userSelect: 'none',
            }}>
              {d.apiKey ? '🔒 Configured' : '⚠ Not set'}
            </span>
            {apiOk === true  && <span style={{ color: '#22c55e', fontSize: 13 }}>●</span>}
            {apiOk === false && <span style={{ color: '#ef4444', fontSize: 13 }}>●</span>}
          </div>
        </div>

        {/* Model picker */}
        <div style={styles.row}>
          <span style={styles.label}>model</span>
          {models.length > 0 ? (
            <select
              style={styles.select}
              value={(d.model as string) ?? ''}
              onChange={e => updateNodeData(id, { model: e.target.value })}
              className="nodrag"
            >
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <span style={styles.hint}>{d.apiKey ? 'loading models…' : 'no API key'}</span>
          )}
        </div>

        <div style={styles.divider} />

        {/* Field scanning */}
        <label style={styles.toggle} className="nodrag">
          <input
            type="checkbox"
            checked={d.scanAllFields ?? true}
            onChange={e => updateNodeData(id, { scanAllFields: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Scan all text fields automatically
        </label>

        {!(d.scanAllFields ?? true) && (
          <div style={styles.fieldGrid} className="nodrag">
            {!connected ? (
              <span style={styles.hint}>connect upstream data first</span>
            ) : availableFields.length === 0 ? (
              <span style={styles.hint}>no text fields found</span>
            ) : (
              availableFields.map(f => (
                <label key={f} style={styles.fieldCheck}>
                  <input
                    type="checkbox"
                    checked={((d.selectedFields ?? []) as string[]).includes(f)}
                    onChange={() => toggleField(f)}
                    style={{ marginRight: 4 }}
                  />
                  {f}
                </label>
              ))
            )}
          </div>
        )}

        <div style={styles.divider} />

        {/* Confidence threshold */}
        <div style={styles.row}>
          <span style={styles.label}>threshold</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={d.confidenceThreshold ?? 0.6}
            onChange={e => updateNodeData(id, { confidenceThreshold: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
            className="nodrag"
          />
          <span style={styles.sliderVal}>{((d.confidenceThreshold ?? 0.6) * 100).toFixed(0)}%</span>
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

        {/* Summary */}
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

        {/* Review — pending */}
        {d.showReviewPanel && pendingRecords.length > 0 && (
          <ReviewPanel
            nodeId={id}
            pending={pendingRecords}
            onConfirm={handleConfirm}
            onSkip={() => {/* cursor managed in panel */}}
            onFail={handleFail}
          />
        )}

        {/* Review — failed */}
        {d.showReviewPanel && failedRecords.length > 0 && (
          <FailedPanel records={failedRecords} />
        )}
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.runBtn, opacity: canRun ? 1 : 0.5 }}
          disabled={!canRun}
          onClick={handleRun}
          className="nodrag"
          title={!d.apiKey ? 'No API key configured' : !connected ? 'Connect upstream data' : ''}
        >
          {d.status === 'loading' ? 'Running…' : '▶  Run'}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#33465f'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

const styles = {
  card: {
    background: '#fff', border: '2px solid #d1d5db', borderRadius: 8,
    minWidth: 290, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const, transition: 'border-color 0.25s',
  },
  header: {
    height: 32, background: HEADER_COLOR, borderRadius: '6px 6px 0 0',
    padding: '0 10px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 8,
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 },
  headerSub:   { fontSize: 9, color: '#93c5fd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  statusMsg:   { fontSize: 10, fontWeight: 600, color: '#93c5fd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  body: {
    paddingTop: 8, paddingLeft: 12, paddingRight: 10, paddingBottom: 4,
    display: 'flex', flexDirection: 'column' as const, gap: 5,
  },
  row:      { display: 'flex', alignItems: 'center', gap: 6 },
  label:    { fontSize: 11, color: '#6b7280', width: 58, flexShrink: 0, fontFamily: 'monospace' },
  hint:     { fontSize: 10, color: '#9ca3af', fontStyle: 'italic' as const },
  input: {
    fontSize: 11, padding: '2px 5px', border: '1px solid #d1d5db',
    borderRadius: 4, outline: 'none', height: 22, background: '#fff',
  },
  select: {
    flex: 1, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db',
    borderRadius: 4, outline: 'none', height: 22, background: '#fff', minWidth: 0,
  },
  sliderVal:  { fontSize: 10, color: '#374151', width: 30, textAlign: 'right' as const },
  toggle:     { display: 'flex', alignItems: 'center', fontSize: 11, color: '#374151', cursor: 'pointer', userSelect: 'none' as const },
  divider:    { borderTop: '1px solid #f3f4f6', margin: '2px 0' },
  fieldGrid: {
    display: 'flex', flexWrap: 'wrap' as const, gap: '2px 8px',
    maxHeight: 100, overflowY: 'auto' as const, padding: '2px 0',
  },
  fieldCheck: { display: 'flex', alignItems: 'center', fontSize: 10, color: '#374151', cursor: 'pointer' },
  summary:       { display: 'flex', alignItems: 'center', gap: 5, paddingTop: 2 },
  countResolved: { fontSize: 11, fontWeight: 600, color: '#059669' },
  countPending:  { fontSize: 11, fontWeight: 600, color: '#d97706' },
  countFailed:   { fontSize: 11, fontWeight: 600, color: '#dc2626' },
  dot:           { fontSize: 11, color: '#9ca3af' },
  footer: { padding: '6px 10px 8px', display: 'flex', justifyContent: 'flex-end' },
  runBtn: {
    background: HEADER_COLOR, color: '#fff', border: 'none', borderRadius: 5,
    padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  inputHandle:  { width: 8, height: 8, border: '2px solid #fff', background: '#9ca3af', position: 'absolute' as const, left: -5, borderRadius: '50%' },
  outputHandle: { width: 10, height: 10, background: '#22c55e', border: '2px solid #fff', boxShadow: '0 0 0 1px #22c55e' },
}

// ── Review panel styles ───────────────────────────────────────────────────────

const rev = {
  panel: {
    marginTop: 4, border: '1px solid #dbeafe', borderRadius: 6,
    background: '#eff6ff', padding: '6px 8px',
    display: 'flex', flexDirection: 'column' as const, gap: 5,
  },
  nav:      { display: 'flex', alignItems: 'center', gap: 6 },
  navBtn:   { background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 13, color: '#374151' },
  navLabel: { fontSize: 11, color: '#6b7280', flex: 1, textAlign: 'center' as const },
  placeRow: { display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' as const },
  placeRaw: { fontSize: 11, fontWeight: 600, color: '#111827' },
  termsList:{ fontSize: 10, color: '#6b7280', fontStyle: 'italic' as const },
  noResults:{ fontSize: 11, color: '#9ca3af', textAlign: 'center' as const, padding: '4px 0' },
  candidates:{ display: 'flex', flexDirection: 'column' as const, gap: 4 },
  card:     { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 5, padding: '5px 7px', display: 'flex', flexDirection: 'column' as const, gap: 3 },
  cardHeader:{ display: 'flex', alignItems: 'center', gap: 5 },
  sourceBadge:{ fontSize: 9, fontWeight: 700, color: '#fff', borderRadius: 3, padding: '1px 4px', flexShrink: 0 },
  cardLabel:{ fontSize: 11, fontWeight: 600, color: '#111827', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  scoreBar: { width: 40, height: 5, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', flexShrink: 0 },
  scoreFill:{ display: 'block', height: '100%', background: '#059669', borderRadius: 3 },
  scoreNum: { fontSize: 9, color: '#6b7280', width: 26, textAlign: 'right' as const, flexShrink: 0 },
  cardMeta: { fontSize: 10, color: '#6b7280' },
  coords:   { fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' },
  confirmBtn:{ alignSelf: 'flex-start' as const, fontSize: 10, fontWeight: 600, color: '#fff', background: '#059669', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' },
  actions:  { display: 'flex', gap: 6, paddingTop: 2 },
  skipBtn:  { fontSize: 10, color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' },
  unresolBtn:{ fontSize: 10, color: '#dc2626', background: 'none', border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' },
  empty:    { fontSize: 11, color: '#059669', textAlign: 'center' as const, padding: '6px 0' },
}

const conf = {
  panel:   { marginTop: 4, border: '1px solid #e0e7ff', borderRadius: 6, background: '#f5f3ff', padding: '5px 8px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  headerRow:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  header:  { fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  cacheBtn:{ fontSize: 9, color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: 3, padding: '1px 5px', cursor: 'pointer' },
  list:    { display: 'flex', flexDirection: 'column' as const, gap: 2, maxHeight: 100, overflowY: 'auto' as const },
  row:     { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const },
  badge:   { fontSize: 8, fontWeight: 700, color: '#fff', borderRadius: 3, padding: '1px 3px', flexShrink: 0 },
  toponym: { fontSize: 10, fontWeight: 600, color: '#4338ca' },
  arrow:   { fontSize: 10, color: '#9ca3af' },
  choiceLabel:{ fontSize: 10, color: '#374151', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  removeBtn:  { fontSize: 11, fontWeight: 700, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 },
}

const fail = {
  panel: { marginTop: 4, border: '1px solid #fee2e2', borderRadius: 6, background: '#fff5f5', padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  header:{ fontSize: 10, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  list:  { display: 'flex', flexDirection: 'column' as const, gap: 2, maxHeight: 120, overflowY: 'auto' as const },
  row:   { display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' as const },
  raw:   { fontSize: 11, fontWeight: 600, color: '#991b1b' },
  cleaned:{ fontSize: 10, color: '#9ca3af', fontStyle: 'italic' as const },
}
