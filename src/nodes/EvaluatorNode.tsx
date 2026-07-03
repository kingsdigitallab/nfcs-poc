/**
 * EvaluatorNode — LLM-as-judge.
 *
 * Scores a candidate field against a reference field on the same record
 * using an ARC model as judge, against a user-supplied rubric.
 * Returns per-criterion scores, never a single aggregate.
 *
 * Design intent: LLM judges are repeatable (temperature 0 + constrained JSON)
 * but not objective. The node is "another opinion that must be validated against
 * humans" — hence the required agreement readout when a human-score field is present.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Handle, Position, NodeResizer, useReactFlow, useNodes, useEdges, NodeProps } from '@xyflow/react'
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import { getNodeResults, clearNodeResults, setNodeResults } from '../store/resultsStore'
import { filterKCLModels, APEX_MODEL, getContentMaxChars } from '../utils/kclConfig'
import { arcChat } from '../utils/arc'
import { useStaleResults } from '../hooks/useStaleResults'
import { formatDuration } from '../utils/formatDuration'
import { renderTemplate } from '../utils/promptTemplates'
import { collectLineage, lineageToNarrative } from '../utils/lineage'
import { EVALUATOR_RECIPES } from './evaluatorRecipes'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EvaluatorNodeData {
  apiKey:          string
  judgeModel:      string
  referenceField:  string
  candidateField:  string
  rubricPrompt:    string
  recipePreset:    string
  humanScoreField: string
  temperature:     number   // always 0 — stored for display only
  maxTokens:       number
  status:          'idle' | 'running' | 'success' | 'error'
  statusMessage:   string
  results:         unknown[] | undefined
  inputCount:      number
  outputCount:     number
  scoredCount:     number
  skippedCount:    number
  parseErrCount:   number
  resultsVersion:  number
  elapsedMs:       number
  [key: string]: unknown
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_MODELS   = '/kcl-proxy/v1/models'

const HEADER_COLOR = '#3f3f46'   // distinct teal-grey; unused in Extraction & Enrichment group
const BTN_COLOR    = '#52525b'

const DEFAULT_RUBRIC = EVALUATOR_RECIPES.find(r => r.key === 'interpretive-agreement')?.prompt ?? ''

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

const EVAL_SYSTEM =
  'You are a rigorous evaluation judge for academic NLP outputs. ' +
  'Return ONLY valid JSON. No prose, no explanation outside the JSON object.'

// ── Shared helpers (mirrored from runEvaluatorNode.ts) ──────────────────────

function parseJudgeJSON(raw: string): Record<string, unknown> | null {
  let s = raw.trim()
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(s) as Record<string, unknown> }
  catch { return null }
}

function extractCriteria(parsed: Record<string, unknown>): {
  scores:  Record<string, number>
  reasons: Record<string, string>
} {
  const scores:  Record<string, number> = {}
  const reasons: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed)) {
    const reasonMatch = /^(c(\d+)|(\d+))_reason$/.exec(k)
    if (reasonMatch) {
      const n = reasonMatch[2] ?? reasonMatch[3]
      reasons[`c${n}_reason`] = String(v ?? '')
      continue
    }
    const scoreMatch = /^(c(\d+)|(\d+))$/.exec(k)
    if (scoreMatch) {
      const n   = scoreMatch[2] ?? scoreMatch[3]
      const num = Number(v)
      scores[`c${n}`] = Number.isFinite(num) ? num : 0
    }
  }
  return { scores, reasons }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EvaluatorNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as EvaluatorNodeData

  const [models, setModels]         = useState<string[]>([])
  const [apiOk, setApiOk]           = useState<boolean | null>(null)
  const [tokenInput, setTokenInput] = useState(String((d.maxTokens as number | undefined) ?? 32768))
  const abortRef       = useRef<AbortController | null>(null)
  const apexClickCount = useRef(0)
  const apexClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apexUnlocked   = !!(d.apexUnlocked as boolean | undefined)
  const rubricRef      = useRef<HTMLTextAreaElement | null>(null)

  const rubricPromptVal = (d.rubricPrompt ?? '') as string
  useAutoGrowTextarea(rubricRef, rubricPromptVal, 80)

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
        if (!d.judgeModel && ids.length > 0) updateNodeData(id, { judgeModel: ids[0] })
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

  // Available fields from upstream sample — scalar/array keys only
  const availableFields = useMemo<string[]>(() => {
    if (upstreamRecords.length === 0) return []
    const sample = upstreamRecords[0]
    return Object.entries(sample)
      .filter(([, v]) => v !== null && v !== undefined && (typeof v !== 'object' || Array.isArray(v)))
      .map(([k]) => k)
  }, [upstreamRecords])

  // ── Derived state ─────────────────────────────────────────────────────────────

  const apiKey          = (d.apiKey         ?? '') as string
  const judgeModel      = (d.judgeModel     ?? 'arc:nexus') as string
  const referenceField  = (d.referenceField ?? '') as string
  const candidateField  = (d.candidateField ?? '') as string
  const rubricPrompt    = (d.rubricPrompt   ?? DEFAULT_RUBRIC) as string
  const recipePreset    = (d.recipePreset   ?? 'interpretive-agreement') as string
  const humanScoreField = (d.humanScoreField ?? `${candidateField}_human`) as string
  const maxTokens       = (d.maxTokens      ?? 32768) as number
  const resultsVersion  = (d.resultsVersion ?? 0) as number
  const isRunning       = d.status === 'running'

  const isStale = useStaleResults(d.status as string, {
    judgeModel, referenceField, candidateField, rubricPrompt,
  })

  useEffect(() => { setTokenInput(String(maxTokens)) }, [maxTokens])

  // Auto-select first available field for reference
  useEffect(() => {
    if (!d.referenceField && availableFields.length > 0) {
      updateNodeData(id, { referenceField: availableFields[0] })
    }
  }, [availableFields, d.referenceField, id, updateNodeData])

  // Auto-select a different field for candidate once reference is set
  useEffect(() => {
    if (!d.candidateField && availableFields.length > 0) {
      const firstOther = availableFields.find(f => f !== (d.referenceField ?? '')) ?? availableFields[0]
      updateNodeData(id, { candidateField: firstOther })
    }
  }, [availableFields, d.candidateField, d.referenceField, id, updateNodeData])

  // ── Score summary strip (mean per criterion — informational, not stored) ──────

  const scoreSummary = useMemo(() => {
    if ((d.status as string) !== 'success') return null
    const results = getNodeResults(id)
    if (!results || results.length === 0) return null
    const totals: Record<string, number> = {}
    const counts: Record<string, number> = {}
    for (const r of results) {
      const ev = r.eval as { scores?: Record<string, number>; status?: string } | undefined
      if (ev?.status !== 'scored' || !ev.scores) continue
      for (const [k, v] of Object.entries(ev.scores)) {
        totals[k] = (totals[k] ?? 0) + v
        counts[k] = (counts[k] ?? 0) + 1
      }
    }
    const criteria = Object.keys(counts).sort()
    if (criteria.length === 0) return null
    return criteria.map(k => ({ criterion: k, mean: (totals[k] / counts[k]).toFixed(2) }))
  }, [id, d.status, resultsVersion])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Agreement readout (judge vs human) ───────────────────────────────────────

  const agreementReadout = useMemo(() => {
    if ((d.status as string) !== 'success' && (d.status as string) !== 'error') return null
    const results = getNodeResults(id)
    if (!results || results.length === 0) return null

    const scored = results.filter(r => (r.eval as { status?: string } | undefined)?.status === 'scored')
    if (scored.length === 0) return null
    if (!humanScoreField) return null

    const hasHuman = scored.some(r => r[humanScoreField] != null && r[humanScoreField] !== '')
    if (!hasHuman) return null

    const criterionTotals:     Record<string, number> = {}
    const criterionAgreements: Record<string, number> = {}
    let overallAgreed = 0
    let overallTotal  = 0

    for (const r of scored) {
      const hv = r[humanScoreField]
      if (hv == null || hv === '') continue

      let humanScores: Record<string, unknown> | null = null
      if (typeof hv === 'object' && !Array.isArray(hv)) {
        humanScores = hv as Record<string, unknown>
      } else if (typeof hv === 'string') {
        try { humanScores = JSON.parse(hv) as Record<string, unknown> } catch { /* skip */ }
      }
      if (!humanScores) continue

      const ev = r.eval as { scores?: Record<string, number> } | undefined
      if (!ev?.scores) continue

      let recordAllAgreed    = true
      let recordHasCriteria  = false

      for (const [k, humanVal] of Object.entries(humanScores)) {
        const m = /^(c(\d+)|(\d+))$/.exec(String(k))
        if (!m) continue
        const n  = m[2] ?? m[3]
        const ck = `c${n}`
        const judgeVal = ev.scores[ck]
        if (judgeVal === undefined) continue

        recordHasCriteria = true
        criterionTotals[ck]     = (criterionTotals[ck]     ?? 0) + 1
        if (judgeVal === Number(humanVal)) {
          criterionAgreements[ck] = (criterionAgreements[ck] ?? 0) + 1
        } else {
          recordAllAgreed = false
        }
      }

      if (recordHasCriteria) {
        overallTotal++
        if (recordAllAgreed) overallAgreed++
      }
    }

    if (overallTotal === 0) return null
    return { criterionTotals, criterionAgreements, overallAgreed, overallTotal }
  }, [id, d.status, resultsVersion, humanScoreField])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run handler (button click — includes abort support) ──────────────────────

  const handleRun = useCallback(async () => {
    if (!effectiveApiKey) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ API key required' })
      return
    }
    if (!judgeModel) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No model selected' })
      return
    }
    if (!referenceField) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No reference field selected' })
      return
    }
    if (!candidateField) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No candidate field selected' })
      return
    }
    if (!rubricPrompt.trim()) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No rubric prompt set' })
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
      scoredCount: 0, skippedCount: 0, parseErrCount: 0,
    })

    const t0       = performance.now()
    const maxChars = getContentMaxChars(judgeModel)
    // Lineage is derived once per run, not per record — only when opted in.
    const lineageNarrative = rubricPrompt.includes('{{_lineage}}')
      ? lineageToNarrative(collectLineage(id, allNodes, allEdges))
      : ''
    const enriched: Record<string, unknown>[] = []
    let scoredCnt   = 0
    let skippedCnt  = 0
    let parseErrCnt = 0

    try {
      for (let i = 0; i < upstreamRecords.length; i++) {
        if (signal.aborted) break
        const record = upstreamRecords[i]
        updateNodeData(id, { statusMessage: `Judging ${i + 1}/${upstreamRecords.length}…` })

        const rawRef  = record[referenceField]
        const rawCand = record[candidateField]
        const refStr  = rawRef  == null ? '' : (typeof rawRef  === 'object' ? JSON.stringify(rawRef)  : String(rawRef)).trim()
        const candStr = rawCand == null ? '' : (typeof rawCand === 'object' ? JSON.stringify(rawCand) : String(rawCand)).trim()

        if (!refStr || !candStr) {
          const skipReason = !refStr
            ? `reference field '${referenceField}' is empty`
            : `candidate field '${candidateField}' is empty`
          enriched.push({
            ...record,
            eval: { judgeModel, referenceField, candidateField, scores: {}, reasons: {}, raw: '', status: 'skipped', skipReason },
          })
          skippedCnt++
          const version = setNodeResults(id, [...enriched])
          updateNodeData(id, { outputCount: enriched.length, resultsVersion: version, statusMessage: `Judging ${i + 1}/${upstreamRecords.length}…` })
          continue
        }

        const refTrunc  = refStr.slice(0,  maxChars)
        const candTrunc = candStr.slice(0, maxChars)
        const templateCtx: Record<string, unknown> = {
          ...record,
          __reference: refTrunc,
          __candidate: candTrunc,
          _lineage:    lineageNarrative,
        }
        const prompt = renderTemplate(rubricPrompt, templateCtx)

        let evalStatus: 'scored' | 'parse_error' = 'scored'
        let scores:  Record<string, number> = {}
        let reasons: Record<string, string> = {}
        let rawOut = ''

        try {
          const raw1 = await arcChat(effectiveApiKey, judgeModel, EVAL_SYSTEM, prompt, 0, maxTokens)
          rawOut = raw1
          const p1 = parseJudgeJSON(raw1)
          if (p1) {
            ;({ scores, reasons } = extractCriteria(p1))
          } else {
            const raw2 = await arcChat(effectiveApiKey, judgeModel, EVAL_SYSTEM, prompt, 0, maxTokens)
            rawOut = raw2
            const p2 = parseJudgeJSON(raw2)
            if (p2) {
              ;({ scores, reasons } = extractCriteria(p2))
            } else {
              evalStatus = 'parse_error'
            }
          }
        } catch (err) {
          if ((err as { name?: string }).name === 'AbortError') throw err  // re-throw to outer handler
          const msg  = err instanceof Error ? err.message : String(err)
          rawOut     = `[error: ${msg}]`
          evalStatus = 'parse_error'
        }

        if (evalStatus === 'scored') scoredCnt++
        else parseErrCnt++

        const flatCols: Record<string, number> = {}
        for (const [k, v] of Object.entries(scores)) {
          flatCols[`eval_${k}`] = v
        }

        enriched.push({
          ...record,
          eval: { judgeModel, referenceField, candidateField, scores, reasons, raw: rawOut, status: evalStatus },
          ...flatCols,
        })

        const version = setNodeResults(id, [...enriched])
        updateNodeData(id, {
          outputCount:    enriched.length,
          resultsVersion: version,
          statusMessage:  `Judging ${i + 1}/${upstreamRecords.length}…`,
          scoredCount:    scoredCnt,
          skippedCount:   skippedCnt,
          parseErrCount:  parseErrCnt,
        })
      }

      const elapsedMs = Math.round(performance.now() - t0)
      const allFailed = scoredCnt === 0 && parseErrCnt > 0
      const parts = [
        scoredCnt   > 0 ? `${scoredCnt} scored`          : null,
        skippedCnt  > 0 ? `${skippedCnt} skipped`        : null,
        parseErrCnt > 0 ? `${parseErrCnt} parse_error`   : null,
      ].filter(Boolean).join(' · ')

      // NOTE: do NOT set resultsVersion here (gotcha #21)
      updateNodeData(id, {
        status:        allFailed ? 'error' : 'success',
        statusMessage: `✓ ${parts || '0 records'} in ${formatDuration(elapsedMs)}`,
        elapsedMs,
        scoredCount:   scoredCnt,
        skippedCount:  skippedCnt,
        parseErrCount: parseErrCnt,
      })

    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        updateNodeData(id, { status: 'idle', statusMessage: 'Cancelled' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [id, updateNodeData, upstreamRecords, allNodes, allEdges, effectiveApiKey, judgeModel, referenceField, candidateField, rubricPrompt, maxTokens])

  const handleCancel = useCallback(() => { abortRef.current?.abort() }, [])

  const status      = (d.status ?? 'idle') as string
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'
  const canRun      = !!effectiveApiKey && !!judgeModel && !!referenceField && !!candidateField && !isRunning

  const showAgreementArea = status === 'success' || status === 'error'

  return (
    <>
      <NodeResizer
        minWidth={272} minHeight={200} isVisible={selected}
        lineStyle={{ borderColor: HEADER_COLOR }}
        handleStyle={{ background: HEADER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data"   style={{ ...styles.inputHandle, top: 16 }} />
      <Handle type="target" position={Position.Left} id="apiKey" style={{
        ...styles.inputHandle, top: 53,
        background: isApiKeyConnected ? '#3b82f6' : BTN_COLOR,
        boxShadow:  `0 0 0 1px ${isApiKeyConnected ? '#3b82f6' : BTN_COLOR}`,
      }} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Evaluator</span>
        {isRunning && <span className="node-spinner" />}
        {!isRunning && isStale && (
          <span style={styles.staleBadge}>⟳ settings changed</span>
        )}
        {!isRunning && !isStale && d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {!effectiveApiKey && (
        <div style={styles.warnBanner}>⚠ No API key — rebuild with VITE_KCL_API_KEY set</div>
      )}
      {effectiveApiKey && apiOk === false && (
        <div style={styles.warnBanner}>⚠ Could not reach KCL API — check key or VPN</div>
      )}

      <div style={styles.body}>

        {/* API key */}
        <div style={styles.row}>
          <span style={styles.label}>Key</span>
          <span style={{
            ...styles.input,
            display: 'flex', alignItems: 'center',
            color:      isApiKeyConnected ? '#1d4ed8' : apiKey ? '#15803d' : '#dc2626',
            background: isApiKeyConnected ? '#eff6ff' : apiKey ? '#f0fdf4' : '#fef2f2',
            userSelect: 'none',
          }}>
            {isApiKeyConnected ? '(from Param)' : apiKey ? '🔒 Configured' : '⚠ Not set'}
          </span>
        </div>

        {/* Judge model — triple-click label to unlock arc:apex */}
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
            <select style={styles.select} value={judgeModel}
              onChange={e => updateNodeData(id, { judgeModel: e.target.value })} className="nodrag">
              {models.map(m => <option key={m} value={m}>{m}</option>)}
              {apexUnlocked && !models.includes(APEX_MODEL) && (
                <option key={APEX_MODEL} value={APEX_MODEL}>{APEX_MODEL}</option>
              )}
            </select>
          ) : (
            <input style={styles.input} value={judgeModel}
              onChange={e => updateNodeData(id, { judgeModel: e.target.value })}
              placeholder="arc:nexus" className="nodrag" />
          )}
        </div>

        {/* Reference field */}
        <div style={styles.row}>
          <span style={styles.label}>Ref.</span>
          {availableFields.length > 0 ? (
            <select style={styles.select} value={referenceField}
              onChange={e => updateNodeData(id, { referenceField: e.target.value })} className="nodrag">
              {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input style={styles.input} value={referenceField}
              onChange={e => updateNodeData(id, { referenceField: e.target.value })}
              placeholder="connect records first" className="nodrag" />
          )}
        </div>
        <div style={styles.fieldHint}>Gold-standard / human annotation field</div>

        {/* Candidate field */}
        <div style={styles.row}>
          <span style={styles.label}>Cand.</span>
          {availableFields.length > 0 ? (
            <select style={styles.select} value={candidateField}
              onChange={e => updateNodeData(id, { candidateField: e.target.value })} className="nodrag">
              {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input style={styles.input} value={candidateField}
              onChange={e => updateNodeData(id, { candidateField: e.target.value })}
              placeholder="connect records first" className="nodrag" />
          )}
        </div>
        <div style={styles.fieldHint}>Model output field to be judged</div>

        {/* Temperature — read-only */}
        <div style={styles.row}>
          <span style={styles.label}>Temp</span>
          <span style={{ ...styles.input, color: '#6b7280', background: '#f9fafb', userSelect: 'none', fontSize: 10 }}>
            0 (fixed — ensures repeatability)
          </span>
        </div>

        {/* Recipe preset */}
        <div style={styles.row}>
          <span style={styles.label}>Preset</span>
          <select style={styles.select} value={recipePreset}
            onChange={e => {
              const key = e.target.value
              updateNodeData(id, { recipePreset: key })
              if (key !== 'custom') {
                const recipe = EVALUATOR_RECIPES.find(r => r.key === key)
                if (recipe) updateNodeData(id, { rubricPrompt: recipe.prompt })
              }
            }} className="nodrag">
            {EVALUATOR_RECIPES.map(r => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </div>

        {/* Rubric prompt */}
        <div style={styles.colField}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={styles.label}>Rubric</span>
            <span
              style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'monospace' }}
              title="{{_lineage}} substitutes a natural-language summary of the upstream pipeline"
            >
              {'{{__reference}} {{__candidate}} {{_lineage}}'}
            </span>
          </div>
          <textarea ref={rubricRef} style={{ ...styles.textarea, resize: 'none', overflow: 'hidden', minHeight: 80 }} value={rubricPrompt}
            onChange={e => updateNodeData(id, { rubricPrompt: e.target.value, recipePreset: 'custom' })}
            rows={5} className="nodrag" />
        </div>

        {/* Human score field */}
        <div style={styles.row}>
          <span style={{ ...styles.label, fontSize: 10 }}>Human</span>
          {availableFields.length > 0 ? (
            <select style={styles.select} value={humanScoreField}
              onChange={e => updateNodeData(id, { humanScoreField: e.target.value })} className="nodrag">
              <option value="">— none —</option>
              {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input style={styles.input} value={humanScoreField}
              onChange={e => updateNodeData(id, { humanScoreField: e.target.value })}
              placeholder={candidateField ? `${candidateField}_human` : '_human'} className="nodrag" />
          )}
        </div>
        <div style={styles.fieldHint}>Field with human scores as JSON, e.g. {`{"c1":2,"c2":1}`}</div>

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

      {/* Score summary strip — mean per criterion, informational only */}
      {scoreSummary && scoreSummary.length > 0 && (
        <div style={styles.summaryStrip}>
          <span style={{ ...styles.summaryChip, color: '#6b7280', background: 'transparent', paddingLeft: 0 }}>
            mean:
          </span>
          {scoreSummary.map(({ criterion, mean }) => (
            <span key={criterion} style={styles.summaryChip}>
              {criterion}: {mean}
            </span>
          ))}
        </div>
      )}

      {/* Agreement readout — required, not optional */}
      {showAgreementArea && (
        <div style={styles.agreementBox}>
          {agreementReadout ? (
            <>
              <div style={styles.agreementTitle}>Judge–human agreement</div>
              <div style={styles.agreementOverall}>
                {agreementReadout.overallAgreed}/{agreementReadout.overallTotal} records agreed on all criteria
              </div>
              <div style={styles.agreementGrid}>
                {Object.keys(agreementReadout.criterionTotals).sort().map(ck => {
                  const total  = agreementReadout.criterionTotals[ck]
                  const agreed = agreementReadout.criterionAgreements[ck] ?? 0
                  const pct    = Math.round((agreed / total) * 100)
                  const bar    = Math.round(pct / 10)
                  return (
                    <div key={ck} style={styles.agreementRow}>
                      <span style={styles.agreementCrit}>{ck}</span>
                      <span style={styles.agreementBar}>{'█'.repeat(bar)}{'░'.repeat(10 - bar)}</span>
                      <span style={styles.agreementPct}>{pct}%</span>
                      <span style={styles.agreementCount}>({agreed}/{total})</span>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div style={styles.agreementHint}>
              No human-score field found — judge scores are unvalidated. Add one to check agreement before trusting these.
            </div>
          )}
        </div>
      )}

      <div style={styles.footer}>
        {isRunning ? (
          <button style={{ ...styles.btn, background: '#dc2626' }} onClick={handleCancel} className="nodrag">
            ✕ Cancel
          </button>
        ) : (
          <button
            style={{ ...styles.btn, background: BTN_COLOR, opacity: canRun ? 1 : 0.4 }}
            onClick={handleRun} disabled={!canRun} className="nodrag"
          >
            ▶ Judge
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
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    width: '100%',
    minWidth: 272,
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
  headerTitle:  { color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 },
  headerStatus: { fontSize: 10, fontWeight: 600, color: '#d4d4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  staleBadge:   { fontSize: 9, fontWeight: 700, color: '#fbbf24', background: 'rgba(0,0,0,0.25)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  warnBanner:   { fontSize: 10, padding: '5px 10px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#991b1b', lineHeight: 1.4 },
  body:         { padding: '10px 12px 6px', display: 'flex', flexDirection: 'column' as const, gap: 7 },
  row:          { display: 'flex', alignItems: 'center', gap: 6 },
  colField:     { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  label:        { fontSize: 11, color: '#6b7280', width: 44, flexShrink: 0, fontFamily: 'monospace' },
  select:       { flex: 1, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', height: 22 },
  input:        { flex: 1, fontSize: 11, padding: '2px 5px', border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', height: 22 },
  textarea:     { width: '100%', fontSize: 11, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', resize: 'vertical' as const, fontFamily: 'monospace', lineHeight: 1.4, boxSizing: 'border-box' as const },
  fieldHint:    { fontSize: 9, color: '#9ca3af', paddingLeft: 4, marginTop: -4 },
  summaryStrip: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 4, padding: '4px 12px', borderTop: '1px solid #f3f4f6' },
  summaryChip:  { fontSize: 10, fontFamily: 'monospace', background: '#f3f4f6', borderRadius: 3, padding: '2px 6px', color: '#374151' },
  agreementBox: { padding: '8px 12px', borderTop: '1px solid #f3f4f6' },
  agreementTitle:   { fontSize: 10, fontWeight: 700, color: '#374151', marginBottom: 3 },
  agreementOverall: { fontSize: 11, color: '#111827', marginBottom: 5 },
  agreementGrid:    { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  agreementRow:     { display: 'flex', gap: 5, fontSize: 10, color: '#4b5563', alignItems: 'center' },
  agreementCrit:    { fontFamily: 'monospace', width: 20, flexShrink: 0 },
  agreementBar:     { fontFamily: 'monospace', letterSpacing: -1, color: '#6366f1', fontSize: 9 },
  agreementPct:     { width: 26, textAlign: 'right' as const, fontWeight: 600 },
  agreementCount:   { color: '#9ca3af' },
  agreementHint:    { fontSize: 10, color: '#9ca3af', fontStyle: 'italic' as const, lineHeight: 1.5 },
  footer:       { padding: '6px 10px 8px', display: 'flex', justifyContent: 'flex-end' },
  btn:          { color: '#fff', border: 'none', borderRadius: 5, padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  inputHandle:  { width: 8, height: 8, background: BTN_COLOR, border: '2px solid #fff', boxShadow: `0 0 0 1px ${BTN_COLOR}`, position: 'absolute' as const, left: -5, borderRadius: '50%' },
  outputHandle: { width: 10, height: 10, background: '#22c55e', border: '2px solid #fff', boxShadow: '0 0 0 1px #22c55e' },
}
