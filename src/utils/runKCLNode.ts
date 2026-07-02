/**
 * Runner for KCLNode — processes FileRecord / UnifiedRecord upstream records
 * through KCL's OpenAI-compatible inference API.
 *
 * Non-streaming (stream: false) — waits for the full JSON response.
 * Per-record errors are caught individually; no partial results are written
 * mid-run so the store is only updated once the whole batch completes.
 */

import type { NodeRunner } from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { getContentMaxChars } from './kclConfig'
import { formatDuration } from './formatDuration'
import { renderTemplate } from './promptTemplates'

const KCL_CHAT = '/kcl-proxy/v1/chat/completions'

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; format: string } }

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
): Promise<{ text: string; resolvedModel: string }> {
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
    model?: string
    choices?: Array<{ message?: { content?: string } }>
  }
  return {
    text:          json.choices?.[0]?.message?.content ?? '',
    resolvedModel: json.model ?? model,
  }
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
  const maxTokens      = (d.maxTokens      as number | undefined) ?? 32768
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
  const maxChars = getContentMaxChars(model)
  const t0 = performance.now()

  for (let i = 0; i < upstreamRecords.length; i++) {
    const record = upstreamRecords[i]
    updateNodeData(nodeId, { statusMessage: `Processing ${i + 1}/${upstreamRecords.length}…` })

    const rawContent = visionMode
      ? (record.description as string | undefined) ?? (record.title as string | undefined) ?? ''
      : (record.content     as string | undefined) ??
        (record.description as string | undefined) ??
        JSON.stringify(record)
    const baseContent = rawContent.slice(0, maxChars)

    const renderedPrompt = renderTemplate(promptTemplate, { ...record, content: baseContent })
    const userContent    = visionMode
      ? await buildUserContent(renderedPrompt, record, imageField)
      : renderedPrompt

    let response      = ''
    let resolvedModel = model
    let inferenceMs   = 0
    const callT0 = performance.now()
    try {
      const result  = await kclChat(apiKey, model, systemPrompt, userContent, temperature, maxTokens)
      response      = result.text
      resolvedModel = result.resolvedModel
      inferenceMs   = Math.round(performance.now() - callT0)
    } catch (err) {
      inferenceMs = Math.round(performance.now() - callT0)
      errCount++
      const msg = err instanceof Error ? err.message : String(err)
      response = `[error: ${msg}]`
    }

    enriched.push({
      ...record,
      kclModel:         model,
      kclModelResolved: resolvedModel,
      kclPrompt:        renderedPrompt,
      kclResponse:      response,
      inferenceMs,
      kclProcessedAt:   new Date().toISOString(),
    })
  }

  const elapsedMs = Math.round(performance.now() - t0)
  const version = setNodeResults(nodeId, enriched)
  updateNodeData(nodeId, {
    status:         errCount > 0 && errCount === enriched.length ? 'error' : 'success',
    statusMessage:  `✓ ${enriched.length - errCount} processed in ${formatDuration(elapsedMs)}${errCount > 0 ? `, ${errCount} errors` : ''}`,
    inputCount:     upstreamRecords.length,
    outputCount:    enriched.length,
    resultsVersion: version,
    elapsedMs,
  })
}
