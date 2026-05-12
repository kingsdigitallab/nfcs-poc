/**
 * SmartFilterNode — natural language → structured filter conditions → applied
 * to upstream records via the KCL inference API.
 *
 * The LLM receives the available field paths (discovered from real records)
 * plus sample values, then returns a JSON conditions object which is evaluated
 * deterministically. No eval(), no JS generation.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { setNodeResults } from '../store/resultsStore'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'

// ── Types ──────────────────────────────────────────────────────────────────────

export type FilterOp =
  | 'contains' | 'notContains'
  | 'equals'   | 'notEquals'
  | 'startsWith' | 'endsWith'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'exists'   | 'notExists'
  | 'in'

export interface FilterCondition {
  /** Single field path. Use `fields` instead for multi-field OR text searches. */
  field?: string
  /** Check multiple fields with OR logic — record passes if ANY field satisfies the condition. */
  fields?: string[]
  op: FilterOp
  value?: unknown
  caseSensitive?: boolean
}

export interface SmartFilter {
  logic: 'AND' | 'OR'
  conditions: FilterCondition[]
  explanation: string
}

export interface SmartFilterNodeData {
  apiKey: string
  model: string
  nlQuery: string
  generatedFilter: SmartFilter | null
  /** Per-condition disabled flags; index matches generatedFilter.conditions[i]. */
  disabledConditions: boolean[]
  filterStatus: 'idle' | 'translating' | 'applied' | 'error'
  filterMessage: string
  matchCount: number
  totalCount: number
  resultsVersion: number
  [key: string]: unknown
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'
const KCL_MODELS = '/kcl-proxy/v1/models'

const HEADER_COLOR = '#0f4c81'

const SYSTEM_PROMPT = `You are a data filter assistant for a humanities research database tool. Convert natural language filter requests into structured JSON filter specifications.

CRITICAL: Respond with ONLY a JSON object — no markdown fences, no explanation outside the JSON.

Response schema:
{
  "logic": "AND" | "OR",
  "conditions": [
    {
      "field": "<single dot.notation.path>",
      "op": "contains" | "notContains" | "equals" | "notEquals" | "startsWith" | "endsWith" | "gt" | "lt" | "gte" | "lte" | "exists" | "notExists" | "in",
      "value": <string, number, or string[] for 'in' op>,
      "caseSensitive": false
    }
  ],
  "explanation": "<one plain-English sentence describing the filter>"
}

MULTI-FIELD OR — for keyword / phrase / topic searches, use "fields" (array) instead of "field":
{
  "fields": ["title", "description", "subject"],
  "op": "contains",
  "value": "barrow"
}
A record passes if ANY of the listed fields satisfies the condition.
Use "fields" whenever the query is about what something IS ABOUT or MENTIONS (e.g. "with X", "about X", "mentioning X", "containing X").
Use single "field" for attribute checks (coordinates present, date range, specific typed field).

Operator rules:
- exists / notExists: no value needed — checks whether the field is populated
- in: value must be a string[] — matches if the record field equals any item
- contains / notContains: for strings, substring match; for array fields, checks any element
- gt / lt / gte / lte: numeric or year comparison — use string digits e.g. "1800"
- Always use exact field paths from the Available Fields list
- Prefer AND logic unless the request is clearly listing alternatives
- caseSensitive defaults to false`

// ── Field discovery ────────────────────────────────────────────────────────────

interface FieldInfo { path: string; type: string; samples: string[] }

function collectPaths(
  obj: Record<string, unknown>,
  map: Map<string, { type: string; samples: Set<string> }>,
  prefix = '',
  depth = 0,
) {
  if (depth > 3) return
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('_')) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (val == null) continue
    if (typeof val === 'object' && !Array.isArray(val)) {
      collectPaths(val as Record<string, unknown>, map, path, depth + 1)
    } else {
      if (!map.has(path)) map.set(path, { type: Array.isArray(val) ? 'string[]' : typeof val, samples: new Set() })
      const entry = map.get(path)!
      if (entry.samples.size < 3) {
        const sample = Array.isArray(val) ? (val as unknown[])[0] : val
        if (sample != null) entry.samples.add(String(sample).slice(0, 60))
      }
    }
  }
}

function discoverFields(records: Record<string, unknown>[], maxRecords = 30): FieldInfo[] {
  const map = new Map<string, { type: string; samples: Set<string> }>()
  for (const r of records.slice(0, maxRecords)) collectPaths(r, map)
  return [...map.entries()].map(([path, { type, samples }]) => ({
    path, type, samples: [...samples],
  }))
}

// ── Filter evaluator ──────────────────────────────────────────────────────────

function resolveField(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let val: unknown = record
  for (const part of parts) {
    if (val == null || typeof val !== 'object') return undefined
    val = (val as Record<string, unknown>)[part]
  }
  return val
}

function norm(val: unknown, cs: boolean): string {
  const s = String(val ?? '')
  return cs ? s : s.toLowerCase()
}

function testSingleField(record: Record<string, unknown>, field: string, c: FilterCondition): boolean {
  const raw = resolveField(record, field)
  const cs  = c.caseSensitive ?? false
  const cv  = c.value

  const isEmpty = raw == null || raw === '' || (Array.isArray(raw) && (raw as unknown[]).length === 0)

  switch (c.op) {
    case 'exists':    return !isEmpty
    case 'notExists': return isEmpty
  }

  const candidates: unknown[] = Array.isArray(raw) ? raw as unknown[] : [raw]

  switch (c.op) {
    case 'equals':     return candidates.some(v => norm(v, cs) === norm(cv, cs))
    case 'notEquals':  return candidates.every(v => norm(v, cs) !== norm(cv, cs))
    case 'contains':   return candidates.some(v => norm(v, cs).includes(norm(cv as string, cs)))
    case 'notContains':return candidates.every(v => !norm(v, cs).includes(norm(cv as string, cs)))
    case 'startsWith': return candidates.some(v => norm(v, cs).startsWith(norm(cv as string, cs)))
    case 'endsWith':   return candidates.some(v => norm(v, cs).endsWith(norm(cv as string, cs)))
    case 'gt':  return candidates.some(v => Number(v) >  Number(cv))
    case 'lt':  return candidates.some(v => Number(v) <  Number(cv))
    case 'gte': return candidates.some(v => Number(v) >= Number(cv))
    case 'lte': return candidates.some(v => Number(v) <= Number(cv))
    case 'in': {
      const list = (Array.isArray(cv) ? cv : [cv]) as unknown[]
      return candidates.some(v => list.some(l => norm(v, cs) === norm(l, cs)))
    }
    default: return true
  }
}

function testCondition(record: Record<string, unknown>, c: FilterCondition): boolean {
  const fieldsToCheck = c.fields ?? (c.field ? [c.field] : [])
  if (fieldsToCheck.length === 0) return true
  // For notContains / notEquals / notExists we need ALL fields to pass (AND semantics across fields)
  const negativeOp = c.op === 'notContains' || c.op === 'notEquals' || c.op === 'notExists'
  return negativeOp
    ? fieldsToCheck.every(f => testSingleField(record, f, c))
    : fieldsToCheck.some(f  => testSingleField(record, f, c))
}

function applySmartFilter(
  records: Record<string, unknown>[],
  filter: SmartFilter,
  disabled: boolean[] = [],
): Record<string, unknown>[] {
  const active = filter.conditions.filter((_, i) => !disabled[i])
  if (active.length === 0) return records
  return records.filter(r => {
    const results = active.map(c => testCondition(r, c))
    return filter.logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
  })
}

// ── KCL translation ───────────────────────────────────────────────────────────

async function translateToFilter(
  apiKey: string,
  model: string,
  nlQuery: string,
  fields: FieldInfo[],
  signal: AbortSignal,
): Promise<SmartFilter> {
  const fieldList = fields
    .slice(0, 50)
    .map(f => `- ${f.path} (${f.type})${f.samples.length > 0 ? ': e.g. ' + f.samples.map(s => `"${s}"`).join(', ') : ''}`)
    .join('\n')

  const userPrompt = `Available fields:\n${fieldList}\n\nFilter request: "${nlQuery}"`

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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
    }),
    signal,
  })

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string }; text?: string }>
  }
  const raw = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? ''
  // Strip markdown fences some models emit despite response_format
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as SmartFilter
}

// ── Condition display ─────────────────────────────────────────────────────────

const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contains', notContains: 'does not contain',
  equals: '=', notEquals: '≠',
  startsWith: 'starts with', endsWith: 'ends with',
  gt: '>', lt: '<', gte: '≥', lte: '≤',
  exists: 'is present', notExists: 'is absent',
  in: 'is one of',
}

interface ConditionPillProps {
  c: FilterCondition
  logic: 'AND' | 'OR'
  first: boolean
  enabled: boolean
  onToggle: () => void
}

function ConditionPill({ c, logic, first, enabled, onToggle }: ConditionPillProps) {
  const hasValue  = c.op !== 'exists' && c.op !== 'notExists'
  const valueStr  = Array.isArray(c.value)
    ? (c.value as string[]).map(v => `"${v}"`).join(', ')
    : c.value != null ? `"${c.value}"` : ''
  const fieldDisplay = c.fields
    ? c.fields.join(' | ')
    : (c.field ?? '')

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 4, opacity: enabled ? 1 : 0.38 }}>
      {/* Toggle */}
      <button
        onClick={onToggle}
        title={enabled ? 'Disable this condition' : 'Enable this condition'}
        style={{
          width: 14, height: 14, borderRadius: 3, flexShrink: 0, marginTop: 3,
          background: enabled ? '#3b82f6' : '#374151',
          border: `1px solid ${enabled ? '#60a5fa' : '#4b5563'}`,
          cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {enabled && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
      </button>

      <span style={{
        fontSize: 9, fontWeight: 700, color: '#6b7280', minWidth: 22, marginTop: 3,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {first ? 'IF' : logic}
      </span>

      <div style={{
        flex: 1, background: '#1f2937', borderRadius: 4, padding: '3px 7px',
        fontSize: 10, color: '#e5e7eb', lineHeight: 1.5,
        textDecoration: enabled ? 'none' : 'line-through',
      }}>
        <span style={{ color: '#93c5fd', fontWeight: 600 }}>{fieldDisplay}</span>
        {' '}
        <span style={{ color: '#fbbf24' }}>{OP_LABELS[c.op] ?? c.op}</span>
        {hasValue && <> <span style={{ color: '#86efac' }}>{valueStr}</span></>}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SmartFilterNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as SmartFilterNodeData

  const { records: rawRecords, connected } = useUpstreamRecords(id)
  const records = rawRecords ?? []

  const generatedFilter      = d.generatedFilter as SmartFilter | null
  const disabledConditions   = (d.disabledConditions as boolean[] | undefined) ?? []

  // Apply filter reactively — respects per-condition enabled state
  const filteredRecords = useMemo(() => {
    if (!generatedFilter || records.length === 0) return records
    return applySmartFilter(records as Record<string, unknown>[], generatedFilter, disabledConditions)
  }, [records, generatedFilter, disabledConditions])

  // Fingerprint → update results store
  const prevFpRef = useRef('')
  useEffect(() => {
    const fp = `${filteredRecords.length}:${records.length}:${filteredRecords[0]?.id ?? ''}:${filteredRecords[filteredRecords.length - 1]?.id ?? ''}`
    if (fp === prevFpRef.current) return
    prevFpRef.current = fp
    const version = setNodeResults(id, filteredRecords)
    updateNodeData(id, {
      matchCount:     filteredRecords.length,
      totalCount:     records.length,
      filterStatus:   generatedFilter ? 'applied' : 'idle',
      resultsVersion: version,
    })
  }, [filteredRecords, records.length, generatedFilter, id, updateNodeData])

  // Local state
  const [apiKey, setApiKey]   = useState((d.apiKey as string) || '')
  const [model, setModel]     = useState((d.model as string) || 'arc:nano')
  const [models, setModels]   = useState<string[]>([])
  const [showKey, setShowKey] = useState(false)
  const [nlQuery, setNlQuery] = useState((d.nlQuery as string) || '')
  const [translating, setTranslating] = useState(false)
  const [errorMsg, setErrorMsg]       = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const persistApiKey = useCallback((v: string) => { setApiKey(v); updateNodeData(id, { apiKey: v }) }, [id, updateNodeData])
  const persistModel  = useCallback((v: string) => { setModel(v);  updateNodeData(id, { model: v })  }, [id, updateNodeData])
  const persistQuery  = useCallback((v: string) => { setNlQuery(v); updateNodeData(id, { nlQuery: v }) }, [id, updateNodeData])

  // Fetch model list when API key is set
  useEffect(() => {
    if (!apiKey) return
    fetch(KCL_MODELS, { headers: { Authorization: `Bearer ${apiKey}` } })
      .then(r => r.json())
      .then((j: { data?: Array<{ id: string }> }) => {
        const ids = j.data?.map(m => m.id) ?? []
        setModels(ids)
        if (ids.length > 0 && (!model || model === 'arc:nano')) {
          const nano = ids.find(id => id === 'arc:nano') ?? ids[0]
          persistModel(nano)
        }
      })
      .catch(() => { /* ignore */ })
  }, [apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTranslate = useCallback(async () => {
    if (!apiKey || !model || !nlQuery.trim() || records.length === 0) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setTranslating(true)
    setErrorMsg('')
    updateNodeData(id, { filterStatus: 'translating', filterMessage: '', generatedFilter: null })
    try {
      const fields  = discoverFields(records as Record<string, unknown>[])
      const filter  = await translateToFilter(apiKey, model, nlQuery.trim(), fields, ctrl.signal)
      updateNodeData(id, { generatedFilter: filter, disabledConditions: [], filterStatus: 'applied', filterMessage: '' })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = (err as Error).message
        setErrorMsg(msg)
        updateNodeData(id, { filterStatus: 'error', filterMessage: msg })
      }
    } finally {
      setTranslating(false)
    }
  }, [apiKey, model, nlQuery, records, id, updateNodeData])

  const toggleCondition = useCallback((idx: number) => {
    const next = [...disabledConditions]
    next[idx] = !next[idx]
    updateNodeData(id, { disabledConditions: next })
  }, [disabledConditions, id, updateNodeData])

  const handleClear = useCallback(() => {
    updateNodeData(id, { generatedFilter: null, disabledConditions: [], filterStatus: 'idle', filterMessage: '', matchCount: 0 })
    setErrorMsg('')
  }, [id, updateNodeData])

  const matchCount = filteredRecords.length
  const totalCount = records.length
  const hasFilter  = generatedFilter != null
  const matchPct   = totalCount > 0 ? matchCount / totalCount : 0

  const statusColor = translating ? '#3b82f6'
    : errorMsg       ? '#ef4444'
    : hasFilter      ? '#22c55e'
    : '#6b7280'

  return (
    <div style={{
      width: 340,
      background: '#111827',
      border: `1px solid ${statusColor}`,
      borderRadius: 6,
      fontFamily: 'sans-serif',
      color: '#f9fafb',
      fontSize: 12,
      transition: 'border-color 0.2s',
    }}>
      <Handle type="target" position={Position.Left} id="data"
        style={{ top: '50%', background: '#6b7280', width: 8, height: 8 }} />

      {/* Header */}
      <div style={{
        background: HEADER_COLOR, padding: '6px 10px',
        borderRadius: '6px 6px 0 0', fontWeight: 700, fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Smart Filter</span>
        {hasFilter && (
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: matchCount === 0 ? '#fca5a5' : '#86efac',
          }}>
            {matchCount.toLocaleString()} / {totalCount.toLocaleString()} match
          </span>
        )}
      </div>

      <div style={{ padding: '8px 10px' }}>

        {/* NL query */}
        <textarea
          value={nlQuery}
          onChange={e => persistQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleTranslate() }}
          placeholder={connected
            ? 'Describe your filter in plain English…\ne.g. "Iron Age sites in England with coordinates"'
            : 'Connect a source node first'}
          rows={3}
          disabled={!connected}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
            color: '#f9fafb', fontSize: 11, padding: '5px 7px', marginBottom: 6,
            fontFamily: 'sans-serif',
          }}
        />

        {/* API key */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => persistApiKey(e.target.value)}
            placeholder="KCL API key"
            style={{
              flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
              color: '#f9fafb', fontSize: 10, padding: '3px 6px',
            }}
          />
          <button onClick={() => setShowKey(s => !s)}
            style={{ fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>
            {showKey ? '🙈' : '👁'}
          </button>
        </div>

        {/* Model picker */}
        {models.length > 0 ? (
          <select value={model} onChange={e => persistModel(e.target.value)}
            style={{
              width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
              color: '#f9fafb', fontSize: 10, padding: '3px 6px', marginBottom: 6,
            }}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input type="text" value={model} onChange={e => persistModel(e.target.value)}
            placeholder="arc:nano"
            style={{
              width: '100%', boxSizing: 'border-box', background: '#1f2937',
              border: '1px solid #374151', borderRadius: 3,
              color: '#f9fafb', fontSize: 10, padding: '3px 6px', marginBottom: 6,
            }}
          />
        )}

        {/* Translate / Clear buttons */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button
            onClick={handleTranslate}
            disabled={translating || !apiKey || !model || !nlQuery.trim() || !connected}
            style={{
              flex: 1,
              background: translating ? '#374151' : !apiKey || !nlQuery.trim() || !connected ? '#1f2937' : HEADER_COLOR,
              color: '#f9fafb', border: 'none', borderRadius: 3,
              fontSize: 11, padding: '5px 0',
              cursor: translating || !apiKey || !nlQuery.trim() || !connected ? 'default' : 'pointer',
              opacity: !apiKey || !nlQuery.trim() || !connected ? 0.5 : 1,
            }}
          >
            {translating ? 'Translating…' : 'Translate & apply  ⌘↵'}
          </button>
          {hasFilter && !translating && (
            <button onClick={handleClear}
              title="Clear filter — pass all records through"
              style={{
                background: '#374151', color: '#9ca3af', border: 'none', borderRadius: 3,
                fontSize: 11, padding: '5px 9px', cursor: 'pointer',
              }}>
              ✕
            </button>
          )}
        </div>

        {/* Error */}
        {errorMsg && (
          <div style={{ fontSize: 10, color: '#fca5a5', background: '#450a0a', borderRadius: 3, padding: '4px 7px', marginBottom: 6 }}>
            {errorMsg}
          </div>
        )}

        {/* Generated filter display */}
        {hasFilter && (
          <div style={{ borderTop: '1px solid #1f2937', paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6, fontStyle: 'italic' }}>
              {generatedFilter!.explanation}
            </div>

            {generatedFilter!.conditions.map((c, i) => (
              <ConditionPill
                key={i}
                c={c}
                logic={generatedFilter!.logic}
                first={i === 0}
                enabled={!disabledConditions[i]}
                onToggle={() => toggleCondition(i)}
              />
            ))}

            {/* Match bar */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280', marginBottom: 3 }}>
                <span>{matchCount.toLocaleString()} of {totalCount.toLocaleString()} records match</span>
                <span style={{ color: matchCount === 0 ? '#ef4444' : matchPct < 0.1 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>
                  {totalCount > 0 ? `${Math.round(matchPct * 100)}%` : '—'}
                </span>
              </div>
              <div style={{ height: 4, background: '#1f2937', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${matchPct * 100}%`,
                  background: matchCount === 0 ? '#ef4444' : matchPct < 0.1 ? '#f59e0b' : '#22c55e',
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>

            <div style={{ fontSize: 9, color: '#374151', marginTop: 5, textAlign: 'right' }}>
              logic: <span style={{ color: '#6b7280', fontWeight: 700 }}>{generatedFilter!.logic}</span>
            </div>
          </div>
        )}

        {/* Idle hint */}
        {!hasFilter && !errorMsg && connected && records.length > 0 && (
          <div style={{ fontSize: 10, color: '#4b5563', textAlign: 'center', padding: '4px 0' }}>
            {records.length.toLocaleString()} records in — all passing through until a filter is applied
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="results"
        style={{ top: '50%', background: '#6b7280', width: 8, height: 8 }} />
    </div>
  )
}
