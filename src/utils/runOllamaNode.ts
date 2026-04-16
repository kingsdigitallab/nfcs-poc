/**
 * Runner for OllamaNode — processes FileRecord / UnifiedRecord upstream records
 * through a local Ollama model. Uses non-streaming mode (stream: false) since
 * Run All does not display live token previews.
 *
 * Per-record errors are caught individually: one failed record does not abort
 * the rest of the batch. Partial results are written to the store after each
 * record so nothing is lost if the run is interrupted.
 */

import type { Node, Edge } from '@xyflow/react'
import type { NodeRunner } from './nodeRunners'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

const OLLAMA_CHAT    = '/ollama/api/chat'
const VISION_MARKERS = ['llava', 'vision', 'bakllava', 'moondream', 'cogvlm']

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

function renderTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = record[key]
    if (val === undefined || val === null) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  })
}

/**
 * Stream the Ollama chat response and return the accumulated text.
 *
 * Using stream:true means generation stops the moment the model emits its
 * natural end-of-sequence token (done:true), regardless of num_predict.
 * With stream:false, Ollama waits until num_predict tokens are generated —
 * so if the model doesn't self-terminate cleanly, duration scales linearly
 * with the token limit.
 */
async function ollamaChat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  images?: string[],
): Promise<string> {
  const userMessage: Record<string, unknown> = { role: 'user', content: userPrompt }
  if (images && images.length > 0) userMessage.images = images

  const res = await fetch(OLLAMA_CHAT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream:  true,
      options: { temperature, num_predict: maxTokens },
      messages: [
        { role: 'system', content: systemPrompt },
        userMessage,
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

export const runOllamaNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d              = node.data as Record<string, unknown>
  const model          = (d.model as string | undefined) ?? ''
  const systemPrompt   = (d.systemPrompt as string | undefined) ?? ''
  const promptTemplate = (d.userPromptTemplate as string | undefined) ?? '{{content}}'
  const temperature    = (d.temperature as number | undefined) ?? 0.7
  const maxTokens      = (d.maxTokens   as number | undefined) ?? 1024
  const visionOverride = (d.visionOverride as boolean | undefined)
  const visionByName   = VISION_MARKERS.some(v => model.toLowerCase().includes(v))
  const isVisionModel  = visionOverride ?? visionByName

  if (!model) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No model configured' })
    return
  }

  const upstreamRecords = getUpstreamRecords(nodeId, getNodes, edges)
  if (upstreamRecords.length === 0) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No upstream records' })
    return
  }

  clearNodeResults(nodeId)
  updateNodeData(nodeId, {
    status:        'running',
    statusMessage: `Processing 0/${upstreamRecords.length}…`,
    inputCount:    upstreamRecords.length,
    outputCount:   0,
  })

  const enriched: Record<string, unknown>[] = []
  let errCount = 0

  for (let i = 0; i < upstreamRecords.length; i++) {
    const record = upstreamRecords[i]
    updateNodeData(nodeId, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

    const isImageRecord = record.contentType === 'image'
    const baseContent   = isImageRecord
      ? ''
      : (record.content      as string | undefined) ??
        (record.description  as string | undefined) ??
        JSON.stringify(record)

    const recordForTemplate: Record<string, unknown> = { ...record, content: baseContent }
    const renderedPrompt = renderTemplate(promptTemplate, recordForTemplate)

    let images: string[] | undefined
    if (isVisionModel && isImageRecord && typeof record.content === 'string') {
      images = [record.content.replace(/^data:[^;]+;base64,/, '')]
    }

    let response: string
    try {
      response = await ollamaChat(
        model, systemPrompt, renderedPrompt, temperature, maxTokens, images,
      )
    } catch (err) {
      errCount++
      const msg = err instanceof Error ? err.message : String(err)
      response = `[error: ${msg}]`
    }

    enriched.push({
      ...record,
      ollamaModel:       model,
      ollamaPrompt:      renderedPrompt,
      ollamaResponse:    response,
      ollamaProcessedAt: new Date().toISOString(),
    })

    // Write partial results after each record so nothing is lost if the run
    // is stopped or the page is refreshed mid-batch.
    const partialVersion = setNodeResults(nodeId, enriched)
    updateNodeData(nodeId, { outputCount: enriched.length, resultsVersion: partialVersion })
  }

  const version = setNodeResults(nodeId, enriched)
  updateNodeData(nodeId, {
    status:        errCount > 0 && errCount === enriched.length ? 'error' : 'success',
    statusMessage: `✓ ${enriched.length - errCount} processed${errCount > 0 ? `, ${errCount} errors` : ''}`,
    inputCount:    upstreamRecords.length,
    outputCount:   enriched.length,
    resultsVersion: version,
  })
}
