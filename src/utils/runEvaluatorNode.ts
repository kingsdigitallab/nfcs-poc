/**
 * Runner for EvaluatorNode — LLM-as-judge.
 *
 * Scores a candidate field against a reference field on the same record
 * using an ARC model. Returns per-criterion scores, never a single aggregate.
 * Temperature is hard-pinned to 0 for repeatability.
 *
 * Called by runWorkflow.ts (Run All). For single-node runs the component's
 * handleRun implements the same logic with an AbortController for cancel.
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { getContentMaxChars, DEFAULT_KCL_API_KEY } from './kclConfig'
import { arcChat } from './arc'
import { formatDuration } from './formatDuration'

const EVAL_SYSTEM =
  'You are a rigorous evaluation judge for academic NLP outputs. ' +
  'Return ONLY valid JSON. No prose, no explanation outside the JSON object.'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve {{word}} tokens against a record.
 * Objects → JSON-stringified; null/undefined → ''.
 * (Mirrors renderTemplate in runKCLNode.ts / runOllamaNode.ts.)
 */
function renderTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = record[key]
    if (val === undefined || val === null) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  })
}

/**
 * Strip ```json / ``` fences and attempt JSON.parse.
 * Returns null on failure; callers retry once before marking parse_error.
 */
function parseJudgeJSON(raw: string): Record<string, unknown> | null {
  let s = raw.trim()
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(s) as Record<string, unknown> }
  catch { return null }
}

/**
 * Normalise raw judge-output keys to c{n} criterion keys.
 * Accepts: c1, c2 … and also bare 1, 2 … (Preset 3 — "Rubric from note").
 */
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

// ── Runner ────────────────────────────────────────────────────────────────────

export const runEvaluatorNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as Record<string, unknown>

  // Resolve edge-injected params (apiKey from upstream Param node)
  const resolveParam = (handleId: string, fallback: string): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) return (nodes.find(n => n.id === edge.source)?.data as { value?: string } | undefined)?.value ?? ''
    return fallback
  }

  const apiKey         = resolveParam('apiKey', (d.apiKey as string | undefined) ?? DEFAULT_KCL_API_KEY ?? '').trim()
  const judgeModel     = (d.judgeModel     as string | undefined) ?? 'arc:nexus'
  const referenceField = (d.referenceField as string | undefined) ?? ''
  const candidateField = (d.candidateField as string | undefined) ?? ''
  const rubricPrompt   = (d.rubricPrompt   as string | undefined) ?? ''
  const maxTokens      = (d.maxTokens      as number | undefined) ?? 32768
  // temperature is ALWAYS 0 — repeatability guarantee; node data value is ignored

  // ── Validate ─────────────────────────────────────────────────────────────────
  if (!apiKey) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No API key configured' })
    return
  }
  if (!judgeModel) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No judge model configured' })
    return
  }
  if (!referenceField) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No reference field selected' })
    return
  }
  if (!candidateField) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No candidate field selected' })
    return
  }
  if (!rubricPrompt.trim()) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No rubric prompt set' })
    return
  }

  const upstreamRecords = collectUpstreamRecords(nodeId, edges)
  if (upstreamRecords.length === 0) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records' })
    return
  }

  // ── Begin ─────────────────────────────────────────────────────────────────────
  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status:        'running',
    statusMessage: 'Starting…',
    inputCount:    upstreamRecords.length,
    outputCount:   0,
    scoredCount:   0,
    skippedCount:  0,
    parseErrCount: 0,
  })

  const t0       = performance.now()
  const maxChars = getContentMaxChars(judgeModel)
  const enriched: Record<string, unknown>[] = []
  let scoredCnt    = 0
  let skippedCnt   = 0
  let parseErrCnt  = 0

  try {
    for (let i = 0; i < upstreamRecords.length; i++) {
      const record = upstreamRecords[i]
      updateNodeData(nodeId, { statusMessage: `Judging ${i + 1}/${upstreamRecords.length}…` })

      // ── Skip records where either field is empty ──────────────────────────
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
        const version = setNodeResults(nodeId, [...enriched])
        updateNodeData(nodeId, { outputCount: enriched.length, resultsVersion: version, statusMessage: `Judging ${i + 1}/${upstreamRecords.length}…` })
        continue
      }

      // ── Build template context, apply content limits ──────────────────────
      const refTrunc  = refStr.slice(0,  maxChars)
      const candTrunc = candStr.slice(0, maxChars)
      const templateCtx: Record<string, unknown> = {
        ...record,
        __reference: refTrunc,
        __candidate: candTrunc,
      }
      const prompt = renderTemplate(rubricPrompt, templateCtx)

      // ── Call ARC, parse JSON, retry once on parse failure ─────────────────
      let evalStatus: 'scored' | 'parse_error' = 'scored'
      let scores:  Record<string, number> = {}
      let reasons: Record<string, string> = {}
      let rawOut = ''

      try {
        const raw1  = await arcChat(apiKey, judgeModel, EVAL_SYSTEM, prompt, 0, maxTokens)
        rawOut      = raw1
        const p1    = parseJudgeJSON(raw1)
        if (p1) {
          ;({ scores, reasons } = extractCriteria(p1))
        } else {
          // Retry once
          const raw2 = await arcChat(apiKey, judgeModel, EVAL_SYSTEM, prompt, 0, maxTokens)
          rawOut     = raw2
          const p2   = parseJudgeJSON(raw2)
          if (p2) {
            ;({ scores, reasons } = extractCriteria(p2))
          } else {
            evalStatus = 'parse_error'
          }
        }
      } catch (err) {
        const msg  = err instanceof Error ? err.message : String(err)
        rawOut     = `[error: ${msg}]`
        evalStatus = 'parse_error'
      }

      if (evalStatus === 'scored') scoredCnt++
      else parseErrCnt++

      // Flat eval_c* columns — primitives so allFlatColumns picks them up
      const flatCols: Record<string, number> = {}
      for (const [k, v] of Object.entries(scores)) {
        flatCols[`eval_${k}`] = v   // eval_c1, eval_c2, …
      }

      enriched.push({
        ...record,
        eval: { judgeModel, referenceField, candidateField, scores, reasons, raw: rawOut, status: evalStatus },
        ...flatCols,
      })

      // Partial results: write to store after each record
      const version = setNodeResults(nodeId, [...enriched])
      updateNodeData(nodeId, {
        outputCount:    enriched.length,
        resultsVersion: version,
        statusMessage:  `Judging ${i + 1}/${upstreamRecords.length}…`,
        scoredCount:    scoredCnt,
        skippedCount:   skippedCnt,
        parseErrCount:  parseErrCnt,
      })
    }

    // ── Terminal status ───────────────────────────────────────────────────────
    const elapsedMs = Math.round(performance.now() - t0)
    const allFailed = scoredCnt === 0 && parseErrCnt > 0
    const parts = [
      scoredCnt   > 0 ? `${scoredCnt} scored`          : null,
      skippedCnt  > 0 ? `${skippedCnt} skipped`        : null,
      parseErrCnt > 0 ? `${parseErrCnt} parse_error`   : null,
    ].filter(Boolean).join(' · ')

    updateNodeData(nodeId, {
      status:        allFailed ? 'error' : 'success',
      statusMessage: `✓ ${parts || '0 records'} in ${formatDuration(elapsedMs)}`,
      elapsedMs,
      scoredCount:   scoredCnt,
      skippedCount:  skippedCnt,
      parseErrCount: parseErrCnt,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}` })
  }
}
