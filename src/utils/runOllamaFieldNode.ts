/**
 * Runner for OllamaFieldNode — sends a selected field from upstream records
 * to a local Ollama model. Supports per-record and aggregate modes.
 * Uses non-streaming mode (stream: false) since Run All has no live preview.
 */

import type { Node, Edge } from '@xyflow/react'
import type { NodeRunner } from './nodeRunners'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

const OLLAMA_CHAT = '/ollama/api/chat'

const DEFAULT_SYSTEM     = 'You are a research assistant helping to analyse humanities research data.'
const DEFAULT_PROMPT_PER = 'Summarise the following in 2–3 sentences:\n\n{{value}}'
const DEFAULT_PROMPT_AGG = 'The following are {{field}} values from {{count}} research records. Provide a concise thematic summary of what this collection covers:\n\n{{values}}'

function getUpstreamRecords(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
): Record<string, unknown>[] {
  const nodes = getNodes()
  const inputEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'data')
  const out: Record<string, unknown>[] = []
  for (const edge of inputEdges) {
    const src = nodes.find(n => n.id === edge.source)
    if (!src) continue
    const recs = getNodeResults(src.id)
    if (recs) out.push(...recs)
  }
  return out
}

/**
 * Stream the Ollama chat response and return the accumulated text.
 * See runOllamaNode.ts for the reasoning behind stream:true.
 */
async function ollamaChat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(OLLAMA_CHAT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream:  true,
      options: { temperature, num_predict: maxTokens },
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
      if (!line.trim()) continue
      try {
        const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
        if (chunk.message?.content) accumulated += chunk.message.content
        if (chunk.done) return accumulated
      } catch { /* malformed chunk — skip */ }
    }
  }
  return accumulated
}

export const runOllamaFieldNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d              = node.data as Record<string, unknown>
  const model          = (d.model as string | undefined) ?? ''
  const selectedField  = (d.selectedField as string | undefined) ?? ''
  const mode           = (d.mode as string | undefined) ?? 'per-record'
  const systemPrompt   = (d.systemPrompt as string | undefined) ?? DEFAULT_SYSTEM
  const promptTemplate = (d.userPromptTemplate as string | undefined)
    ?? (mode === 'aggregate' ? DEFAULT_PROMPT_AGG : DEFAULT_PROMPT_PER)
  const temperature    = (d.temperature as number | undefined) ?? 0.7
  const maxTokens      = (d.maxTokens   as number | undefined) ?? 1024

  if (!model) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No model configured' })
    return
  }
  if (!selectedField) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No field configured' })
    return
  }

  const upstreamRecords = getUpstreamRecords(nodeId, getNodes, edges)
  if (upstreamRecords.length === 0) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records' })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status:     'running',
    statusMessage: 'Starting…',
    inputCount: upstreamRecords.length,
    outputCount: 0,
  })

  try {
    if (mode === 'aggregate') {
      const values = upstreamRecords
        .map(r => String(r[selectedField] ?? '').trim())
        .filter(Boolean)
        .join('\n---\n')

      updateNodeData(nodeId, { statusMessage: 'Sending aggregate prompt…' })

      const prompt = promptTemplate
        .replace(/\{\{values\}\}/g, values)
        .replace(/\{\{field\}\}/g,  selectedField)
        .replace(/\{\{value\}\}/g,  values)
        .replace(/\{\{count\}\}/g,  String(upstreamRecords.length))

      const response = await ollamaChat(model, systemPrompt, prompt, temperature, maxTokens)

      const resultRecord = {
        id:                    `ollama-agg-${Date.now()}`,
        _source:               'ollamaField',
        title:                 `${selectedField} — aggregate summary`,
        ollamaModel:           model,
        ollamaField:           selectedField,
        ollamaMode:            'aggregate',
        ollamaAggregatedFrom:  upstreamRecords.length,
        ollamaPrompt:          prompt,
        ollamaResponse:        response,
        ollamaProcessedAt:     new Date().toISOString(),
      }

      const version = setNodeResults(nodeId, [resultRecord])
      updateNodeData(nodeId, {
        status:         'success',
        statusMessage:  `✓ Aggregate summary (${upstreamRecords.length} records)`,
        outputCount:    1,
        resultsVersion: version,
      })

    } else {
      // Per-record mode — errors are caught per record so one failure does not
      // abort the rest of the batch.
      const enriched: Record<string, unknown>[] = []
      let errCount = 0

      for (let i = 0; i < upstreamRecords.length; i++) {
        const record = upstreamRecords[i]
        const value  = String(record[selectedField] ?? '').trim()

        updateNodeData(nodeId, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

        const prompt = promptTemplate
          .replace(/\{\{value\}\}/g, value)
          .replace(/\{\{field\}\}/g, selectedField)
          .replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(record[k] ?? ''))

        let response: string
        try {
          response = await ollamaChat(model, systemPrompt, prompt, temperature, maxTokens)
        } catch (err) {
          errCount++
          const msg = err instanceof Error ? err.message : String(err)
          response = `[error: ${msg}]`
        }

        enriched.push({
          ...record,
          ollamaModel:       model,
          ollamaField:       selectedField,
          ollamaMode:        'per-record',
          ollamaPrompt:      prompt,
          ollamaResponse:    response,
          ollamaProcessedAt: new Date().toISOString(),
        })
        // Write partial results after each record so downstream nodes can
        // react progressively and results are not lost if the run is stopped.
        const version = setNodeResults(nodeId, enriched)
        updateNodeData(nodeId, { outputCount: enriched.length, resultsVersion: version })
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
    // Only reached for aggregate mode or setup failures — per-record errors are
    // handled individually above.
    const msg = err instanceof Error ? err.message : String(err)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}` })
  }
}
