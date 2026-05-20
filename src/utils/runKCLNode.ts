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

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; format: string } }

function renderTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = record[key]
    if (val === undefined || val === null) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  })
}

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
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('Image load failed for resize'))
    img.src = dataUrl
  })
}

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
      stream:      true,
      temperature,
      max_tokens:  maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent },
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

  const d = node.data as Record<string, unknown>

  const resolveParam = (handleId: string, fallback: string): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) return (nodes.find(n => n.id === edge.source)?.data as { value?: string } | undefined)?.value ?? ''
    return fallback
  }

  const apiKey         = resolveParam('apiKey', (d.apiKey as string | undefined) ?? '').trim()
  const model          = (d.model          as string | undefined) ?? ''
  const systemPrompt   = (d.systemPrompt   as string | undefined) ?? ''
  const promptTemplate = (d.userPromptTemplate as string | undefined) ?? '{{content}}'
  const temperature    = (d.temperature    as number | undefined) ?? 0.7
  const maxTokens      = (d.maxTokens      as number | undefined) ?? 1024
  const visionMode     = (d.visionMode     as boolean | undefined) ?? false
  const imageField     = (d.imageField     as string  | undefined) ?? ''

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

    const baseContent = visionMode
      ? (record.description as string | undefined) ?? (record.title as string | undefined) ?? ''
      : (record.content     as string | undefined) ??
        (record.description as string | undefined) ??
        JSON.stringify(record)

    const renderedPrompt = renderTemplate(promptTemplate, { ...record, content: baseContent })
    const userContent    = visionMode
      ? await buildUserContent(renderedPrompt, record, imageField)
      : renderedPrompt

    let response: string
    try {
      response = await kclChat(apiKey, model, systemPrompt, userContent, temperature, maxTokens)
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
