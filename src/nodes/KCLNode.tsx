/**
 * KCLNode — transform node that sends records to KCL's OpenAI-compatible
 * inference API (https://api.ai.create.kcl.ac.uk/v1) via the Vite dev proxy
 * (/kcl-proxy → https://api.ai.create.kcl.ac.uk).
 *
 * Accepts FileRecord[] or UnifiedRecord[] upstream. Emits input records
 * enriched with kclModel, kclPrompt, kclResponse, and kclProcessedAt.
 *
 * API key is stored in node data (same pattern as EuropeanaSearch).
 * Streaming uses the OpenAI SSE format: `data: {...}\n\n` / `data: [DONE]`.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Handle, Position, useReactFlow, useNodes, useEdges, NodeProps } from '@xyflow/react'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'
import { filterKCLModels, APEX_MODEL, getContentMaxChars } from '../utils/kclConfig'
import { renderTemplate } from '../utils/promptTemplates'
import { useStaleResults } from '../hooks/useStaleResults'
import { usePromptRecipes } from '../hooks/usePromptRecipes'
import { PromptRecipeBar } from '../components/PromptRecipeBar'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KCLNodeData {
  apiKey: string
  model: string
  systemPrompt: string
  userPromptTemplate: string
  temperature: number
  maxTokens: number
  visionMode: boolean
  imageField: string   // specific field name, or '' for auto-detect
  status: 'idle' | 'running' | 'success' | 'error'
  statusMessage: string
  results: unknown[] | undefined
  inputCount: number
  outputCount: number
  [key: string]: unknown
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; format: string } }

const IMAGE_MAX_DIM = 1280

function resizeDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      if (w <= IMAGE_MAX_DIM && h <= IMAGE_MAX_DIM) { resolve(dataUrl); return }
      const scale  = IMAGE_MAX_DIM / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('Image load failed for resize'))
    img.src = dataUrl
  })
}

/** Build the user message content — plain string or multi-part array when a record has an image. */
async function buildUserContent(
  textPrompt: string,
  record: Record<string, unknown>,
  imageField: string,
): Promise<string | ContentPart[]> {
  let imageUrl: string | null = null
  if (imageField) {
    const val = record[imageField]
    if (typeof val === 'string' && val.startsWith('data:image/')) imageUrl = val
  } else {
    if (record.contentType === 'image' && typeof record.content === 'string') {
      imageUrl = record.content as string
    } else {
      for (const val of Object.values(record)) {
        if (typeof val === 'string' && val.startsWith('data:image/')) { imageUrl = val; break }
      }
    }
  }
  if (!imageUrl) return textPrompt
  imageUrl = await resizeDataUrl(imageUrl)
  const mimeMatch = /^data:(image\/[^;]+);base64,/.exec(imageUrl)
  const format    = mimeMatch?.[1] ?? (record.mimeType as string | undefined) ?? 'image/jpeg'
  return [
    { type: 'text',      text:      textPrompt },
    { type: 'image_url', image_url: { url: imageUrl, format } },
  ]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_MODELS = '/kcl-proxy/v1/models'
const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'

const HEADER_COLOR = '#881337'  // rose-900 — KCL red
const BTN_COLOR    = '#be123c'  // rose-700

const DEFAULT_SYSTEM = 'You are a research assistant helping to analyse humanities research documents and data.'
const DEFAULT_PROMPT = 'Summarise the key themes and subjects in 3-4 sentences:\n\n{{content}}'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── Non-streaming KCL API helper ──────────────────────────────────────────────

async function kclChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string | ContentPart[],
  temperature: number,
  maxTokens: number,
  signal: AbortSignal,
): Promise<{ text: string; resolvedModel: string }> {
  const res = await fetch(KCL_CHAT, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream:      false,
      temperature,
      max_tokens:  maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent },
      ],
    }),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const json = await res.json() as {
    model?: string
    choices?: Array<{ message?: { content?: string } }>
  }
  return {
    text:          json.choices?.[0]?.message?.content ?? '',
    resolvedModel: json.model ?? model,
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function KCLNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as KCLNodeData

  const [models, setModels]   = useState<string[]>([])
  const [apiOk, setApiOk]     = useState<boolean | null>(null)
  const [showFields, setShowFields] = useState(false)
  const [tokenInput, setTokenInput]     = useState(String((d.maxTokens as number | undefined) ?? 32768))
  const abortRef       = useRef<AbortController | null>(null)
  const apexClickCount = useRef(0)
  const apexClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apexUnlocked   = !!(d.apexUnlocked as boolean | undefined)

  // ── Resolve apiKey — inline field or connected Param node ───────────────────

  const isApiKeyConnected = allEdges.some(e => e.target === id && e.targetHandle === 'apiKey')

  const effectiveApiKey = useMemo(() => {
    if (!isApiKeyConnected) return (d.apiKey as string | undefined) ?? ''
    const edge = allEdges.find(e => e.target === id && e.targetHandle === 'apiKey')
    if (!edge) return ''
    return (allNodes.find(n => n.id === edge.source)?.data as { value?: string } | undefined)?.value ?? ''
  }, [allEdges, allNodes, id, isApiKeyConnected, d.apiKey])

  // ── Fetch available models on mount (or when effectiveApiKey changes) ────────

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
        const ids = filterKCLModels((json.data ?? []).map(m => m.id), apexUnlocked).sort()
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

  // ── Derived state ─────────────────────────────────────────────────────────────

  const apiKey         = (d.apiKey        ?? '') as string  // raw inline value (for the input field)
  const selectedModel  = (d.model         ?? '') as string
  const systemPrompt   = (d.systemPrompt  ?? DEFAULT_SYSTEM) as string
  const promptTemplate = (d.userPromptTemplate ?? DEFAULT_PROMPT) as string
  const temperature    = (d.temperature   ?? 0.7) as number
  const maxTokens      = (d.maxTokens     ?? 32768) as number
  const isRunning      = d.status === 'running'

  useEffect(() => { setTokenInput(String(maxTokens)) }, [maxTokens])

  const sampleRecord    = upstreamRecords[0]
  const availableFields = sampleRecord
    ? Object.keys(sampleRecord).filter(k => {
        const v = sampleRecord[k]
        return v !== null && typeof v !== 'object'
      })
    : []

  // Fields in upstream records that contain image data URLs
  const imageFields = useMemo<string[]>(() => {
    if (!sampleRecord) return []
    return Object.entries(sampleRecord)
      .filter(([, v]) => typeof v === 'string' && (v as string).startsWith('data:image/'))
      .map(([k]) => k)
  }, [sampleRecord])

  const hasImages    = imageFields.length > 0
  const visionMode   = (d.visionMode  as boolean | undefined) ?? false
  const imageField   = (d.imageField  as string  | undefined) ?? ''

  const isStale = useStaleResults(d.status as string, {
    model: selectedModel, systemPrompt, userPromptTemplate: promptTemplate,
    temperature, maxTokens, visionMode, imageField,
  })

  const { recipes, saveRecipe, deleteRecipe } = usePromptRecipes()

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
    if (upstreamRecords.length === 0) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No upstream records' })
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

    const enriched: Record<string, unknown>[] = []

    try {
      for (let i = 0; i < upstreamRecords.length; i++) {
        if (signal.aborted) break
        const record = upstreamRecords[i]

        updateNodeData(id, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

        const rawContent = visionMode
          ? (record.description as string | undefined) ?? (record.title as string | undefined) ?? ''
          : (record.content     as string | undefined) ??
            (record.description as string | undefined) ??
            JSON.stringify(record)
        const maxChars = getContentMaxChars(selectedModel)
        const baseContent = rawContent.slice(0, maxChars)

        const renderedPrompt = renderTemplate(promptTemplate, { ...record, content: baseContent })
        const userContent    = visionMode
          ? await buildUserContent(renderedPrompt, record, imageField)
          : renderedPrompt

        const { text: response, resolvedModel } = await kclChat(
          effectiveApiKey, selectedModel, systemPrompt, userContent,
          temperature, maxTokens, signal,
        )

        enriched.push({
          ...record,
          kclModel:         selectedModel,
          kclModelResolved: resolvedModel,
          kclPrompt:        renderedPrompt,
          kclResponse:      response,
          kclProcessedAt:   new Date().toISOString(),
        })
      }

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
        if (enriched.length > 0) setNodeResults(id, enriched)
        updateNodeData(id, { status: 'idle', statusMessage: 'Cancelled', outputCount: enriched.length })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (enriched.length > 0) setNodeResults(id, enriched)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}`, outputCount: enriched.length })
    }
  }, [id, updateNodeData, upstreamRecords, effectiveApiKey, selectedModel, systemPrompt, promptTemplate, temperature, maxTokens])

  const handleCancel = useCallback(() => { abortRef.current?.abort() }, [])

  const status      = (d.status ?? 'idle') as string
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  const noKey    = !effectiveApiKey
  const canRun   = !noKey && !!selectedModel && !isRunning

  return (
    <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data"   style={{ ...styles.inputHandle, top: 16 }} />
      <Handle type="target" position={Position.Left} id="apiKey" style={{ ...styles.inputHandle, top: 53, background: isApiKeyConnected ? '#3b82f6' : '#be123c', boxShadow: `0 0 0 1px ${isApiKeyConnected ? '#3b82f6' : '#be123c'}` }} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>KCL Inference</span>
        {isRunning && <span className="node-spinner" />}
        {!isRunning && isStale && (
          <span style={styles.staleBadge}>⟳ settings changed</span>
        )}
        {!isRunning && !isStale && d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {/* API key warning */}
      {noKey && (
        <div style={styles.warnBanner}>
          ⚠ No API key configured — rebuild with VITE_KCL_API_KEY set
        </div>
      )}
      {!noKey && apiOk === false && (
        <div style={styles.warnBanner}>
          ⚠ Could not reach KCL API — check your key or VPN connection
        </div>
      )}

      <div style={styles.body}>
        {/* API key — display-only, never shows the actual value */}
        <div style={styles.row}>
          <span style={styles.label}>Key</span>
          <span style={{
            ...styles.input,
            display: 'flex', alignItems: 'center',
            color: isApiKeyConnected ? '#1d4ed8' : apiKey ? '#15803d' : '#dc2626',
            background: isApiKeyConnected ? '#eff6ff' : apiKey ? '#f0fdf4' : '#fef2f2',
            userSelect: 'none',
          }}>
            {isApiKeyConnected ? '(from Param)' : apiKey ? '🔒 Configured' : '⚠ Not set'}
          </span>
        </div>

        {/* Model — triple-click label to unlock arc:apex */}
        <div style={styles.row}>
          <span
            style={{ ...styles.label, cursor: 'default', userSelect: 'none' as const }}
            className="nodrag"
            onClick={() => {
              apexClickCount.current += 1
              if (apexClickTimer.current) clearTimeout(apexClickTimer.current)
              apexClickTimer.current = setTimeout(() => { apexClickCount.current = 0 }, 600)
              if (apexClickCount.current >= 3) {
                apexClickCount.current = 0
                updateNodeData(id, { apexUnlocked: !apexUnlocked })
              }
            }}
          >Model{apexUnlocked ? ' ✦' : ''}</span>
          {models.length > 0 ? (
            <select
              style={styles.select}
              value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })}
              className="nodrag"
            >
              {models.map(m => <option key={m} value={m}>{m}</option>)}
              {apexUnlocked && !models.includes(APEX_MODEL) && (
                <option key={APEX_MODEL} value={APEX_MODEL}>{APEX_MODEL}</option>
              )}
            </select>
          ) : (
            <input
              style={styles.input}
              value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })}
              placeholder="arc:nano"
              className="nodrag"
            />
          )}
        </div>

        {/* Prompt recipes bar */}
        <PromptRecipeBar
          nodeFamily="standard"
          recipes={recipes}
          onApply={r => updateNodeData(id, { systemPrompt: r.systemPrompt, userPromptTemplate: r.userPromptTemplate })}
          onSave={name => saveRecipe({ name, nodeFamily: 'standard', systemPrompt, userPromptTemplate: promptTemplate })}
          onDelete={deleteRecipe}
        />

        {/* System prompt */}
        <div style={styles.colField}>
          <span style={styles.label}>System</span>
          <textarea
            style={styles.textarea}
            value={systemPrompt}
            onChange={e => updateNodeData(id, { systemPrompt: e.target.value })}
            rows={2}
            className="nodrag"
          />
        </div>

        {/* User prompt template */}
        <div style={styles.colField}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={styles.label}>Prompt</span>
            {availableFields.length > 0 && (
              <button style={styles.linkBtn} onClick={() => setShowFields(f => !f)} className="nodrag">
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
            value={promptTemplate}
            onChange={e => updateNodeData(id, { userPromptTemplate: e.target.value })}
            rows={4}
            className="nodrag"
          />
        </div>

        {/* Vision mode — shown when upstream records contain image data */}
        {(hasImages || visionMode) && (
          <div style={styles.visionSection}>
            <div style={styles.row}>
              <span style={styles.label}>Vision</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }} className="nodrag">
                <input
                  type="checkbox"
                  checked={visionMode}
                  onChange={e => updateNodeData(id, { visionMode: e.target.checked })}
                />
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {hasImages ? 'Include image with prompt' : 'Vision mode (no images detected)'}
                </span>
              </label>
            </div>
            {visionMode && imageFields.length > 1 && (
              <div style={styles.row}>
                <span style={styles.label}>Image</span>
                <select
                  style={styles.select}
                  value={imageField}
                  onChange={e => updateNodeData(id, { imageField: e.target.value })}
                  className="nodrag"
                >
                  <option value="">auto-detect</option>
                  {imageFields.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Temperature */}
        <div style={styles.row}>
          <span style={styles.label}>Temp</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={temperature}
            onChange={e => updateNodeData(id, { temperature: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
            className="nodrag"
          />
          <span style={styles.numLabel}>{temperature.toFixed(2)}</span>
        </div>

        {/* Max tokens */}
        <div style={styles.row}>
          <span style={styles.label}>Tokens</span>
          <input
            type="text"
            style={{ ...styles.input, width: 70 }}
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(tokenInput, 10)
              if (Number.isFinite(n)) updateNodeData(id, { maxTokens: n })
              else setTokenInput(String(maxTokens))
            }}
            placeholder="32768"
            className="nodrag"
          />
        </div>

      </div>

      {/* Footer */}
      <div style={styles.footer}>
        {isRunning ? (
          <button style={{ ...styles.btn, background: '#dc2626' }} onClick={handleCancel} className="nodrag">
            ✕ Cancel
          </button>
        ) : (
          <button
            style={{ ...styles.btn, background: BTN_COLOR, opacity: canRun ? 1 : 0.4 }}
            onClick={handleRun}
            disabled={!canRun}
            className="nodrag"
          >
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
  headerStatus: {
    fontSize: 10,
    fontWeight: 600,
    color: '#fecdd3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  staleBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: '#fbbf24',
    background: 'rgba(0,0,0,0.25)',
    borderRadius: 3,
    padding: '1px 5px',
    whiteSpace: 'nowrap' as const,
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
  eyeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    padding: '0 2px',
    flexShrink: 0,
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
    background: '#ffe4e6',
    color: '#9f1239',
    padding: '1px 5px',
    borderRadius: 3,
    cursor: 'default',
  },
  linkBtn: {
    fontSize: 10,
    color: '#9f1239',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  numLabel: {
    fontSize: 10,
    color: '#6b7280',
    width: 28,
    textAlign: 'right' as const,
  },
  visionSection: {
    background:   '#fdf4ff',
    border:       '1px solid #e9d5ff',
    borderRadius: 5,
    padding:      '5px 8px',
    display:      'flex',
    flexDirection: 'column' as const,
    gap:          5,
  },
  livePreview: {
    marginTop: 2,
    background: '#1e1e2e',
    borderRadius: 4,
    overflow: 'hidden',
    border: '1px solid #881337',
  },
  liveHeader: {
    fontSize: 10,
    color: '#fda4af',
    padding: '3px 6px',
    background: '#4c0519',
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
    overflowX: 'hidden' as const,
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
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
    background: '#be123c',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #be123c',
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
