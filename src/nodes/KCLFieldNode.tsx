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
import { Handle, Position, NodeResizer, useReactFlow, useNodes, useEdges, NodeProps } from '@xyflow/react'
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'
import { filterKCLModels, APEX_MODEL, getContentMaxChars, MAX_IMAGES_PER_CALL, DEFAULT_IMAGE_SEND_DIM, DEFAULT_IMAGE_SEND_SIZE } from '../utils/kclConfig'
import { imagePartFor, collectImageParts, imageListText, recordLabel, type ContentPart } from '../utils/kclVision'
import { useStaleResults } from '../hooks/useStaleResults'
import { usePromptRecipes } from '../hooks/usePromptRecipes'
import { PromptRecipeBar } from '../components/PromptRecipeBar'
import { SYSTEM_PROMPT_FLAVOURS } from '../utils/promptStarters'
import { formatDuration } from '../utils/formatDuration'
import { renderFieldTemplateAggregate, renderFieldTemplatePerRecord } from '../utils/promptTemplates'
import { aggregateFieldValues, DEFAULT_AGGREGATE_PROMPT } from '../utils/aggregateValues'
import { getFieldByPath } from '../utils/fieldPath'
import { collectFieldPaths, type FieldPathInfo } from '../utils/fieldPaths'
import type { UnifiedRecord } from '../types/UnifiedRecord'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KCLFieldNodeData {
  apiKey: string
  model: string
  selectedField: string
  outputField?: string
  mode: 'per-record' | 'aggregate'
  /** 'image' sends the field's images (thumbnails, IIIF services, data URLs) to the vision model instead of its text. */
  inputKind?: 'text' | 'image'
  /** Aggregate image mode: how many images go into the one call (default MAX_IMAGES_PER_CALL). */
  maxImages?: number
  /** Aggregate text mode: head each value with "id: <id> · title (Source)" so the model can cite records (default true). */
  labelValues?: boolean
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

const HEADER_COLOR = '#6f2f2f'  // red-900 — slightly darker than KCLNode
const BTN_COLOR    = '#be123c'

const DEFAULT_SYSTEM     = 'You are a research assistant helping to analyse humanities research data.'
const DEFAULT_PROMPT_PER = 'Summarise the following in 2–3 sentences:\n\n{{value}}'
const imageOpts = { maxDim: DEFAULT_IMAGE_SEND_DIM, size: DEFAULT_IMAGE_SEND_SIZE }

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d6ccb5',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── Streaming KCL API helper ──────────────────────────────────────────────

async function kclChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string | ContentPart[],
  temperature: number,
  maxTokens: number,
  signal: AbortSignal,
  onToken?: (token: string) => void,
): Promise<string> {
  const res = await fetch(KCL_CHAT, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream:      !!onToken,  // stream if onToken callback provided
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

  if (!onToken) {
    // Non-streaming path
    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return json.choices?.[0]?.message?.content ?? ''
  }

  // Streaming path: parse SSE
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let accumulated = ''
  let fullText = ''
  let done = false

  while (!done) {
    const { value, done: readerDone } = await reader.read()
    if (value) {
      accumulated += decoder.decode(value, { stream: true })
      const lines = accumulated.split('\n')
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim()
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') { done = true; break }
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const token = parsed.choices?.[0]?.delta?.content ?? ''
            if (token) {
              fullText += token
              onToken(token)
            }
          } catch { /* ignore parse errors */ }
        }
      }
      accumulated = lines[lines.length - 1]
    }
    if (readerDone) done = true
  }
  return fullText
}

// ── Component ──────────────────────────────────────────────────────────────────

export function KCLFieldNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as KCLFieldNodeData

  const [models, setModels]         = useState<string[]>([])
  const [apiOk, setApiOk]           = useState<boolean | null>(null)
  const [tokenInput, setTokenInput] = useState(String((d.maxTokens as number | undefined) ?? 32768))
  const [liveTokens, setLiveTokens] = useState('')
  const [modelHint, setModelHint]   = useState<string | null>(null)
  const abortRef       = useRef<AbortController | null>(null)
  const apexClickCount = useRef(0)
  const apexClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apexUnlocked   = !!(d.apexUnlocked as boolean | undefined)
  const systemRef      = useRef<HTMLTextAreaElement | null>(null)
  const promptRef      = useRef<HTMLTextAreaElement | null>(null)

  const systemPromptVal   = (d.systemPrompt        ?? '') as string
  const promptTemplateVal = (d.userPromptTemplate  ?? '') as string
  useAutoGrowTextarea(systemRef, systemPromptVal, 40)
  useAutoGrowTextarea(promptRef, promptTemplateVal, 56)

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

  // Every scalar/array path across all connected sources, one level into
  // namespaces (vam.objectType, europeana.thumbnail) — see fieldPaths.ts.
  const fieldPaths = useMemo<FieldPathInfo[]>(() => collectFieldPaths(upstreamRecords as UnifiedRecord[]), [upstreamRecords])
  const availableFields = useMemo(() => fieldPaths.map(f => f.path), [fieldPaths])
  const fieldGroups = useMemo(() => {
    const groups = new Map<string, FieldPathInfo[]>()
    for (const f of fieldPaths) {
      const g = f.path.includes('.') ? f.path.split('.')[0] : 'Record fields'
      groups.set(g, [...(groups.get(g) ?? []), f])
    }
    return [...groups.entries()]
  }, [fieldPaths])

  // ── Derived state ─────────────────────────────────────────────────────────────

  const apiKey         = (d.apiKey        ?? '') as string
  const selectedModel  = (d.model         ?? '') as string
  const selectedField  = (d.selectedField ?? availableFields[0] ?? '') as string
  const outputField    = (d.outputField  ?? '') as string
  const mode           = (d.mode ?? 'per-record') as 'per-record' | 'aggregate'
  // Input kind: explicit choice wins; otherwise an image-kind field defaults to image input.
  const selectedKind   = fieldPaths.find(f => f.path === selectedField)?.kind
  const inputKind      = ((d.inputKind as string | undefined) ?? (selectedKind === 'image' ? 'image' : 'text')) as 'text' | 'image'
  const maxImages      = Math.max(1, Number(d.maxImages ?? MAX_IMAGES_PER_CALL) || MAX_IMAGES_PER_CALL)
  const labelValues    = (d.labelValues as boolean | undefined) ?? true
  const systemPrompt   = (d.systemPrompt  ?? DEFAULT_SYSTEM) as string
  const promptTemplate = (d.userPromptTemplate ?? (mode === 'aggregate' ? DEFAULT_AGGREGATE_PROMPT : DEFAULT_PROMPT_PER)) as string
  // Aggregate mode substitutes only {{values}}/{{value}}/{{field}}/{{count}}; any other token is sent as literal text.
  const strayAggregateToken = mode === 'aggregate'
    ? (promptTemplate.match(/\{\{(?!(?:values|value|field|count)\}\})[\w.]+\}\}/)?.[0] ?? null)
    : null
  const temperature    = (d.temperature   ?? 0.7) as number
  const maxTokens      = (d.maxTokens     ?? 32768) as number
  const isRunning = d.status === 'running'

  const isStale = useStaleResults(d.status as string, {
    model: selectedModel, systemPrompt, userPromptTemplate: promptTemplate,
    temperature, maxTokens, mode, selectedField, inputKind, maxImages,
  })

  const { recipes, saveRecipe, deleteRecipe } = usePromptRecipes()

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

    const t0 = performance.now()

    try {
      if (mode === 'aggregate') {
        const maxChars = getContentMaxChars(selectedModel)
        let userContent: string | ContentPart[]
        let prompt: string
        let aggregatedFrom = upstreamRecords.length
        let aggregatedOf = ''
        let imageNote = ''

        if (inputKind === 'image') {
          updateNodeData(id, { statusMessage: `Fetching up to ${maxImages} images…` })
          const batch = await collectImageParts(upstreamRecords, selectedField, maxImages, imageOpts)
          if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          if (batch.parts.length === 0) {
            throw new Error(`No image could be loaded from ${selectedField}${batch.failures.length ? ` (${batch.failures[0]})` : ''}`)
          }
          const list = imageListText(batch.records)
          prompt = renderFieldTemplateAggregate(promptTemplate, { values: list, field: selectedField, count: batch.parts.length })
          userContent = [{ type: 'text', text: `${prompt}\n\n${list}` }, ...batch.parts]
          aggregatedFrom = batch.parts.length
          const available = batch.parts.length + batch.failures.length + batch.skipped
          imageNote = ` — ${batch.parts.length} of ${available} images sent${batch.failures.length ? `, ${batch.failures.length} failed` : ''}`
        } else {
          const agg = aggregateFieldValues(upstreamRecords, selectedField, { label: labelValues, maxChars })
          prompt = renderFieldTemplateAggregate(promptTemplate, { values: agg.values, field: selectedField, count: agg.included })
          userContent = prompt
          aggregatedFrom = agg.included
          if (agg.included !== agg.total) aggregatedOf = ` of ${agg.total}`
        }

        setLiveTokens('')
        updateNodeData(id, { statusMessage: 'Sending aggregate prompt…' })

        const callT0 = performance.now()
        const response = await kclChat(
          effectiveApiKey, selectedModel, systemPrompt, userContent,
          temperature, maxTokens, signal, (token) => setLiveTokens(t => (t + token).slice(-200))
        )
        const inferenceMs = Math.round(performance.now() - callT0)

        const resultRecord = {
          id:                  `kcl-agg-${Date.now()}`,
          _source:             'kclField',
          title:               `${selectedField} — aggregate summary`,
          kclModel:            selectedModel,
          kclField:            selectedField,
          kclMode:             'aggregate',
          kclInputKind:        inputKind,
          kclAggregatedFrom:   aggregatedFrom,
          kclPrompt:           prompt,
          kclResponse:         response,
          inferenceMs,
          ...(outputField ? { [outputField]: response } : {}),
          kclProcessedAt:      new Date().toISOString(),
        }

        const version = setNodeResults(id, [resultRecord])
        const elapsedMs = Math.round(performance.now() - t0)
        setLiveTokens('')
        updateNodeData(id, {
          status:         'success',
          statusMessage:  `✓ Aggregate summary (${aggregatedFrom}${aggregatedOf} records) in ${formatDuration(elapsedMs)}${imageNote}`,
          outputCount:    1,
          resultsVersion: version,
          elapsedMs,
        })

      } else {
        const enriched: Record<string, unknown>[] = []
        const maxChars = getContentMaxChars(selectedModel)

        for (let i = 0; i < upstreamRecords.length; i++) {
          if (signal.aborted) break
          const record = upstreamRecords[i]
          const rawVal = getFieldByPath(record, selectedField)
          // Image input: the prompt talks ABOUT the record, so {{value}} is its
          // title; the image itself travels as a content part.
          const value  = inputKind === 'image'
            ? recordLabel(record)
            : (Array.isArray(rawVal) ? rawVal.join('; ') : String(rawVal ?? '').trim()).slice(0, maxChars)

          setLiveTokens('')
          updateNodeData(id, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

          const prompt = renderFieldTemplatePerRecord(promptTemplate, {
            value, field: selectedField, record,
          })

          const callT0 = performance.now()
          let response: string
          let userContent: string | ContentPart[] = prompt
          let imageMissing: string | null = null
          if (inputKind === 'image') {
            try {
              const part = await imagePartFor(selectedField, rawVal, imageOpts)
              if (!part) imageMissing = `no image in ${selectedField}`
              else userContent = [{ type: 'text', text: prompt }, part]
            } catch (err) {
              imageMissing = err instanceof Error ? err.message : String(err)
            }
          }
          if (signal.aborted) break
          if (imageMissing) {
            // Image could not be loaded — not an API failure, the run goes on
            response = `[image unavailable: ${imageMissing}]`
          } else {
            response = await kclChat(
              effectiveApiKey, selectedModel, systemPrompt, userContent,
              temperature, maxTokens, signal, (token) => setLiveTokens(t => (t + token).slice(-200))
            )
          }
          const inferenceMs = Math.round(performance.now() - callT0)

          const enrichedRecord = {
            ...record,
            kclModel:       selectedModel,
            kclField:       selectedField,
            kclMode:        'per-record',
            kclInputKind:   inputKind,
            kclPrompt:      prompt,
            kclResponse:    response,
            inferenceMs,
            ...(outputField ? { [outputField]: response } : {}),
            kclProcessedAt: new Date().toISOString(),
          }
          enriched.push(enrichedRecord)

          // Partial results: write each record to store as it completes
          // NOTE: must NOT set resultsVersion: 0 here (gotcha #21)
          const version = setNodeResults(id, [...enriched])
          updateNodeData(id, {
            outputCount: enriched.length,
            resultsVersion: version,
            statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…`,
          })
        }

        // NOTE: do NOT set resultsVersion here (gotcha #21)
        const elapsedMs = Math.round(performance.now() - t0)
        setLiveTokens('')
        updateNodeData(id, {
          status:      'success',
          statusMessage: `✓ ${enriched.length} records processed in ${formatDuration(elapsedMs)}`,
          elapsedMs,
        })
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        updateNodeData(id, { status: 'idle', statusMessage: 'Cancelled' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [id, updateNodeData, upstreamRecords, effectiveApiKey, selectedModel, selectedField, mode, inputKind, maxImages, systemPrompt, promptTemplate, temperature, maxTokens, outputField])

  const handleCancel = useCallback(() => { abortRef.current?.abort() }, [])

  const status      = (d.status ?? 'idle') as string
  const borderColor = STATUS_BORDER[status] ?? '#d6ccb5'
  const canRun      = !!effectiveApiKey && !!selectedModel && !isRunning

  return (
    <>
      <NodeResizer
        minWidth={272} minHeight={200} maxWidth={312} isVisible={selected}
        lineStyle={{ borderColor: HEADER_COLOR }}
        handleStyle={{ background: HEADER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data"   style={{ ...styles.inputHandle, top: 16 }} />
      <Handle type="target" position={Position.Left} id="apiKey" style={{ ...styles.inputHandle, top: 53, background: isApiKeyConnected ? '#3b82f6' : '#be123c', boxShadow: `0 0 0 1px ${isApiKeyConnected ? '#3b82f6' : '#be123c'}` }} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>AI Inference (by field)</span>
        {isRunning && <span className="node-spinner" />}
        {!isRunning && isStale && (
          <span style={styles.staleBadge}>⟳ settings changed</span>
        )}
        {!isRunning && !isStale && d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {!effectiveApiKey && (
        <div style={styles.warnBanner}>⚠ No API key configured — rebuild with VITE_KCL_API_KEY set</div>
      )}
      {effectiveApiKey && apiOk === false && (
        <div style={styles.warnBanner}>⚠ Could not reach KCL API — check key or VPN</div>
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
            {isApiKeyConnected ? '(from Search Parameter)' : apiKey ? '🔒 Configured' : '⚠ Not set'}
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
            <select style={styles.select} value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })} className="nodrag">
              {models.map(m => <option key={m} value={m}>{m}</option>)}
              {apexUnlocked && !models.includes(APEX_MODEL) && (
                <option key={APEX_MODEL} value={APEX_MODEL}>{APEX_MODEL}</option>
              )}
            </select>
          ) : (
            <input style={styles.input} value={selectedModel}
              onChange={e => updateNodeData(id, { model: e.target.value })}
              placeholder="arc:nano" className="nodrag" />
          )}
        </div>

        {/* Model hint (shown when a starter recommends a model that isn't available) */}
        {modelHint && (
          <div style={styles.modelHint}>⚠ {modelHint}</div>
        )}

        {/* Field picker */}
        <div style={styles.row}>
          <span style={styles.label}>Field</span>
          {availableFields.length > 0 ? (
            <select style={styles.select} value={selectedField}
              onChange={e => updateNodeData(id, { selectedField: e.target.value })} className="nodrag"
              title="Top-level fields, then one group per namespace; (n of N) = records with a value">
              {!availableFields.includes(selectedField) && selectedField && <option value={selectedField}>{selectedField}</option>}
              {fieldGroups.map(([group, fields]) => (
                <optgroup key={group} label={group}>
                  {fields.map(f => (
                    <option key={f.path} value={f.path}>
                      {f.path} ({f.count} of {upstreamRecords.length}){f.kind === 'image' ? ' 🖼' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
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
                userPromptTemplate: newMode === 'aggregate' ? DEFAULT_AGGREGATE_PROMPT : DEFAULT_PROMPT_PER,
              })
            }} className="nodrag">
            <option value="per-record">Per record</option>
            <option value="aggregate">Aggregate all</option>
          </select>
        </div>
        {mode === 'aggregate' && inputKind !== 'image' && (
          <>
            <div style={styles.row}>
              <span style={styles.label} />
              <label style={styles.checkLabel} className="nodrag" title="Head each value with its record id so the model can cite records; untick for a pure summary of a large set">
                <input type="checkbox" checked={labelValues}
                  onChange={e => updateNodeData(id, { labelValues: e.target.checked })} />
                Label values with record id
              </label>
            </div>
            <div style={styles.imageNote}>
              {labelValues
                ? <>Each value is headed <code>id: &lt;id&gt; · title (Source)</code> so the model can cite records — paste the ids into Filter and Transform afterwards. Empty values are skipped; {'{{count}}'} is the number sent.</>
                : <>Bare values only — the model can describe the set but cannot name a record. Tick to get citable ids (≈40 chars per record).</>}
            </div>
          </>
        )}

        {/* Input kind — shown once the field looks like an image, or the user has chosen */}
        {(selectedKind === 'image' || d.inputKind !== undefined) && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>Input</span>
              <select style={styles.select} value={inputKind}
                onChange={e => updateNodeData(id, { inputKind: e.target.value as 'text' | 'image' })}
                className="nodrag" title="Image: send the field's picture(s) to the vision model; Text: send the field's value as text">
                <option value="text">Text (field value)</option>
                <option value="image">Image (send to vision model)</option>
              </select>
              {inputKind === 'image' && mode === 'aggregate' && (
                <>
                  <span style={{ ...styles.label, width: 'auto', marginLeft: 6 }}>Max</span>
                  <input type="number" min={1} max={50} style={{ ...styles.input, width: 48, flex: 'none' }} value={maxImages}
                    onChange={e => updateNodeData(id, { maxImages: Math.max(1, Math.min(50, Number(e.target.value) || MAX_IMAGES_PER_CALL)) })}
                    className="nodrag" title="Images per call; the first N records with an image are sent" />
                </>
              )}
            </div>
            {inputKind === 'image' && (
              <div style={styles.imageNote}>
                Images are fetched in the browser (partner CDNs via /image-proxy) and sent at ≤{DEFAULT_IMAGE_SEND_DIM}px.
                {mode === 'aggregate' ? ' One call carries up to “Max” images, numbered in the prompt.' : ' {{value}} is the record title.'}
              </div>
            )}
          </>
        )}

        {/* Output field name */}
        <div style={styles.row}>
          <span style={styles.label}>Output →</span>
          <input style={styles.input} value={outputField}
            onChange={e => updateNodeData(id, { outputField: e.target.value })}
            placeholder="kclResponse (default)" className="nodrag" />
        </div>
        <div style={{ fontSize: 9, color: '#b0a891', paddingLeft: 4, marginTop: -4 }}>
          New column name for the response. Blank → kclResponse only.
        </div>

        {/* Prompt recipes bar */}
        <PromptRecipeBar
          nodeFamily="field"
          mode={mode}
          recipes={recipes}
          onApply={r => {
            const patch: Record<string, unknown> = {
              systemPrompt:       r.systemPrompt,
              userPromptTemplate: r.userPromptTemplate,
            }
            if (r.mode)        patch.mode        = r.mode
            if (r.temperature !== undefined) patch.temperature = r.temperature
            if (r.model) {
              if (models.includes(r.model)) {
                patch.model = r.model
                setModelHint(null)
              } else {
                setModelHint(`recommends ${r.model} — not available`)
              }
            } else {
              setModelHint(null)
            }
            updateNodeData(id, patch)
          }}
          onSave={name => saveRecipe({ name, nodeFamily: 'field', mode, systemPrompt, userPromptTemplate: promptTemplate })}
          onDelete={deleteRecipe}
        />

        {/* Voice — system-prompt flavour picker */}
        {(() => {
          const matchedFlavour = SYSTEM_PROMPT_FLAVOURS.find(f => f.systemPrompt === systemPrompt)
          return (
            <div style={styles.row}>
              <span style={styles.label}>Voice</span>
              <select
                style={styles.select}
                value={matchedFlavour?.label ?? ''}
                onChange={e => {
                  const f = SYSTEM_PROMPT_FLAVOURS.find(fl => fl.label === e.target.value)
                  if (f) updateNodeData(id, { systemPrompt: f.systemPrompt })
                }}
                className="nodrag"
              >
                {!matchedFlavour && <option value="">— custom —</option>}
                {SYSTEM_PROMPT_FLAVOURS.map(f => (
                  <option key={f.label} value={f.label}>{f.label}</option>
                ))}
              </select>
            </div>
          )
        })()}

        {/* System prompt */}
        <div style={styles.colField}>
          <span style={styles.label}>System</span>
          <textarea ref={systemRef} style={{ ...styles.textarea, resize: 'none', overflow: 'hidden' }} value={systemPrompt}
            onChange={e => updateNodeData(id, { systemPrompt: e.target.value })}
            rows={2} className="nodrag" />
        </div>

        {/* Prompt template */}
        <div style={styles.colField}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={styles.label}>Prompt</span>
            <span style={{ fontSize: 9, color: '#b0a891', fontFamily: 'monospace' }}>
              {mode === 'aggregate' ? '{{values}} {{field}} {{count}}' : '{{value}} {{field}} {{ns.key}}'}
            </span>
          </div>
          <textarea ref={promptRef} style={{ ...styles.textarea, resize: 'none', overflow: 'hidden', minHeight: 56 }} value={promptTemplate}
            onChange={e => updateNodeData(id, { userPromptTemplate: e.target.value })}
            rows={3} className="nodrag" />
          {strayAggregateToken && (
            <div style={styles.tokenWarning}>
              ⚠ Aggregate mode substitutes only {'{{values}}'}, {'{{field}}'} and {'{{count}}'} — <code>{strayAggregateToken}</code> will be sent as literal text.
              Record fields need Per record mode; to cite records here, keep “Label values with record id” ticked.
            </div>
          )}
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
            placeholder="32768" className="nodrag" />
        </div>

      </div>

      {/* Live streaming preview */}
      {isRunning && liveTokens && (
        <div style={styles.livePreview}>
          <span style={styles.liveHeader}>Response (streaming…)</span>
          <div style={styles.liveText}>{liveTokens}</div>
        </div>
      )}

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
    </>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fffdf7',
    border: '2px solid #d6ccb5',
    borderRadius: 8,
    width: '100%',
    minWidth: 272,
    maxWidth: 312,
    boxShadow: '0 1px 4px rgba(50,42,26,0.10)',
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
  staleBadge: { fontSize: 9, fontWeight: 700, color: '#fbbf24', background: 'rgba(0,0,0,0.25)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  warnBanner: { fontSize: 10, padding: '5px 10px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', lineHeight: 1.4 },
  modelHint:  { fontSize: 9, color: '#92400e', background: '#fef3c7', borderRadius: 3, padding: '2px 6px', marginTop: -3 },
  body: { padding: '10px 12px 6px', display: 'flex', flexDirection: 'column' as const, gap: 7 },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  colField: { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  label: { fontSize: 11, color: '#8a8168', width: 44, flexShrink: 0, fontFamily: 'monospace' },
  select: { flex: 1, fontSize: 11, padding: '2px 4px', border: '1px solid #d6ccb5', borderRadius: 4, outline: 'none', height: 22 },
  input: { flex: 1, fontSize: 11, padding: '2px 5px', border: '1px solid #d6ccb5', borderRadius: 4, outline: 'none', height: 22 },
  eyeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 2px', flexShrink: 0 },
  textarea: { width: '100%', fontSize: 11, padding: '4px 6px', border: '1px solid #d6ccb5', borderRadius: 4, outline: 'none', resize: 'vertical' as const, fontFamily: 'monospace', lineHeight: 1.4, boxSizing: 'border-box' as const },
  numLabel: { fontSize: 10, color: '#8a8168', width: 28, textAlign: 'right' as const },
  imageNote: { fontSize: 9, color: '#8a8168', padding: '0 10px 4px', lineHeight: 1.4 },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#4a4a4a', cursor: 'pointer' },
  tokenWarning: { fontSize: 9, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '3px 6px', marginTop: 3, lineHeight: 1.4 },
  livePreview: { marginTop: 2, background: '#1e1e2e', borderRadius: 4, overflow: 'hidden', border: '1px solid #881337' },
  liveHeader: { fontSize: 10, color: '#fda4af', padding: '3px 6px', background: '#4c0519', fontFamily: 'monospace' },
  liveText: { fontSize: 10, color: '#e2e8f0', padding: '4px 6px', fontFamily: 'monospace', lineHeight: 1.5, maxHeight: 60, overflowY: 'auto' as const, overflowX: 'hidden' as const, whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const },
  footer: { padding: '6px 10px 8px', display: 'flex', justifyContent: 'flex-end' },
  btn: { color: '#fff', border: 'none', borderRadius: 5, padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  inputHandle: { width: 8, height: 8, background: '#be123c', border: '2px solid #fff', boxShadow: '0 0 0 1px #be123c', position: 'absolute' as const, left: -5, borderRadius: '50%' },
  outputHandle: { width: 10, height: 10, background: '#22c55e', border: '2px solid #fff', boxShadow: '0 0 0 1px #22c55e' },
}
