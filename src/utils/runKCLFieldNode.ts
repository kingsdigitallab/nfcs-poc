/**
 * Runner for KCLFieldNode — sends a selected field from upstream records to
 * KCL's OpenAI-compatible inference API. Supports per-record and aggregate
 * modes, and (inputKind: 'image') sends the field's images to the vision
 * model instead of its text.
 *
 * Non-streaming (stream: false). Per-record results are written to the store
 * as each record completes (partial results).
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { getContentMaxChars, MAX_IMAGES_PER_CALL, DEFAULT_IMAGE_SEND_DIM, DEFAULT_IMAGE_SEND_SIZE } from './kclConfig'
import { formatDuration } from './formatDuration'
import { renderFieldTemplateAggregate, renderFieldTemplatePerRecord } from './promptTemplates'
import { getFieldByPath } from './fieldPath'
import { imagePartFor, collectImageParts, imageListText, recordLabel, type ContentPart } from './kclVision'

const KCL_CHAT = '/kcl-proxy/v1/chat/completions'

const DEFAULT_SYSTEM     = 'You are a research assistant helping to analyse humanities research data.'
const DEFAULT_PROMPT_PER = 'Summarise the following in 2–3 sentences:\n\n{{value}}'
const DEFAULT_PROMPT_AGG = 'The following are {{field}} values from {{count}} research records. Provide a concise thematic summary of what this collection covers:\n\n{{values}}'

async function kclChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string | ContentPart[],
  temperature: number,
  maxTokens: number,
): Promise<string> {
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
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return json.choices?.[0]?.message?.content ?? ''
}

export const runKCLFieldNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d = node.data as Record<string, unknown>

  const resolveParam = (handleId: string, fallback: string): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) return (nodes.find(n => n.id === edge.source)?.data as { value?: string } | undefined)?.value ?? ''
    return fallback
  }

  const apiKey         = resolveParam('apiKey', (d.apiKey as string | undefined) ?? '').trim()
  const model          = (d.model          as string | undefined) ?? ''
  const selectedField  = (d.selectedField  as string | undefined) ?? ''
  const outputField    = (d.outputField    as string | undefined) ?? ''
  const mode           = (d.mode           as string | undefined) ?? 'per-record'
  const inputKind      = (d.inputKind      as string | undefined) ?? 'text'
  const maxImages      = Math.max(1, Number(d.maxImages ?? MAX_IMAGES_PER_CALL) || MAX_IMAGES_PER_CALL)
  const imageOpts      = { maxDim: DEFAULT_IMAGE_SEND_DIM, size: DEFAULT_IMAGE_SEND_SIZE }
  const systemPrompt   = (d.systemPrompt   as string | undefined) ?? DEFAULT_SYSTEM
  const promptTemplate = (d.userPromptTemplate as string | undefined)
    ?? (mode === 'aggregate' ? DEFAULT_PROMPT_AGG : DEFAULT_PROMPT_PER)
  const temperature    = (d.temperature    as number | undefined) ?? 0.7
  const maxTokens      = (d.maxTokens      as number | undefined) ?? 32768

  if (!apiKey) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No API key configured' })
    return
  }
  if (!model) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No model configured' })
    return
  }
  if (!selectedField) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No field configured' })
    return
  }

  const upstreamRecords = collectUpstreamRecords(nodeId, edges)
  if (upstreamRecords.length === 0) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records' })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status:        'running',
    statusMessage: 'Starting…',
    inputCount:    upstreamRecords.length,
    outputCount:   0,
  })

  const t0 = performance.now()

  try {
    if (mode === 'aggregate') {
      const maxChars = getContentMaxChars(model)
      let userContent: string | ContentPart[]
      let prompt: string
      let aggregatedFrom = upstreamRecords.length
      let imageNote = ''

      if (inputKind === 'image') {
        updateNodeData(nodeId, { statusMessage: `Fetching up to ${maxImages} images…` })
        const batch = await collectImageParts(upstreamRecords, selectedField, maxImages, imageOpts)
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
        const perValMax = Math.max(500, Math.floor(maxChars / Math.max(upstreamRecords.length, 1)))
        const values = upstreamRecords
          .map(r => {
            const v = getFieldByPath(r, selectedField)
            const str = Array.isArray(v) ? v.join('; ') : String(v ?? '').trim()
            return str.length > perValMax ? str.slice(0, perValMax) + '…' : str
          })
          .filter(Boolean)
          .join('\n---\n')
          .slice(0, maxChars)
        prompt = renderFieldTemplateAggregate(promptTemplate, { values, field: selectedField, count: upstreamRecords.length })
        userContent = prompt
      }

      updateNodeData(nodeId, { statusMessage: 'Sending aggregate prompt…' })

      const callT0 = performance.now()
      const response = await kclChat(apiKey, model, systemPrompt, userContent, temperature, maxTokens)
      const inferenceMs = Math.round(performance.now() - callT0)

      const resultRecord = {
        id:                `kcl-agg-${Date.now()}`,
        _source:           'kclField',
        title:             `${selectedField} — aggregate summary`,
        kclModel:          model,
        kclField:          selectedField,
        kclMode:           'aggregate',
        kclInputKind:      inputKind,
        kclAggregatedFrom: aggregatedFrom,
        kclPrompt:         prompt,
        kclResponse:       response,
        inferenceMs,
        ...(outputField ? { [outputField]: response } : {}),
        kclProcessedAt:    new Date().toISOString(),
      }

      const version = setNodeResults(nodeId, [resultRecord])
      const elapsedMs = Math.round(performance.now() - t0)
      updateNodeData(nodeId, {
        status:         'success',
        statusMessage:  `✓ Aggregate summary (${aggregatedFrom} records) in ${formatDuration(elapsedMs)}${imageNote}`,
        outputCount:    1,
        resultsVersion: version,
        elapsedMs,
      })

    } else {
      const enriched: Record<string, unknown>[] = []
      const maxChars = getContentMaxChars(model)
      let errCount = 0

      for (let i = 0; i < upstreamRecords.length; i++) {
        const record = upstreamRecords[i]
        const rawVal = getFieldByPath(record, selectedField)
        // Image input: the prompt talks ABOUT the record, so {{value}} is its
        // title; the image itself travels as a content part.
        const value  = inputKind === 'image'
          ? recordLabel(record)
          : (Array.isArray(rawVal) ? rawVal.join('; ') : String(rawVal ?? '').trim()).slice(0, maxChars)

        updateNodeData(nodeId, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

        const prompt = renderFieldTemplatePerRecord(promptTemplate, {
          value, field: selectedField, record,
        })

        let response: string
        let inferenceMs = 0
        const callT0 = performance.now()
        try {
          let userContent: string | ContentPart[] = prompt
          if (inputKind === 'image') {
            const part = await imagePartFor(selectedField, rawVal, imageOpts)
            if (!part) throw new ImageUnavailable(`no image in ${selectedField}`)
            userContent = [{ type: 'text', text: prompt }, part]
          }
          response = await kclChat(apiKey, model, systemPrompt, userContent, temperature, maxTokens)
          inferenceMs = Math.round(performance.now() - callT0)
        } catch (err) {
          inferenceMs = Math.round(performance.now() - callT0)
          const msg = err instanceof Error ? err.message : String(err)
          if (inputKind === 'image' && !(err instanceof Error && /^HTTP \d+ /.test(msg))) {
            // Image could not be loaded — not an API failure, the run goes on
            response = `[image unavailable: ${msg}]`
          } else {
            errCount++
            response = `[error: ${msg}]`
          }
        }

        const enrichedRecord = {
          ...record,
          kclModel:       model,
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
        const version = setNodeResults(nodeId, [...enriched])
        updateNodeData(nodeId, {
          outputCount: enriched.length,
          resultsVersion: version,
          statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…`,
        })
      }

      const elapsedMs = Math.round(performance.now() - t0)
      updateNodeData(nodeId, {
        status:         errCount > 0 && errCount === enriched.length ? 'error' : 'success',
        statusMessage:  `✓ ${enriched.length - errCount} processed in ${formatDuration(elapsedMs)}${errCount > 0 ? `, ${errCount} errors` : ''}`,
        elapsedMs,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}` })
  }
}

class ImageUnavailable extends Error {}
