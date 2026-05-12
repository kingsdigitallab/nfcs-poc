/**
 * KCLFieldNode — send a selected field from each upstream record to KCL's
 * OpenAI-compatible inference API.
 *
 * Two modes:
 *   per-record  — enriches each record with kclResponse
 *   aggregate   — collects all field values into one prompt; produces a
 *                 single summary record
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Handle, Position, useReactFlow, useNodes, useEdges, NodeProps } from '@xyflow/react'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KCLFieldNodeData {
  apiKey: string
  model: string
  selectedField: string
  mode: 'per-record' | 'aggregate'
  systemPrompt: string
  userPromptTemplate: string
  temperature: number
  maxTokens: number
  status: 'idle' | 'running' | 'success' | 'error'
  statusMessage: string
  results: unknown[] | undefined
  inputCount: number
  outputCount: number
  [key: string]: unknown
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_MODELS = '/kcl-proxy/v1/models'
const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'

const HEADER_COLOR = '#7f1d1d'  // red-900 — slightly darker than KCLNode
const BTN_COLOR    = '#be123c'

const DEFAULT_SYSTEM     = 'You are a research assistant helping to analyse humanities research data.'
const DEFAULT_PROMPT_PER = 'Summarise the following in 2–3 sentences:\n\n{{value}}'
const DEFAULT_PROMPT_AGG = 'The following are {{field}} values from {{count}} research records. Provide a concise thematic summary of what this collection covers:\n\n{{values}}'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── OpenAI SSE streaming helper ────────────────────────────────────────────────

async function kclChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal,
  onToken: (accumulated: string) => void,
): Promise<string> {
  const res = await fetch(KCL_CHAT, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream:      true,
      temperature,
      max_tokens:  maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  if (!res.body) throw new Error('No response body')

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer      = ''
  let accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return accumulated
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
        }
        const content = chunk.choices?.[0]?.delta?.content
        if (content) {
          accumulated += content
          onToken(accumulated.slice(-200))
        }
      } catch { /* malformed chunk — skip */ }
    }
  }
  return accumulated
}

// ── Component ──────────────────────────────────────────────────────────────────

export function KCLFieldNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as KCLFieldNodeData

  const [models, setModels]             = useState<string[]>([])
  const [apiOk, setApiOk]               = useState<boolean | null>(null)
  const [liveTokens, setLiveTokens]     = useState('')
  const [liveProgress, setLiveProgress] = useState('')
  const [showKey, setShowKey]           = useState(false)
  const [tokenInput, setTokenInput]     = useState(String((d.maxTokens as number | undefined) ?? 1024))
  const abortRef = useRef<AbortController | null>(null)

  // ── Resolve apiKey — inline field or connected Param node ───────────────────

  const isApiKeyConnected = allEdges.some(e => e.target === id && e.targetHandle === 'apiKey')

  const effectiveApiKey = useMemo(() => {
    if (!isApiKeyConnected) return (d.apiKey as string | undefined) ?? ''
    const edge = allEdges.find(e => e.target === id && e.targetHandle === 'apiKey')
    if (!edge) return ''
    return (allNodes.find(n => n.id === edge.source)?.data as { value?: string } | undefined)?.value ?? ''
  }, [allEdges, allNodes, id, isApiKeyConnected, d.apiKey])

  // ── Fetch available models ───────────────────────────────────────────────────

  useEffect(() => {
    const key = effectiveApiKey
    if (!key) { setApiOk(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(KCL_MODELS, {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { data?: Array<{ id: string }> }
        if (cancelled) return
        const ids = (json.data ?? []).map(m => m.id).sort()
        setModels(ids)
        setApiOk(true)
        if (!d.model && ids.length > 0) updateNodeData(id, { model: ids[0] })
      } catch {
        if (!cancelled) setApiOk(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, effectiveApiKey])

  // ── Upstream records ─────────────────────────────────────────────────────────

  const upstreamRecords = useMemo<Record<string, unknown>[]>(() => {
    const inputEdges = allEdges.filter(e => e.target === id && e.targetHandle === 'data')
    const out: Record<string, unknown>[] = []
    for (const edge of inputEdges) {
      const src = allNodes.find(n => n.id === edge.source)
      if (!src) continue
      const recs = getNodeResults(src.id)
      if (recs) out.push(...recs)
    }
    return out
  }, [allNodes, allEdges, id])

  // Available fields from upstream sample (arrays included, plain objects excluded)
  const availableFields = useMemo<string[]>(() => {
    if (upstreamRecords.length === 0) return []
    const sample = upstreamRecords[0]
    return Object.entries(sample)
      .filter(([, v]) => v !== null && v !== undefined && (typeof v !== 'object' || Array.isArray(v)))
      .map(([k]) => k)
  }, [upstreamRecords])

  // ── Derived state ─────────────────────────────────────────────────────────────

  const apiKey         = (d.apiKey        ?? '') as string
  const selectedModel  = (d.model         ?? '') as string
  const selectedField  = (d.selectedField ?? availableFields[0] ?? '') as string
  const mode           = (d.mode ?? 'per-record') as 'per-record' | 'aggregate'
  const systemPrompt   = (d.systemPrompt  ?? DEFAULT_SYSTEM) as string
  const promptTemplate = (d.userPromptTemplate ?? (mode === 'aggregate' ? DEFAULT_PROMPT_AGG : DEFAULT_PROMPT_PER)) as string
  const temperature    = (d.temperature   ?? 0.7) as number
  const maxTokens      = (d.maxTokens     ?? 1024) as number
  const isRunning      = d.status === 'running'

  useEffect(() => { setTokenInput(String(maxTokens)) }, [maxTokens])

  useEffect(() => {
    if (!d.selectedField && availableFields.length > 0) {
      updateNodeData(id, { selectedField: availableFields[0] })
    }
  }, [availableFields, d.selectedField, id, updateNodeData])

  // ── Run handler ───────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (!effectiveApiKey) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ API key required' })
      return
    }
    if (!selectedModel) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No model selected' })
      return
    }
    if (!selectedField) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No field selected' })
      return
    }
    if (upstreamRecords.length === 0) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No upstream records' })
      return
    }

    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    clearNodeResults(id)
    updateNodeData(id, {
      status: 'running', statusMessage: 'Starting…',
      inputCount: upstreamRecords.length, outputCount: 0,
    })
    setLiveTokens('')
    setLiveProgress('')

    try {
      if (mode === 'aggregate') {
        const values = upstreamRecords
          .map(r => {
            const v = r[selectedField]
            return Array.isArray(v) ? v.join('; ') : String(v ?? '').trim()
          })
          .filter(Boolean)
          .join('\n---\n')

        setLiveProgress(`Aggregating ${upstreamRecords.length} records…`)
        updateNodeData(id, { statusMessage: 'Sending aggregate prompt…' })

        const prompt = promptTemplate
          .replace(/\{\{values\}\}/g, values)
          .replace(/\{\{field\}\}/g,  selectedField)
          .replace(/\{\{value\}\}/g,  values)
          .replace(/\{\{count\}\}/g,  String(upstreamRecords.length))

        const response = await kclChat(
          effectiveApiKey, selectedModel, systemPrompt, prompt,
          temperature, maxTokens, signal,
          tok => setLiveTokens(tok),
        )

        const resultRecord = {
          id:                  `kcl-agg-${Date.now()}`,
          _source:             'kclField',
          title:               `${selectedField} — aggregate summary`,
          kclModel:            selectedModel,
          kclField:            selectedField,
          kclMode:             'aggregate',
          kclAggregatedFrom:   upstreamRecords.length,
          kclPrompt:           prompt,
          kclResponse:         response,
          kclProcessedAt:      new Date().toISOString(),
        }

        setLiveTokens('')
        setLiveProgress('')
        const version = setNodeResults(id, [resultRecord])
        updateNodeData(id, {
          status:         'success',
          statusMessage:  `✓ Aggregate summary (${upstreamRecords.length} records)`,
          outputCount:    1,
          resultsVersion: version,
        })

      } else {
        const enriched: Record<string, unknown>[] = []

        for (let i = 0; i < upstreamRecords.length; i++) {
          if (signal.aborted) break
          const record = upstreamRecords[i]
          const rawVal = record[selectedField]
          const value  = Array.isArray(rawVal) ? rawVal.join('; ') : String(rawVal ?? '').trim()

          setLiveProgress(`${i + 1} / ${upstreamRecords.length}`)
          updateNodeData(id, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

          const prompt = promptTemplate
            .replace(/\{\{value\}\}/g, value)
            .replace(/\{\{field\}\}/g, selectedField)
            .replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(record[k] ?? ''))

          const response = await kclChat(
            effectiveApiKey, selectedModel, systemPrompt, prompt,
            temperature, maxTokens, signal,
            tok => setLiveTokens(tok),
          )

          enriched.push({
            ...record,
            kclModel:       selectedModel,
            kclField:       selectedField,
            kclMode:        'per-record',
            kclPrompt:      prompt,
            kclResponse:    response,
            kclProcessedAt: new Date().toISOString(),
          })
          updateNodeData(id, { outputCount: enriched.length })
        }

        setLiveTokens('')
        setLiveProgress('')
        const version = setNodeResults(id, enriched)
        updateNodeData(id, {
          status:         'success',
          statusMessage:  `✓ ${enriched.length} records processed`,
          outputCount:    enriched.length,
          resultsVersion: version,
        })
      }
    } catch (err) {
      setLiveTokens('')
      setLiveProgress('')
      if ((err as { name?: string }).name === 'AbortError') {
        updateNodeData(id, { status: 'idle', statusMessage: 'Cancelled' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [id, updateNodeData, upstreamRecords, effectiveApiKey, selectedModel, selectedField, mode, systemPrompt, promptTemplate, temperature, maxTokens])

  const handleCancel = useCallback(() => { abortRef.current?.abort() }, [])

  const status      = (d.status ?? 'idle') as string
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'
  const canRun      = !!effectiveApiKey && !!selectedModel && !isRunning

  return (
    <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data"   style={{ ...styles.inputHandle, top: 16 }} />
      <Handle type="target" position={Position.Left} id="apiKey" style={{ ...styles.inputHandle, top: 53, background: isApiKeyConnected ? '#3b82f6' : '#be123c', boxShadow: `0 0 0 1px ${isApiKeyConnected ? '#3b82f6' : '#be123c'}` }} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>KCL Field</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {!effectiveApiKey && (
        <div style={styles.warnBanner}>⚠ Enter your KCL AI API key</div>
      )}
      {effectiveApiKey && apiOk === false && (
        <div style={styles.warnBanner}>⚠ Could not reach KCL API — check key or VPN</div>
      )}

      <div style={styles.body}>
        {/* API key */}
        <div style={styles.row}>
          <span style={styles.label}>Key</span>
          <input
            type={isApiKeyConnected ? 'text' : showKey ? 'text' : 'password'}
            style={{
              ...styles.input,
              background: isApiKeyConnected ? '#eff6ff' : '#fff',
              color:      isApiKeyConnected ? '#1d4ed8' : '#111827',
            }}
            value={isApiKeyConnected ? '' : (d.apiKey as string | undefined) ?? ''}
            onChange={e => updateNodeData(id, { apiKey: e.target.value })}
            placeholder={isApiKeyConnected ? '(from Param)' : 'sk-…'}
            readOnly={isApiKeyConnected}
            className="nodrag"
          />
          {!isApiKeyConnected && (
            <button style={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Hide' : 'Show'} className="nodrag">
              {showKey ? '🙈' : '👁'}
            </button>
          )}
        </div>

        {/* Model */}
        <div style={styles.row}>
          <span style={styles.label}>Model</span>
          {models.length > 0 ? (
            <select style={styles.select} value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })} className="nodrag">
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input style={styles.input} value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })}
              placeholder="arc:nano" className="nodrag" />
          )}
        </div>

        {/* Field picker */}
        <div style={styles.row}>
          <span style={styles.label}>Field</span>
          {availableFields.length > 0 ? (
            <select style={styles.select} value={selectedField}
              onChange={e => updateNodeData(id, { selectedField: e.target.value })} className="nodrag">
              {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input style={styles.input} value={selectedField}
              onChange={e => updateNodeData(id, { selectedField: e.target.value })}
              placeholder="connect records first" className="nodrag" />
          )}
        </div>

        {/* Mode */}
        <div style={styles.row}>
          <span style={styles.label}>Mode</span>
          <select style={styles.select} value={mode}
            onChange={e => {
              const newMode = e.target.value as 'per-record' | 'aggregate'
              updateNodeData(id, {
                mode: newMode,
                userPromptTemplate: newMode === 'aggregate' ? DEFAULT_PROMPT_AGG : DEFAULT_PROMPT_PER,
              })
            }} className="nodrag">
            <option value="per-record">Per record</option>
            <option value="aggregate">Aggregate all</option>
          </select>
        </div>

        {/* System prompt */}
        <div style={styles.colField}>
          <span style={styles.label}>System</span>
          <textarea style={styles.textarea} value={systemPrompt}
            onChange={e => updateNodeData(id, { systemPrompt: e.target.value })}
            rows={2} className="nodrag" />
        </div>

        {/* Prompt template */}
        <div style={styles.colField}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={styles.label}>Prompt</span>
            <span style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'monospace' }}>
              {mode === 'aggregate' ? '{{values}} {{field}} {{count}}' : '{{value}} {{field}}'}
            </span>
          </div>
          <textarea style={{ ...styles.textarea, minHeight: 56 }} value={promptTemplate}
            onChange={e => updateNodeData(id, { userPromptTemplate: e.target.value })}
            rows={3} className="nodrag" />
        </div>

        {/* Temperature */}
        <div style={styles.row}>
          <span style={styles.label}>Temp</span>
          <input type="range" min={0} max={1} step={0.05} value={temperature}
            onChange={e => updateNodeData(id, { temperature: parseFloat(e.target.value) })}
            style={{ flex: 1 }} className="nodrag" />
          <span style={styles.numLabel}>{temperature.toFixed(2)}</span>
        </div>

        {/* Max tokens */}
        <div style={styles.row}>
          <span style={styles.label}>Tokens</span>
          <input type="text" style={{ ...styles.input, width: 70 }}
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(tokenInput, 10)
              if (Number.isFinite(n)) updateNodeData(id, { maxTokens: n })
              else setTokenInput(String(maxTokens))
            }}
            placeholder="1024" className="nodrag" />
        </div>

        {/* Live preview */}
        {isRunning && (liveProgress || liveTokens) && (
          <div style={styles.livePreview}>
            <div style={styles.liveHeader}>⚙ {liveProgress}</div>
            {liveTokens && <div style={styles.liveText}>…{liveTokens}</div>}
          </div>
        )}
      </div>

      <div style={styles.footer}>
        {isRunning ? (
          <button style={{ ...styles.btn, background: '#dc2626' }} onClick={handleCancel} className="nodrag">
            ✕ Cancel
          </button>
        ) : (
          <button style={{ ...styles.btn, background: BTN_COLOR, opacity: canRun ? 1 : 0.4 }}
            onClick={handleRun} disabled={!canRun} className="nodrag">
            ▶ Run
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 272,
    maxWidth: 312,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
  },
  header: {
    height: 32,
    background: HEADER_COLOR,
    borderRadius: '6px 6px 0 0',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 },
  headerStatus: { fontSize: 10, fontWeight: 600, color: '#fecdd3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  warnBanner: { fontSize: 10, padding: '5px 10px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', lineHeight: 1.4 },
  body: { padding: '10px 12px 6px', display: 'flex', flexDirection: 'column' as const, gap: 7 },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  colField: { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  label: { fontSize: 11, color: '#6b7280', width: 44, flexShrink: 0, fontFamily: 'monospace' },
  select: { flex: 1, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', height: 22 },
  input: { flex: 1, fontSize: 11, padding: '2px 5px', border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', height: 22 },
  eyeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 2px', flexShrink: 0 },
  textarea: { width: '100%', fontSize: 11, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', resize: 'vertical' as const, fontFamily: 'monospace', lineHeight: 1.4, boxSizing: 'border-box' as const },
  numLabel: { fontSize: 10, color: '#6b7280', width: 28, textAlign: 'right' as const },
  livePreview: { marginTop: 2, background: '#1e1e2e', borderRadius: 4, overflow: 'hidden', border: '1px solid #881337' },
  liveHeader: { fontSize: 10, color: '#fda4af', padding: '3px 6px', background: '#4c0519', fontFamily: 'monospace' },
  liveText: { fontSize: 10, color: '#e2e8f0', padding: '4px 6px', fontFamily: 'monospace', lineHeight: 1.5, maxHeight: 60, overflowY: 'auto' as const, whiteSpace: 'pre-wrap' as const },
  footer: { padding: '6px 10px 8px', display: 'flex', justifyContent: 'flex-end' },
  btn: { color: '#fff', border: 'none', borderRadius: 5, padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  inputHandle: { width: 8, height: 8, background: '#be123c', border: '2px solid #fff', boxShadow: '0 0 0 1px #be123c', position: 'absolute' as const, left: -5, borderRadius: '50%' },
  outputHandle: { width: 10, height: 10, background: '#22c55e', border: '2px solid #fff', boxShadow: '0 0 0 1px #22c55e' },
}
