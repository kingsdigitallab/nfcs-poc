/**
 * OllamaNode — transform node that sends records to a locally-running Ollama
 * instance via the Vite dev proxy (/ollama → http://localhost:11434).
 *
 * Accepts FileRecord[] or UnifiedRecord[] upstream (checks for a `content`
 * field; falls back to JSON.stringify of the record). Emits the input records
 * enriched with `ollamaModel`, `ollamaPrompt`, `ollamaResponse`, and
 * `ollamaProcessedAt` fields.
 *
 * Processing is sequential to respect Ollama's single-connection preference.
 * Uses /api/chat with stream:true and reads SSE chunks for live preview.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Handle, Position, useReactFlow, useNodes, useEdges, NodeProps } from '@xyflow/react'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'
// ── Types ─────────────────────────────────────────────────────────────────────

export interface OllamaNodeData {
  model: string
  visionOverride: boolean
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

interface OllamaModel {
  name: string
  isVision: boolean
}

const OLLAMA_TAGS    = '/ollama/api/tags'
const OLLAMA_CHAT    = '/ollama/api/chat'
const VISION_MARKERS = ['llava', 'vision', 'bakllava', 'moondream', 'cogvlm']

const HEADER_COLOR  = '#312e81'  // deep indigo
const BTN_COLOR     = '#4338ca'

const DEFAULT_SYSTEM = 'You are a research assistant helping to analyse humanities research documents and data.'
const DEFAULT_PROMPT = 'Summarise the key themes and subjects in 3-4 sentences:\n\n{{content}}'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── Template rendering ────────────────────────────────────────────────────────

function renderTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = record[key]
    if (val === undefined || val === null) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OllamaNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as OllamaNodeData

  const [models, setModels]             = useState<OllamaModel[]>([])
  const [ollamaOk, setOllamaOk]         = useState<boolean | null>(null) // null = checking
  const [liveFile, setLiveFile]         = useState<string>('')
  const [liveTokens, setLiveTokens]     = useState<string>('')
  const [liveProgress, setLiveProgress] = useState<string>('')
  const [showFields, setShowFields]     = useState(false)
  const [tokenInput, setTokenInput]     = useState(String((d.maxTokens as number | undefined) ?? 1024))
  const abortRef = useRef<AbortController | null>(null)

  // ── Fetch available models on mount ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(OLLAMA_TAGS, { signal: AbortSignal.timeout(5_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { models: { name: string }[] }
        if (cancelled) return
        const parsed: OllamaModel[] = (json.models ?? []).map(m => ({
          name: m.name,
          isVision: VISION_MARKERS.some(v => m.name.toLowerCase().includes(v)),
        }))
        setModels(parsed)
        setOllamaOk(true)
        // Auto-select first model if none chosen
        if (!d.model && parsed.length > 0) {
          updateNodeData(id, { model: parsed[0].name })
        }
      } catch {
        if (!cancelled) setOllamaOk(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])   // run once on mount

  // ── Upstream records (FileRecord | UnifiedRecord) ─────────────────────────

  const upstreamRecords = useMemo<Record<string, unknown>[]>(() => {
    const inputEdges = allEdges.filter(e => e.target === id && e.targetHandle === 'data')
    const out: Record<string, unknown>[] = []
    for (const edge of inputEdges) {
      const src  = allNodes.find(n => n.id === edge.source)
      if (!src) continue
      const recs = getNodeResults(src.id)
      if (recs) out.push(...recs)
    }
    return out
  }, [allNodes, allEdges, id])

  // ── Derived state ─────────────────────────────────────────────────────────

  const selectedModel   = d.model || ''
  const systemPrompt    = d.systemPrompt    ?? DEFAULT_SYSTEM
  const promptTemplate  = d.userPromptTemplate ?? DEFAULT_PROMPT
  const temperature     = d.temperature ?? 0.7
  const maxTokens       = d.maxTokens   ?? 1024

  // Keep local token input in sync when node data changes externally (e.g. file load)
  useEffect(() => { setTokenInput(String(maxTokens)) }, [maxTokens])

  const visionByName   = VISION_MARKERS.some(v => selectedModel.toLowerCase().includes(v))
  const isVisionModel  = (d.visionOverride as boolean | undefined) ?? visionByName
  const hasImageInputs = upstreamRecords.some(r => r.contentType === 'image')
  const showVisionWarn = hasImageInputs && !isVisionModel && upstreamRecords.length > 0
  const isRunning      = d.status === 'running'

  // Field list for the {{field}} helper
  const sampleRecord = upstreamRecords[0]
  const availableFields = sampleRecord
    ? Object.keys(sampleRecord).filter(k => {
        const v = sampleRecord[k]
        return v !== null && typeof v !== 'object'
      })
    : []

  // ── Run handler ───────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (upstreamRecords.length === 0) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No upstream records' })
      return
    }
    if (!selectedModel) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No model selected' })
      return
    }

    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    clearNodeResults(id)
    updateNodeData(id, {
      status:        'running',
      statusMessage: `Processing 0/${upstreamRecords.length}…`,
      inputCount:    upstreamRecords.length,
      outputCount:   0,
    })
    setLiveTokens('')
    setLiveFile('')

    const enriched: Record<string, unknown>[] = []

    try {
      for (let i = 0; i < upstreamRecords.length; i++) {
        if (signal.aborted) break
        const record = upstreamRecords[i]
        const filename = (record.filename as string | undefined) || (record.title as string | undefined) || `record-${i}`

        setLiveFile(filename)
        setLiveProgress(`${i + 1}/${upstreamRecords.length}`)
        setLiveTokens('')

        // Resolve content for template substitution.
        // Image records: use empty string — the actual pixels are sent via the
        // `images` field on the Ollama message, not as text.  Putting the raw
        // base64 data URL into {{content}} produces a multi-MB text blob that
        // the model can't interpret.
        const isImageRecord = record.contentType === 'image'
        const baseContent = isImageRecord
          ? ''
          : (record.content as string | undefined) ??
            (record.description as string | undefined) ??
            JSON.stringify(record)

        const recordForTemplate: Record<string, unknown> = { ...record, content: baseContent }
        const renderedPrompt = renderTemplate(promptTemplate, recordForTemplate)

        // Build messages
        const userMessage: Record<string, unknown> = {
          role: 'user',
          content: renderedPrompt,
        }

        // For vision models with image content, include base64 image
        if (isVisionModel && record.contentType === 'image' && typeof record.content === 'string') {
          const base64 = record.content.replace(/^data:[^;]+;base64,/, '')
          userMessage.images = [base64]
        }

        const body = JSON.stringify({
          model: selectedModel,
          stream: true,
          options: {
            temperature,
            num_predict: maxTokens,
          },
          messages: [
            { role: 'system', content: systemPrompt },
            userMessage,
          ],
        })

        let accumulated = ''

        const res = await fetch(OLLAMA_CHAT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal,
        })

        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
        if (!res.body) throw new Error('No response body')

        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer    = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const chunk = JSON.parse(line) as {
                message?: { content?: string }
                done?: boolean
              }
              if (chunk.message?.content) {
                accumulated += chunk.message.content
                // Throttle preview updates to last 200 chars
                setLiveTokens(accumulated.slice(-200))
              }
            } catch {
              // Malformed chunk — skip
            }
          }
        }

        enriched.push({
          ...record,
          ollamaModel:       selectedModel,
          ollamaPrompt:      renderedPrompt,
          ollamaResponse:    accumulated,
          ollamaProcessedAt: new Date().toISOString(),
        })

        // Update progress in node data
        updateNodeData(id, {
          statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…`,
          outputCount:   enriched.length,
        })
      }

      setLiveFile('')
      setLiveTokens('')
      setLiveProgress('')

      const version = setNodeResults(id, enriched)
      updateNodeData(id, {
        status:         'success',
        statusMessage:  `✓ ${enriched.length} records processed`,
        inputCount:     upstreamRecords.length,
        outputCount:    enriched.length,
        resultsVersion: version,
      })
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        setLiveFile('')
        setLiveTokens('')
        setLiveProgress('')
        if (enriched.length > 0) setNodeResults(id, enriched)
        updateNodeData(id, {
          status:        'idle',
          statusMessage: 'Cancelled',
          outputCount:   enriched.length,
        })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Ollama] error', msg)
      setLiveFile('')
      setLiveTokens('')
      setLiveProgress('')
      if (enriched.length > 0) setNodeResults(id, enriched)
      updateNodeData(id, {
        status:        'error',
        statusMessage: `✗ ${msg}`,
        outputCount:   enriched.length,
      })
    }
  }, [
    id, updateNodeData, upstreamRecords, selectedModel,
    systemPrompt, promptTemplate, temperature, maxTokens, isVisionModel,
  ])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const status      = d.status ?? 'idle'
  const borderColor = STATUS_BORDER[status as string] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Left data input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="data"
        style={{ ...styles.inputHandle, top: 16 }}
      />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Ollama LLM</span>
        {d.statusMessage ? (
          <span style={{
            fontSize: 10, fontWeight: 600, color: '#c7d2fe',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      {/* Ollama not reachable warning */}
      {ollamaOk === false && (
        <div style={styles.warnBanner}>
          ⚠ Cannot reach Ollama at localhost:11434 — is it running?
        </div>
      )}

      {/* Vision / image mismatch warning */}
      {showVisionWarn && (
        <div style={{ ...styles.warnBanner, background: '#fffbeb', borderColor: '#fcd34d', color: '#78350f' }}>
          ⚠ Selected model may not support images — switch to a vision model (llava etc.) for image inputs.
        </div>
      )}

      <div style={styles.body}>
        {/* Model selector */}
        <div style={styles.row}>
          <span style={styles.label}>Model</span>
          {models.length > 0 ? (
            <select
              style={styles.select}
              value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })}
              className="nodrag"
            >
              {models.map(m => (
                <option key={m.name} value={m.name}>
                  {m.isVision ? '👁 ' : ''}{m.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              style={styles.input}
              value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })}
              placeholder={ollamaOk === false ? 'offline' : 'model name…'}
              className="nodrag"
            />
          )}
        </div>

        {/* Vision override */}
        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={isVisionModel}
            onChange={e => updateNodeData(id, { visionOverride: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          <span>Vision model</span>
          {visionByName && (
            <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>(auto-detected)</span>
          )}
        </label>

        {/* System prompt */}
        <div style={styles.colField}>
          <span style={styles.label}>System prompt</span>
          <textarea
            style={styles.textarea}
            value={systemPrompt as string}
            onChange={e => updateNodeData(id, { systemPrompt: e.target.value })}
            rows={2}
            className="nodrag"
          />
        </div>

        {/* User prompt template */}
        <div style={styles.colField}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={styles.label}>Prompt template</span>
            {availableFields.length > 0 && (
              <button
                style={styles.linkBtn}
                onClick={() => setShowFields(f => !f)}
                className="nodrag"
              >
                {showFields ? '▲ fields' : '▼ fields'}
              </button>
            )}
          </div>
          {showFields && availableFields.length > 0 && (
            <div style={styles.fieldHints}>
              {availableFields.map(f => (
                <code key={f} style={styles.fieldChip}>{'{{' + f + '}}'}</code>
              ))}
            </div>
          )}
          <textarea
            style={{ ...styles.textarea, minHeight: 64 }}
            value={promptTemplate as string}
            onChange={e => updateNodeData(id, { userPromptTemplate: e.target.value })}
            rows={4}
            className="nodrag"
          />
        </div>

        {/* Temperature + max tokens */}
        <div style={styles.row}>
          <span style={styles.label}>Temp</span>
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={temperature as number}
            onChange={e => updateNodeData(id, { temperature: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
            className="nodrag"
          />
          <span style={{ fontSize: 10, color: '#6b7280', width: 28, textAlign: 'right' }}>
            {(temperature as number).toFixed(2)}
          </span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Tokens</span>
          <input
            type="text"
            style={{ ...styles.input, width: 70 }}
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(tokenInput, 10)
              if (Number.isFinite(n)) {
                updateNodeData(id, { maxTokens: n })
              } else {
                setTokenInput(String(maxTokens))
              }
            }}
            placeholder="-1"
            className="nodrag"
          />
        </div>

        {/* Live streaming preview */}
        {isRunning && (liveFile || liveTokens) && (
          <div style={styles.livePreview}>
            <div style={styles.liveHeader}>
              <span>⚙ {liveProgress} — {liveFile}</span>
            </div>
            {liveTokens && (
              <div style={styles.liveText}>…{liveTokens}</div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        {isRunning ? (
          <button style={{ ...styles.btn, background: '#dc2626' }} onClick={handleCancel} className="nodrag">
            ✕ Cancel
          </button>
        ) : (
          <button
            style={{
              ...styles.btn,
              background: BTN_COLOR,
              opacity: (ollamaOk === false || !selectedModel) ? 0.4 : 1,
            }}
            onClick={handleRun}
            disabled={ollamaOk === false || !selectedModel}
            className="nodrag"
          >
            ▶ Run
          </button>
        )}
      </div>

      {/* Right output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={styles.outputHandle}
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 280,
    maxWidth: 320,
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
  headerTitle: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  warnBanner: {
    fontSize: 10,
    padding: '5px 10px',
    background: '#fef2f2',
    borderBottom: '1px solid #fecaca',
    color: '#991b1b',
    lineHeight: 1.4,
  },
  body: {
    padding: '10px 12px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 7,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  colField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  label: {
    fontSize: 11,
    color: '#6b7280',
    width: 44,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    flex: 1,
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
  },
  input: {
    flex: 1,
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
  },
  textarea: {
    width: '100%',
    fontSize: 11,
    padding: '4px 6px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    resize: 'vertical' as const,
    fontFamily: 'monospace',
    lineHeight: 1.4,
    boxSizing: 'border-box' as const,
  },
  fieldHints: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 3,
    padding: '3px 0',
  },
  fieldChip: {
    fontSize: 10,
    background: '#ede9fe',
    color: '#5b21b6',
    padding: '1px 5px',
    borderRadius: 3,
    cursor: 'default',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#374151',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  linkBtn: {
    fontSize: 10,
    color: '#6d28d9',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  livePreview: {
    marginTop: 2,
    background: '#1e1e2e',
    borderRadius: 4,
    overflow: 'hidden',
    border: '1px solid #3730a3',
  },
  liveHeader: {
    fontSize: 10,
    color: '#a5b4fc',
    padding: '3px 6px',
    background: '#1e1b4b',
    fontFamily: 'monospace',
  },
  liveText: {
    fontSize: 10,
    color: '#e2e8f0',
    padding: '4px 6px',
    fontFamily: 'monospace',
    lineHeight: 1.5,
    maxHeight: 60,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  btn: {
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  inputHandle: {
    width: 8,
    height: 8,
    background: '#6366f1',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #6366f1',
    position: 'absolute' as const,
    left: -5,
    borderRadius: '50%',
  },
  outputHandle: {
    width: 10,
    height: 10,
    background: '#22c55e',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
  },
}
