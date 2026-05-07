/**
 * Runner for KCLNode — processes FileRecord / UnifiedRecord upstream records
 * through KCL's OpenAI-compatible inference API.
 *
 * Uses streaming (stream: true) so generation stops at the model's natural
 * end-of-sequence token. Per-record errors are caught individually.
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'

const KCL_CHAT = '/kcl-proxy/v1/chat/completions'

function renderTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = record[key]
    if (val === undefined || val === null) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  })
}

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

export const runKCLNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return

  const d              = node.data as Record<string, unknown>
  const apiKey         = (d.apiKey         as string | undefined) ?? ''
  const model          = (d.model          as string | undefined) ?? ''
  const systemPrompt   = (d.systemPrompt   as string | undefined) ?? ''
  const promptTemplate = (d.userPromptTemplate as string | undefined) ?? '{{content}}'
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

  const upstreamRecords = collectUpstreamRecords(nodeId, edges)
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

    const baseContent =
      (record.content     as string | undefined) ??
      (record.description as string | undefined) ??
      JSON.stringify(record)

    const renderedPrompt = renderTemplate(promptTemplate, { ...record, content: baseContent })

    let response: string
    try {
      response = await kclChat(apiKey, model, systemPrompt, renderedPrompt, temperature, maxTokens)
    } catch (err) {
      errCount++
      const msg = err instanceof Error ? err.message : String(err)
      response = `[error: ${msg}]`
    }

    enriched.push({
      ...record,
      kclModel:       model,
      kclPrompt:      renderedPrompt,
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
    inputCount:     upstreamRecords.length,
    outputCount:    enriched.length,
    resultsVersion: version,
  })
}
