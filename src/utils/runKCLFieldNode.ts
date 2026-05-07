/**
 * Runner for KCLFieldNode — sends a selected field from upstream records to
 * KCL's OpenAI-compatible inference API. Supports per-record and aggregate modes.
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'

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
      stream:      true,
      temperature,
      max_tokens:  maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
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
        if (content) accumulated += content
      } catch { /* malformed chunk — skip */ }
    }
  }
  return accumulated
}

export const runKCLFieldNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d              = node.data as Record<string, unknown>
  const apiKey         = (d.apiKey         as string | undefined) ?? ''
  const model          = (d.model          as string | undefined) ?? ''
  const selectedField  = (d.selectedField  as string | undefined) ?? ''
  const mode           = (d.mode           as string | undefined) ?? 'per-record'
  const systemPrompt   = (d.systemPrompt   as string | undefined) ?? DEFAULT_SYSTEM
  const promptTemplate = (d.userPromptTemplate as string | undefined)
    ?? (mode === 'aggregate' ? DEFAULT_PROMPT_AGG : DEFAULT_PROMPT_PER)
  const temperature    = (d.temperature    as number | undefined) ?? 0.7
  const maxTokens      = (d.maxTokens      as number | undefined) ?? 1024

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
      const values = upstreamRecords
        .map(r => {
          const v = r[selectedField]
          return Array.isArray(v) ? v.join('; ') : String(v ?? '').trim()
        })
        .filter(Boolean)
        .join('\n---\n')

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
      let errCount = 0

      for (let i = 0; i < upstreamRecords.length; i++) {
        const record = upstreamRecords[i]
        const rawVal = record[selectedField]
        const value  = Array.isArray(rawVal) ? rawVal.join('; ') : String(rawVal ?? '').trim()

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

        enriched.push({
          ...record,
          kclModel:       model,
          kclField:       selectedField,
          kclMode:        'per-record',
          kclPrompt:      prompt,
          kclResponse:    response,
          kclProcessedAt: new Date().toISOString(),
        })

        const partialVersion = setNodeResults(nodeId, enriched)
        updateNodeData(nodeId, { outputCount: enriched.length, resultsVersion: partialVersion })
      }

      const version = setNodeResults(nodeId, enriched)
      updateNodeData(nodeId, {
        status:         errCount > 0 && errCount === enriched.length ? 'error' : 'success',
        statusMessage:  `✓ ${enriched.length - errCount} processed${errCount > 0 ? `, ${errCount} errors` : ''}`,
        outputCount:    enriched.length,
        resultsVersion: version,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}` })
  }
}
