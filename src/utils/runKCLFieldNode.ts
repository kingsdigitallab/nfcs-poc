/**
 * Runner for KCLFieldNode — sends a selected field from upstream records to
 * KCL's OpenAI-compatible inference API. Supports per-record and aggregate modes.
 *
 * Non-streaming (stream: false). Results written once at end, not per-record.
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { getContentMaxChars } from './kclConfig'

const KCL_CHAT = '/kcl-proxy/v1/chat/completions'

const DEFAULT_SYSTEM     = 'You are a research assistant helping to analyse humanities research data.'
const DEFAULT_PROMPT_PER = 'Summarise the following in 2–3 sentences:\n\n{{value}}'
const DEFAULT_PROMPT_AGG = 'The following are {{field}} values from {{count}} research records. Provide a concise thematic summary of what this collection covers:\n\n{{values}}'

async function kclChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
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
        { role: 'user',   content: userPrompt },
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

  try {
    if (mode === 'aggregate') {
      const maxChars = getContentMaxChars(model)
      const perValMax = Math.max(500, Math.floor(maxChars / Math.max(upstreamRecords.length, 1)))

      const values = upstreamRecords
        .map(r => {
          const v = r[selectedField]
          const str = Array.isArray(v) ? v.join('; ') : String(v ?? '').trim()
          return str.length > perValMax ? str.slice(0, perValMax) + '…' : str
        })
        .filter(Boolean)
        .join('\n---\n')
        .slice(0, maxChars)

      updateNodeData(nodeId, { statusMessage: 'Sending aggregate prompt…' })

      const prompt = promptTemplate
        .replace(/\{\{values\}\}/g, values)
        .replace(/\{\{field\}\}/g,  selectedField)
        .replace(/\{\{value\}\}/g,  values)
        .replace(/\{\{count\}\}/g,  String(upstreamRecords.length))

      const response = await kclChat(apiKey, model, systemPrompt, prompt, temperature, maxTokens)

      const resultRecord = {
        id:                `kcl-agg-${Date.now()}`,
        _source:           'kclField',
        title:             `${selectedField} — aggregate summary`,
        kclModel:          model,
        kclField:          selectedField,
        kclMode:           'aggregate',
        kclAggregatedFrom: upstreamRecords.length,
        kclPrompt:         prompt,
        kclResponse:       response,
        ...(outputField ? { [outputField]: response } : {}),
        kclProcessedAt:    new Date().toISOString(),
      }

      const version = setNodeResults(nodeId, [resultRecord])
      updateNodeData(nodeId, {
        status:         'success',
        statusMessage:  `✓ Aggregate summary (${upstreamRecords.length} records)`,
        outputCount:    1,
        resultsVersion: version,
      })

    } else {
      const enriched: Record<string, unknown>[] = []
      const maxChars = getContentMaxChars(model)
      let errCount = 0

      for (let i = 0; i < upstreamRecords.length; i++) {
        const record = upstreamRecords[i]
        const rawVal = record[selectedField]
        const value  = (Array.isArray(rawVal) ? rawVal.join('; ') : String(rawVal ?? '').trim()).slice(0, maxChars)

        updateNodeData(nodeId, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

        const prompt = promptTemplate
          .replace(/\{\{value\}\}/g, value)
          .replace(/\{\{field\}\}/g, selectedField)
          .replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(record[k] ?? ''))

        let response: string
        try {
          response = await kclChat(apiKey, model, systemPrompt, prompt, temperature, maxTokens)
        } catch (err) {
          errCount++
          const msg = err instanceof Error ? err.message : String(err)
          response = `[error: ${msg}]`
        }

        const enrichedRecord = {
          ...record,
          kclModel:       model,
          kclField:       selectedField,
          kclMode:        'per-record',
          kclPrompt:      prompt,
          kclResponse:    response,
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

      updateNodeData(nodeId, {
        status:         errCount > 0 && errCount === enriched.length ? 'error' : 'success',
        statusMessage:  `✓ ${enriched.length - errCount} processed${errCount > 0 ? `, ${errCount} errors` : ''}`,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}` })
  }
}
