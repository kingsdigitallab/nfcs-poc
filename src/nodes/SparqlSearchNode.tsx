/**
 * SPARQLSearch (Experimental, alpha) — query the Wikidata Query Service and
 * map result bindings to UnifiedRecord[] (tasks SQ.1–SQ.2).
 *
 * Two modes: **Builder** (structured — instance-of picker, property filter
 * rows, output-column checkboxes; deterministically regenerates the query on
 * every change into a read-only preview) and **Raw SPARQL** (hand-edit the
 * query; any builder change overwrites it). A humanities researcher can use
 * the builder without knowing SPARQL; the raw editor is the escape hatch.
 *
 * HANDLE CONTRACT (shared shell convention, frozen): `keyword` row 0 →
 * handle id `query` at top 51 (names fixtures; in builder mode it also
 * seeds a wikibase:mwapi EntitySearch), `limit` row 1 at top 78, output
 * `results` on the right.
 *
 * Wikidata-only this pass: the runner talks to /wdqs-proxy, which adds the
 * User-Agent WDQS requires. Other SPARQL endpoints are a follow-up.
 */
import { useCallback, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { downloadAsFixture, fixtureFilename, resolveFixtureQuery } from '../utils/fixtureUtils'
import { PROPERTY_GROUPS } from '../utils/wikidataApi'
import {
  buildSparqlQuery, INSTANCE_CLASS_SUGGESTIONS,
  type SparqlBuilderFilter, type SparqlBuilderState,
} from '../utils/sparqlQueryBuilder'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type SparqlStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface SparqlSearchNodeData {
  /** Keyword seed — names fixtures; in builder mode also the mwapi EntitySearch seed. */
  inlineQuery:   string
  inlineLimit:   string
  /** KCL API key for the NL→SPARQL assist (seeded from the shared key). */
  apiKey:        string
  /** NL assist input + the explanation of the last generated query. */
  nlQuery:       string
  nlExplanation?: string
  /** The SPARQL query the runner executes (builder-generated or hand-written). */
  sparqlQuery:   string
  queryMode?:    'builder' | 'raw'
  builderInstanceOf?:    string
  builderSubclasses?:    boolean
  builderFilters?:       SparqlBuilderFilter[]
  builderColumns?:       string[]
  builderCustomColumns?: string
  /** True once the raw query was hand-edited (builder changes overwrite it). */
  builderCustom?: boolean
  useFixture?:   boolean
  status:        SparqlStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  [key: string]: unknown
}

// ── Layout (matches the BackboneSearchNode handle contract) ──────────────────

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

const WIRABLE_ROWS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'keyword', placeholder: 'optional — seeds search, names fixtures', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20', rowIndex: 1 },
] as const

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

const STATUS_BORDER: Record<SparqlStatus, string> = {
  idle: '#d1d5db', loading: '#3b82f6', success: '#22c55e', error: '#ef4444', cached: '#22c55e',
}

const STATUS_BADGE: Record<SparqlStatus, string> = {
  idle: '#9ca3af', loading: '#93c5fd', success: '#86efac', error: '#fca5a5', cached: '#86efac',
}

const PID_LIST = /^\s*(P\d+\s*(,\s*P\d+\s*)*)?$/i

function parseCustomColumns(raw: string): string[] {
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(s => /^P\d+$/.test(s))
}

// ── NL → SPARQL assist (task-SQ.3) ───────────────────────────────────────────
// Same inline KCL call pattern as SmartFilterNode.translateToFilter — the
// kclChat helper is module-private elsewhere; consolidation is a follow-up.

const KCL_CHAT     = '/kcl-proxy/v1/chat/completions'
const ASSIST_MODEL = 'arc:lite'

const ASSIST_SYSTEM = `You translate natural-language research questions into Wikidata SPARQL queries.
Respond with ONLY a JSON object: {"sparql": "<query>", "explanation": "<one plain-English sentence describing what the query finds>"}.
Rules for the query:
- SELECT DISTINCT ?item ?itemLabel ?itemDescription plus any other useful variables.
- Use wdt: property paths and wd: entities; include SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }.
- Bind coordinates (wdt:P625) as ?coords and images (wdt:P18) as ?image when relevant.
- Do NOT include a LIMIT clause — the caller appends one.
- Prefer simple, fast patterns; avoid unbounded property paths on large classes.`

async function translateToSparql(
  apiKey: string,
  request: string,
  signal: AbortSignal,
): Promise<{ sparql: string; explanation: string }> {
  const res = await fetch(KCL_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:           ASSIST_MODEL,
      stream:          false,
      temperature:     0.1,
      max_tokens:      1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ASSIST_SYSTEM },
        { role: 'user',   content: request },
      ],
    }),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const json = await res.json() as { choices?: Array<{ message?: { content?: string }; text?: string }> }
  const raw = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? ''
  // Strip markdown fences some models emit despite response_format
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned) as { sparql?: unknown; explanation?: unknown }
  if (typeof parsed.sparql !== 'string' || !parsed.sparql.trim()) throw new Error('No SPARQL in model response')
  return {
    sparql:      parsed.sparql.trim(),
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SparqlSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as SparqlSearchNodeData
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [assistBusy, setAssistBusy]   = useState(false)
  const [assistError, setAssistError] = useState('')
  const assistAbort = useRef<AbortController | null>(null)

  const mode          = d.queryMode ?? 'raw'   // factory sets 'builder'; pre-builder saves stay raw
  const instanceOf    = d.builderInstanceOf ?? ''
  const subclasses    = d.builderSubclasses ?? false
  const filters       = d.builderFilters ?? []
  const columns       = d.builderColumns ?? []
  const customColumns = d.builderCustomColumns ?? ''

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => nodeRunners.sparqlSearch(id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],
  )

  /** Apply a builder-state patch and regenerate the query in one update. */
  const regen = useCallback((patch: Record<string, unknown>) => {
    const next: SparqlBuilderState = {
      keyword:    (patch.inlineQuery          as string   | undefined) ?? d.inlineQuery,
      instanceOf: (patch.builderInstanceOf    as string   | undefined) ?? d.builderInstanceOf,
      subclasses: (patch.builderSubclasses    as boolean  | undefined) ?? d.builderSubclasses,
      filters:    (patch.builderFilters       as SparqlBuilderFilter[] | undefined) ?? d.builderFilters,
      columns: [
        ...(((patch.builderColumns as string[] | undefined) ?? d.builderColumns) ?? []),
        ...parseCustomColumns((patch.builderCustomColumns as string | undefined) ?? d.builderCustomColumns ?? ''),
      ],
    }
    updateNodeData(id, { ...patch, sparqlQuery: buildSparqlQuery(next), builderCustom: false })
  }, [id, updateNodeData, d])

  const handleAssist = useCallback(async () => {
    const request = (d.nlQuery ?? '').trim()
    const apiKey  = (d.apiKey ?? '').trim()
    if (!request) return
    if (!apiKey) { setAssistError('KCL API key required'); return }
    assistAbort.current = new AbortController()
    setAssistBusy(true)
    setAssistError('')
    try {
      const { sparql, explanation } = await translateToSparql(apiKey, request, assistAbort.current.signal)
      // Land in Raw mode — the generated query is reviewable/editable before running.
      updateNodeData(id, { sparqlQuery: sparql, nlExplanation: explanation, queryMode: 'raw', builderCustom: true })
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setAssistError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setAssistBusy(false)
    }
  }, [id, updateNodeData, d.nlQuery, d.apiKey])

  const status      = d.status ?? 'idle'
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {WIRABLE_ROWS.map(({ handleId, rowIndex }) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{
            ...styles.inputHandle,
            top: handleTop(rowIndex),
            background: isConnected(handleId) ? '#3b82f6' : '#9ca3af',
            boxShadow: `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#9ca3af'}`,
          }}
        />
      ))}

      <div style={styles.header}>
        <span style={styles.headerTitle}>⚗ SPARQL Search</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: STATUS_BADGE[status] ?? '#9ca3af' }}>
            {d.statusMessage}
          </span>
        ) : null}
      </div>

      <div style={styles.body}>
        {WIRABLE_ROWS.map(({ handleId, dataKey, label, placeholder }) => (
          <div key={handleId} style={styles.row}>
            <span style={styles.paramLabel}>{label}</span>
            {isConnected(handleId) ? (
              <span style={styles.connectedBadge}>↔ wired</span>
            ) : (
              <input
                style={styles.inlineInput}
                value={(d[dataKey] as string | undefined) ?? ''}
                onChange={e => {
                  // In builder mode the keyword feeds the mwapi seed — regenerate.
                  if (dataKey === 'inlineQuery' && mode === 'builder') regen({ inlineQuery: e.target.value })
                  else updateNodeData(id, { [dataKey]: e.target.value })
                }}
                placeholder={placeholder}
                className="nodrag"
              />
            )}
          </div>
        ))}

        {/* NL → SPARQL assist */}
        <div style={styles.row}>
          <input
            style={styles.inlineInput}
            value={d.nlQuery ?? ''}
            onChange={e => updateNodeData(id, { nlQuery: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') handleAssist() }}
            placeholder="✨ describe your query in plain English…"
            className="nodrag"
            disabled={assistBusy}
          />
          <button
            style={{ ...styles.assistBtn, opacity: assistBusy || !(d.nlQuery ?? '').trim() ? 0.5 : 1 }}
            onClick={handleAssist}
            disabled={assistBusy || !(d.nlQuery ?? '').trim()}
            className="nodrag"
            title={(d.apiKey ?? '').trim()
              ? `Generate SPARQL from your description (KCL ${ASSIST_MODEL}); lands in Raw mode for review`
              : 'Requires a KCL API key (shared from other KCL nodes)'}
          >
            {assistBusy ? '…' : '✨'}
          </button>
        </div>
        {assistError && <span style={styles.warnHint}>✗ {assistError}</span>}
        {d.nlExplanation && !assistError && (
          <span style={styles.explanation}>{d.nlExplanation}</span>
        )}

        {/* Mode tabs */}
        <div style={styles.tabRow}>
          <button
            style={{ ...styles.tab, ...(mode === 'builder' ? styles.tabActive : {}) }}
            onClick={() => updateNodeData(id, { queryMode: 'builder' })}
            className="nodrag"
          >◧ Builder</button>
          <button
            style={{ ...styles.tab, ...(mode === 'raw' ? styles.tabActive : {}) }}
            onClick={() => updateNodeData(id, { queryMode: 'raw' })}
            className="nodrag"
          >⌨ Raw SPARQL</button>
        </div>

        {mode === 'builder' && (
          <>
            {/* Find: instance-of */}
            <div style={styles.row}>
              <span style={styles.paramLabel}>find</span>
              <input
                list={`${id}-classes`}
                style={styles.inlineInput}
                value={instanceOf}
                onChange={e => regen({ builderInstanceOf: e.target.value })}
                placeholder="type Q-id or pick, e.g. Q3305213"
                className="nodrag"
              />
              <datalist id={`${id}-classes`}>
                {INSTANCE_CLASS_SUGGESTIONS.map(c => (
                  <option key={c.qid} value={c.qid}>{c.label}</option>
                ))}
              </datalist>
            </div>
            <label style={styles.checkLabel} className="nodrag">
              <input
                type="checkbox"
                checked={subclasses}
                onChange={e => regen({ builderSubclasses: e.target.checked })}
                style={{ marginRight: 5 }}
              />
              include subclasses (P31/P279*)
            </label>

            {/* Property filter rows */}
            {filters.map(f => (
              <div key={f.id} style={styles.row}>
                <select
                  style={{ ...styles.select, flex: '0 0 118px' }}
                  value={f.property}
                  onChange={e => regen({ builderFilters: filters.map(x => x.id === f.id ? { ...x, property: e.target.value } : x) })}
                  className="nodrag"
                >
                  <option value="">— property —</option>
                  {PROPERTY_GROUPS.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.properties.map(p => (
                        <option key={p.id} value={p.id}>{p.label} ({p.id})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  style={styles.inlineInput}
                  value={f.value}
                  onChange={e => regen({ builderFilters: filters.map(x => x.id === f.id ? { ...x, value: e.target.value } : x) })}
                  placeholder="Q-id (exact) or text (contains)"
                  className="nodrag"
                />
                <button
                  style={styles.removeBtn}
                  onClick={() => regen({ builderFilters: filters.filter(x => x.id !== f.id) })}
                  className="nodrag"
                  title="Remove filter"
                >✕</button>
              </div>
            ))}
            <button
              style={styles.addBtn}
              onClick={() => regen({ builderFilters: [...filters, { id: `f${Date.now()}`, property: '', value: '' }] })}
              className="nodrag"
            >+ Add property filter</button>

            {/* Output columns */}
            <button style={styles.sectionToggle} onClick={() => setColumnsOpen(o => !o)} className="nodrag">
              {columnsOpen ? '▾' : '▸'} Output columns
              {columns.length + parseCustomColumns(customColumns).length > 0 && (
                <span style={styles.countBadge}>{columns.length + parseCustomColumns(customColumns).length}</span>
              )}
            </button>
            {columnsOpen && (
              <div style={styles.columnsSection}>
                {PROPERTY_GROUPS.map(g => (
                  <div key={g.label}>
                    <div style={styles.groupLabel}>{g.label}</div>
                    <div style={styles.checkGrid}>
                      {g.properties.map(p => (
                        <label key={p.id} style={styles.checkItem} className="nodrag" title={p.id}>
                          <input
                            type="checkbox"
                            checked={columns.includes(p.id)}
                            onChange={e => regen({
                              builderColumns: e.target.checked
                                ? [...columns, p.id]
                                : columns.filter(c => c !== p.id),
                            })}
                          />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={styles.row}>
                  <span style={{ ...styles.paramLabel, width: 70 }}>custom P-ids</span>
                  <input
                    style={{
                      ...styles.inlineInput,
                      borderColor: PID_LIST.test(customColumns) ? '#d1d5db' : '#ef4444',
                    }}
                    value={customColumns}
                    onChange={e => regen({ builderCustomColumns: e.target.value })}
                    placeholder="P217, P276"
                    className="nodrag"
                  />
                </div>
              </div>
            )}

            {/* Generated query preview */}
            <span style={styles.sectionLabel}>
              Generated SPARQL{d.builderCustom ? ' (superseded by raw edits)' : ''}
            </span>
            {d.sparqlQuery ? (
              <pre style={styles.preview}>{d.sparqlQuery}</pre>
            ) : (
              <span style={styles.warnHint}>Add a type, keyword or filter — an unconstrained query would scan all of Wikidata.</span>
            )}
            <button
              style={styles.linkBtn}
              onClick={() => updateNodeData(id, { queryMode: 'raw' })}
              className="nodrag"
            >✎ Edit as raw SPARQL</button>
          </>
        )}

        {mode === 'raw' && (
          <>
            <span style={styles.sectionLabel}>SPARQL — Wikidata Query Service</span>
            <textarea
              style={styles.queryArea}
              value={d.sparqlQuery ?? ''}
              onChange={e => updateNodeData(id, { sparqlQuery: e.target.value, builderCustom: true })}
              rows={9}
              spellCheck={false}
              className="nodrag"
            />
            <span style={styles.hint}>
              Conventions: <code>?item</code> → link + QID, <code>?itemLabel</code> → title,{' '}
              <code>?itemDescription</code> → description, <code>wdt:P625</code> points → map coordinates.
              No LIMIT clause → the limit row applies.
              {d.builderCustom ? ' Switching to Builder keeps this query until a builder control changes.' : ''}
            </span>
          </>
        )}
      </div>

      <div style={styles.footer}>
        <div style={styles.fixtureControls}>
          <label style={styles.fixtureToggle} className="nodrag" title="Use pre-baked fixture from public/fixtures/ instead of live WDQS">
            <input type="checkbox" checked={!!d.useFixture} onChange={e => updateNodeData(id, { useFixture: e.target.checked })} className="nodrag" />
            <span style={{ color: d.useFixture ? '#6d28d9' : '#9ca3af' }}>📦</span>
          </label>
          {(status === 'success' || status === 'cached') && (
            <button
              style={styles.fixtureSaveBtn} className="nodrag"
              title={`Download fixture: ${fixtureFilename('sparqlSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}`}
              onClick={() => downloadAsFixture(id, 'sparqlSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}
            >💾</button>
          )}
        </div>
        <button
          style={{ ...styles.runBtn, opacity: status === 'loading' ? 0.6 : 1 }}
          onClick={handleRun}
          disabled={status === 'loading'}
          className="nodrag"
        >
          {status === 'loading' ? 'Running…' : d.useFixture ? '▶ Load fixture' : '▶  Run'}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const HEADER_COLOR  = '#4c1d95'   // violet-900
const RUN_BTN_COLOR = '#6d28d9'
const ACCENT_BG     = '#f5f3ff'
const ACCENT_BORDER = '#ddd6fe'

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 340,
    maxWidth: 400,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
  },
  header: {
    height: HEADER_H,
    background: HEADER_COLOR,
    borderRadius: '6px 6px 0 0',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 },
  statusBadge: {
    fontSize: 10, fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  body: {
    paddingTop: BODY_PAD, paddingLeft: 14, paddingRight: 10, paddingBottom: 4,
    display: 'flex', flexDirection: 'column' as const, gap: 5,
  },
  row: { display: 'flex', alignItems: 'center', gap: 6, minHeight: ROW_H - 5 },
  paramLabel: { fontSize: 11, color: '#6b7280', width: 52, flexShrink: 0, fontFamily: 'monospace' },
  inlineInput: {
    flex: 1, fontSize: 11, padding: '2px 5px',
    border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', minWidth: 0, height: 22,
  },
  select: {
    fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 4,
    outline: 'none', height: 22, background: '#fff', minWidth: 0,
  },
  connectedBadge: { fontSize: 10, color: '#3b82f6', fontStyle: 'italic' as const },
  tabRow: { display: 'flex', gap: 4, marginTop: 2 },
  tab: {
    flex: 1, fontSize: 11, fontWeight: 600, padding: '3px 8px',
    border: `1px solid ${ACCENT_BORDER}`, borderRadius: 4,
    background: '#fff', color: '#6b7280', cursor: 'pointer',
  },
  tabActive: { background: ACCENT_BG, color: HEADER_COLOR, borderColor: HEADER_COLOR },
  checkLabel: {
    display: 'flex', alignItems: 'center', fontSize: 10.5, color: '#374151',
    cursor: 'pointer', userSelect: 'none' as const,
  },
  addBtn: {
    fontSize: 10, color: HEADER_COLOR, background: 'none',
    border: `1px dashed ${ACCENT_BORDER}`, borderRadius: 4,
    padding: '2px 8px', cursor: 'pointer', textAlign: 'left' as const,
  },
  removeBtn: {
    fontSize: 10, color: '#9ca3af', background: 'none', border: 'none',
    cursor: 'pointer', padding: '0 2px', flexShrink: 0,
  },
  sectionToggle: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
    color: HEADER_COLOR, background: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`,
    borderRadius: 4, padding: '3px 8px', cursor: 'pointer', width: '100%',
    textAlign: 'left' as const, marginTop: 2,
  },
  countBadge: {
    fontSize: 10, fontWeight: 700, background: HEADER_COLOR, color: '#fff',
    borderRadius: 8, padding: '0 5px', marginLeft: 2,
  },
  columnsSection: {
    display: 'flex', flexDirection: 'column' as const, gap: 4,
    padding: '6px 6px 4px', background: ACCENT_BG, borderRadius: 4,
    border: `1px solid ${ACCENT_BORDER}`,
  },
  groupLabel: { fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  checkGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px' },
  checkItem: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#374151',
    cursor: 'pointer', userSelect: 'none' as const,
  },
  sectionLabel: { fontSize: 10, fontWeight: 600, color: HEADER_COLOR, marginTop: 2 },
  preview: {
    fontSize: 9.5, fontFamily: 'monospace', lineHeight: 1.45, margin: 0,
    padding: '4px 6px', background: '#1e1b2e', color: '#ddd6fe', borderRadius: 4,
    maxHeight: 170, overflow: 'auto', whiteSpace: 'pre' as const,
  },
  warnHint: { fontSize: 10, color: '#b45309', fontStyle: 'italic' as const },
  assistBtn: {
    fontSize: 12, background: ACCENT_BG, color: HEADER_COLOR,
    border: `1px solid ${ACCENT_BORDER}`, borderRadius: 4,
    padding: '1px 8px', height: 22, cursor: 'pointer', flexShrink: 0,
  },
  explanation: { fontSize: 10, color: '#4b5563', fontStyle: 'italic' as const, lineHeight: 1.4 },
  linkBtn: {
    fontSize: 10, color: HEADER_COLOR, background: 'none', border: 'none',
    cursor: 'pointer', padding: '1px 0', textAlign: 'left' as const,
  },
  queryArea: {
    fontSize: 10, fontFamily: 'monospace', lineHeight: 1.45,
    padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4,
    outline: 'none', resize: 'vertical' as const, minHeight: 120, whiteSpace: 'pre' as const,
    overflowX: 'auto' as const,
  },
  hint: { fontSize: 9, color: '#9ca3af', lineHeight: 1.4 },
  inputHandle: {
    width: 8, height: 8, border: '2px solid #fff',
    position: 'absolute' as const, left: -5, borderRadius: '50%',
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  fixtureControls: { display: 'flex', alignItems: 'center', gap: 4 },
  fixtureToggle: { display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', userSelect: 'none' as const, fontSize: 13 },
  fixtureSaveBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 13, color: '#6b7280', lineHeight: 1 },
  runBtn: {
    background: RUN_BTN_COLOR, color: '#fff', border: 'none', borderRadius: 5,
    padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  outputHandle: {
    width: 10, height: 10, background: '#22c55e',
    border: '2px solid #fff', boxShadow: '0 0 0 1px #22c55e',
  },
}
