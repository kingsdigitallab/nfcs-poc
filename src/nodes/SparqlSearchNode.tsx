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
import { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { filterKCLModels, KCL_MODEL_IDS } from '../utils/kclConfig'
import { EntityAutocomplete, EntityOptionPopover, type EntityOption } from '../components/EntityAutocomplete'
import { groundSparqlEntities, substituteQids, type EntityCheck } from '../utils/sparqlEntityGround'
import { SPARQL_ENDPOINTS, getEndpoint } from '../utils/sparqlEndpoints'
import { downloadAsFixture, fixtureFilename, resolveFixtureQuery } from '../utils/fixtureUtils'
import { PROPERTY_GROUPS } from '../utils/wikidataApi'
import {
  buildSparqlQuery, INSTANCE_CLASS_SUGGESTIONS,
  type SparqlBuilderFilter, type SparqlBuilderState,
} from '../utils/sparqlQueryBuilder'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type SparqlStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface SparqlSearchNodeData {
  /** SPARQL endpoint id (see sparqlEndpoints.ts). Absent = Wikidata, so
   *  workflows saved before the endpoint dropdown load unchanged. */
  endpoint?:     string
  /** Keyword seed — names fixtures; in builder mode also the mwapi EntitySearch seed. */
  inlineQuery:   string
  inlineLimit:   string
  /** KCL API key for the NL→SPARQL assist (seeded from the shared key). */
  apiKey:        string
  /** NL assist input + the explanation of the last generated query. */
  nlQuery:       string
  nlExplanation?: string
  /** ARC model used for the NL→SPARQL assist (arc:nano | arc:lite | arc:nexus | arc:apex). */
  assistModel?:  string
  /** Per-entity verification report from the last NL assist run (✓/⚠/✗ rows).
   *  Cleared by builder regen — a regenerated query invalidates the report. */
  nlEntityReport?: EntityCheck[]
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

/** Curated properties as instant seed suggestions for the property search. */
const PROPERTY_SEEDS = PROPERTY_GROUPS.flatMap(g =>
  g.properties.map(p => ({ qid: p.id, label: p.label })))

function parseCustomColumns(raw: string): string[] {
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(s => /^P\d+$/.test(s))
}

// ── NL → SPARQL assist (task-SQ.3) ───────────────────────────────────────────
// Same inline KCL call pattern as SmartFilterNode.translateToFilter — the
// kclChat helper is module-private elsewhere; consolidation is a follow-up.

const KCL_CHAT     = '/kcl-proxy/v1/chat/completions'
const KCL_MODELS   = '/kcl-proxy/v1/models'
const DEFAULT_ASSIST_MODEL = 'arc:lite'

const ASSIST_SYSTEM = `You translate natural-language research questions into Wikidata SPARQL queries.
Respond with ONLY a JSON object: {"sparql": "<query>", "explanation": "<one plain-English sentence describing what the query finds>", "entities": {"<QID>": "<the real-world name you mean by that QID>"}}.
The "entities" map MUST list every wd:Q… id used in the query — it is used to verify your QIDs against Wikidata.
Rules for the query:
- SELECT DISTINCT ?item ?itemLabel ?itemDescription plus any other useful variables.
- Use ONLY these prefixes, all built into the Wikidata Query Service — NEVER invent or declare others:
  wd: wdt: p: ps: pq: rdfs: schema: skos: wikibase: bd:. (In particular there is no "desc:" prefix.)
- Get labels and descriptions ONLY from the label service — do NOT query schema:description or any "desc:" term directly:
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } automatically binds ?itemLabel and ?itemDescription.
- Classify with wdt:P31 (instance of); add wdt:P279* only when subclasses are wanted.
- Bind coordinates (wdt:P625) as ?coords and images (wdt:P18) as ?image when relevant.
- Do NOT include a LIMIT clause — the caller appends one.
- Prefer simple, fast patterns; avoid unbounded property paths on large classes.

Example — "show me all hillforts in england":
{"sparql":"SELECT DISTINCT ?item ?itemLabel ?itemDescription ?coords ?image WHERE {\\n  ?item wdt:P31 wd:Q1040131 ;\\n        wdt:P17 wd:Q21 .\\n  OPTIONAL { ?item wdt:P625 ?coords. }\\n  OPTIONAL { ?item wdt:P18 ?image. }\\n  SERVICE wikibase:label { bd:serviceParam wikibase:language \\"en\\". }\\n}","explanation":"Finds items that are hillforts (P31=Q1040131) located in England (P17=Q21), with coordinates and images where available.","entities":{"Q1040131":"hillfort","Q21":"England"}}`

async function translateToSparql(
  apiKey: string,
  model: string,
  request: string,
  signal: AbortSignal,
): Promise<{ sparql: string; explanation: string; entities: Record<string, string> }> {
  const res = await fetch(KCL_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
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
  const parsed = JSON.parse(cleaned) as { sparql?: unknown; explanation?: unknown; entities?: unknown }
  if (typeof parsed.sparql !== 'string' || !parsed.sparql.trim()) throw new Error('No SPARQL in model response')
  // Tolerant entities parse — a missing/garbled map degrades grounding to an
  // existence-only check, never blocks the query.
  const entities: Record<string, string> = {}
  if (parsed.entities && typeof parsed.entities === 'object' && !Array.isArray(parsed.entities)) {
    for (const [k, v] of Object.entries(parsed.entities as Record<string, unknown>)) {
      if (/^Q\d+$/i.test(k) && typeof v === 'string' && v.trim()) entities[k.toUpperCase()] = v.trim()
    }
  }
  return {
    sparql:      parsed.sparql.trim(),
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
    entities,
  }
}

// ── NL entity report row (✓ verified / ⚠ replaced / ✗ missing) ───────────────

function qidLink(qid: string) {
  return (
    <a
      href={`https://www.wikidata.org/wiki/${qid}`}
      target="_blank" rel="noreferrer" className="nodrag"
      style={{ fontFamily: 'monospace', color: 'inherit' }}
    >{qid}</a>
  )
}

function EntityReportRow({ check, onPickAlternate }: {
  check: EntityCheck
  onPickAlternate: (check: EntityCheck, opt: EntityOption) => void
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState({ left: 0, bottom: 0, width: 0 })

  const hasAlternates = (check.alternates?.length ?? 0) > 0

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!hasAlternates) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setRect({ left: r.left, bottom: r.bottom, width: r.width })
    setOpen(o => !o)
  }

  const base: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, display: 'block' }

  if (check.status === 'ok') {
    return (
      <span style={{ ...base, color: '#15803d' }}>
        ✓ {qidLink(check.qid)} {check.actualLabel}
        {check.declaredName && check.declaredName.toLowerCase() !== (check.actualLabel ?? '').toLowerCase()
          ? <span style={{ color: '#6b7280' }}> (for “{check.declaredName}”)</span> : null}
      </span>
    )
  }

  if (check.status === 'replaced') {
    return (
      <>
        <span
          style={{ ...base, color: '#b45309', cursor: hasAlternates ? 'pointer' : 'default' }}
          onClick={openPicker}
          className="nodrag"
          title={hasAlternates ? 'Click to choose a different entity' : undefined}
        >
          ⚠ {qidLink(check.qid)}{check.actualLabel ? ` “${check.actualLabel}”` : ' (no such entity)'} → {' '}
          {qidLink(check.activeQid)} {check.replacedWith?.label}
          {check.declaredName ? <span style={{ color: '#6b7280' }}> (from “{check.declaredName}”)</span> : null}
          {hasAlternates && <span style={{ opacity: 0.6 }}> ▾</span>}
        </span>
        {open && (
          <EntityOptionPopover
            anchorRect={rect}
            options={(check.alternates ?? []).map(a => ({ qid: a.id, label: a.label, description: a.description }))}
            activeQid={check.activeQid}
            header={`Choose entity for “${check.declaredName ?? check.qid}”`}
            onPick={opt => { setOpen(false); onPickAlternate(check, opt) }}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <span style={{ ...base, color: '#ef4444' }}>
      ✗ {qidLink(check.qid)} — no such entity{check.declaredName ? ` (“${check.declaredName}”: no match found)` : ''}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SparqlSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as SparqlSearchNodeData
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [assistBusy, setAssistBusy]   = useState(false)
  const [assistError, setAssistError] = useState('')
  const [models, setModels]           = useState<string[]>([])
  const assistAbort = useRef<AbortController | null>(null)

  const assistModel = d.assistModel ?? DEFAULT_ASSIST_MODEL

  // Fetch the live ARC model list once an API key is present; fall back to the
  // static four (nano/lite/nexus/apex) when unavailable. Mirrors SmartFilter/KCLNode.
  useEffect(() => {
    const apiKey = (d.apiKey ?? '').trim()
    if (!apiKey) return
    let cancelled = false
    fetch(KCL_MODELS, { headers: { Authorization: `Bearer ${apiKey}` } })
      .then(r => r.json())
      .then((j: { data?: Array<{ id: string }> }) => {
        if (cancelled) return
        setModels(filterKCLModels(j.data?.map(m => m.id) ?? [], true))
      })
      .catch(() => { /* offline — the static fallback below covers the picker */ })
    return () => { cancelled = true }
  }, [d.apiKey])

  const modelOptions = models.length > 0 ? models : [...KCL_MODEL_IDS]

  const endpoint   = getEndpoint(d.endpoint)
  const isWikidata = endpoint.wikidataFeatures
  // Builder + NL assist are Wikidata-specific — other endpoints are raw-only.
  const mode          = isWikidata ? (d.queryMode ?? 'raw') : 'raw'   // factory sets 'builder'; pre-builder saves stay raw
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
    // Regeneration replaces the query — a stale NL entity report must not describe it.
    updateNodeData(id, { ...patch, sparqlQuery: buildSparqlQuery(next), builderCustom: false, nlEntityReport: undefined })
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
      const { sparql, explanation, entities } =
        await translateToSparql(apiKey, assistModel, request, assistAbort.current.signal)

      // Ground the model's QIDs against live Wikidata — hallucinated/mismatched
      // entities are auto-substituted and reported. Tolerant: any failure keeps
      // the raw query with no report rather than blocking the assist.
      let finalSparql = sparql
      let report: EntityCheck[] | undefined
      try {
        const grounded = await groundSparqlEntities(sparql, entities, { signal: assistAbort.current.signal })
        finalSparql = grounded.sparql
        report = grounded.report
      } catch { /* verification unavailable — keep the generated query as-is */ }

      // Land in Raw mode — the generated query is reviewable/editable before running.
      updateNodeData(id, {
        sparqlQuery:    finalSparql,
        nlExplanation:  explanation,
        nlEntityReport: report,
        queryMode:      'raw',
        builderCustom:  true,
      })
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setAssistError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setAssistBusy(false)
    }
  }, [id, updateNodeData, d.nlQuery, d.apiKey, assistModel])

  /** Switch SPARQL endpoint. Non-Wikidata endpoints run raw-only; an empty or
   *  builder-generated query is replaced by the endpoint's sample so the user
   *  isn't left pointing Wikidata-shaped SPARQL at a different vocabulary. */
  const handleEndpointChange = useCallback((endpointId: string) => {
    const next = getEndpoint(endpointId)
    const patch: Record<string, unknown> = { endpoint: endpointId, nlEntityReport: undefined }
    if (!next.wikidataFeatures) {
      patch.queryMode = 'raw'
      const keepHandWritten = d.builderCustom === true && (d.sparqlQuery ?? '').trim() !== ''
      if (!keepHandWritten && next.sampleQuery) {
        patch.sparqlQuery = next.sampleQuery
        patch.builderCustom = true
      }
    }
    updateNodeData(id, patch)
  }, [id, d.builderCustom, d.sparqlQuery, updateNodeData])

  /** Swap one report entity for a user-chosen alternate — rewrites the query
   *  text and the report entry in a single update. */
  const handlePickAlternate = useCallback((check: EntityCheck, opt: EntityOption) => {
    if (opt.qid === check.activeQid) return
    const nextQuery  = substituteQids((d.sparqlQuery ?? ''), { [check.activeQid]: opt.qid })
    const nextReport = (d.nlEntityReport ?? []).map(c => c.qid === check.qid
      ? {
          ...c,
          activeQid: opt.qid,
          // Restoring the model's original QID flips the row back to ok.
          status: (opt.qid === c.qid ? 'ok' : 'replaced') as EntityCheck['status'],
          replacedWith: opt.qid === c.qid
            ? undefined
            : { id: opt.qid, label: opt.label, description: opt.description },
        }
      : c)
    updateNodeData(id, { sparqlQuery: nextQuery, nlEntityReport: nextReport, builderCustom: true })
  }, [id, updateNodeData, d.sparqlQuery, d.nlEntityReport])

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

        {/* Endpoint selector */}
        <div style={styles.row}>
          <span style={styles.paramLabel}>endpoint</span>
          <select
            style={{ ...styles.select, flex: 1 }}
            value={endpoint.id}
            onChange={e => handleEndpointChange(e.target.value)}
            className="nodrag"
            title={endpoint.note ?? 'SPARQL service to query'}
          >
            {SPARQL_ENDPOINTS.map(ep => (
              <option key={ep.id} value={ep.id} disabled={!ep.available} title={ep.note}>
                {ep.label}{ep.available ? '' : ' (offline)'}
              </option>
            ))}
          </select>
        </div>

        {/* NL → SPARQL assist (Wikidata only — grounding + prompt are Wikidata-shaped) */}
        <div style={styles.row} title={isWikidata ? undefined : `NL assist is Wikidata-only — write raw SPARQL for ${endpoint.label}`}>
          <input
            style={{ ...styles.inlineInput, opacity: isWikidata ? 1 : 0.45 }}
            value={d.nlQuery ?? ''}
            onChange={e => updateNodeData(id, { nlQuery: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') handleAssist() }}
            placeholder="✨ describe your query in plain English…"
            className="nodrag"
            disabled={assistBusy || !isWikidata}
          />
          <select
            style={{ ...styles.select, flexShrink: 0, opacity: isWikidata ? 1 : 0.45 }}
            value={assistModel}
            onChange={e => updateNodeData(id, { assistModel: e.target.value })}
            className="nodrag"
            title="ARC model used for NL→SPARQL translation"
            disabled={assistBusy || !isWikidata}
          >
            {(modelOptions.includes(assistModel) ? modelOptions : [assistModel, ...modelOptions])
              .map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button
            style={{ ...styles.assistBtn, opacity: assistBusy || !isWikidata || !(d.nlQuery ?? '').trim() ? 0.5 : 1 }}
            onClick={handleAssist}
            disabled={assistBusy || !isWikidata || !(d.nlQuery ?? '').trim()}
            className="nodrag"
            title={!isWikidata
              ? `NL assist is Wikidata-only — write raw SPARQL for ${endpoint.label}`
              : (d.apiKey ?? '').trim()
                ? `Generate SPARQL from your description (KCL ${assistModel}); lands in Raw mode for review`
                : 'Requires a KCL API key (shared from other KCL nodes)'}
          >
            {assistBusy ? '…' : '✨'}
          </button>
        </div>
        {assistError && <span style={styles.warnHint}>✗ {assistError}</span>}
        {d.nlExplanation && !assistError && (
          <span style={styles.explanation}>{d.nlExplanation}</span>
        )}
        {!assistError && (d.nlEntityReport?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {d.nlEntityReport!.map(check => (
              <EntityReportRow key={check.qid} check={check} onPickAlternate={handlePickAlternate} />
            ))}
          </div>
        )}

        {/* Mode tabs — the Builder writes Wikidata-shaped SPARQL only */}
        <div style={styles.tabRow}>
          <button
            style={{ ...styles.tab, ...(mode === 'builder' ? styles.tabActive : {}), opacity: isWikidata ? 1 : 0.45 }}
            onClick={() => { if (isWikidata) updateNodeData(id, { queryMode: 'builder' }) }}
            disabled={!isWikidata}
            className="nodrag"
            title={isWikidata ? undefined : `The builder is Wikidata-only — use Raw SPARQL for ${endpoint.label}`}
          >◧ Builder</button>
          <button
            style={{ ...styles.tab, ...(mode === 'raw' ? styles.tabActive : {}) }}
            onClick={() => updateNodeData(id, { queryMode: 'raw' })}
            className="nodrag"
          >⌨ Raw SPARQL</button>
        </div>

        {mode === 'builder' && (
          <>
            {/* Find: instance-of — live Wikidata entity lookup */}
            <div style={styles.row}>
              <span style={styles.paramLabel}>find</span>
              <EntityAutocomplete
                value={instanceOf}
                onChange={v => regen({ builderInstanceOf: v })}
                onSelect={o => regen({ builderInstanceOf: o.qid })}
                placeholder="type a name, e.g. painting…"
                seedSuggestions={INSTANCE_CLASS_SUGGESTIONS.map(c => ({ qid: c.qid, label: c.label }))}
                emptyHint="no matching Wikidata class"
                inputStyle={styles.inlineInput}
              />
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

            {/* Property filter rows — live property search (wbsearchentities
                type=property); curated PROPERTY_GROUPS appear as instant seeds. */}
            {filters.map(f => (
              <div key={f.id} style={styles.row}>
                <EntityAutocomplete
                  value={f.property}
                  onChange={v => regen({ builderFilters: filters.map(x => x.id === f.id ? { ...x, property: v } : x) })}
                  onSelect={o => regen({ builderFilters: filters.map(x => x.id === f.id ? { ...x, property: o.qid } : x) })}
                  placeholder="property, e.g. time period"
                  searchType="property"
                  seedSuggestions={PROPERTY_SEEDS}
                  emptyHint="no matching property"
                  inputStyle={{ ...styles.inlineInput, flex: '0 0 96px' }}
                />
                <EntityAutocomplete
                  value={f.value}
                  onChange={v => regen({ builderFilters: filters.map(x => x.id === f.id ? { ...x, value: v } : x) })}
                  onSelect={o => regen({ builderFilters: filters.map(x => x.id === f.id ? { ...x, value: o.qid } : x) })}
                  placeholder="name, Q-id, or text (contains)"
                  emptyHint="no entity match — text will filter as CONTAINS"
                  inputStyle={styles.inlineInput}
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
            <span style={styles.sectionLabel}>SPARQL — {endpoint.citation.service}</span>
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
