/**
 * arc.ts — shared ARC / KCL inference helper.
 *
 * Single canonical source of the endpoint URL and auth pattern.
 * Import `arcChat` from here rather than duplicating the POST logic
 * in individual runners.
 */

export const ARC_CHAT = '/kcl-proxy/v1/chat/completions'

/**
 * POST a single text chat-completion to the ARC endpoint.
 *
 * - Always stream: false (callers that need streaming handle SSE themselves).
 * - 180 s AbortSignal baked in; callers do not need to supply one.
 * - Throws on non-2xx or network error — callers must catch.
 */
export async function arcChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(ARC_CHAT, {
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
        { role: 'user',   content: userPrompt   },
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
