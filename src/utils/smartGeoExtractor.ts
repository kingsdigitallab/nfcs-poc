const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'
const TIMEOUT_MS = 25_000

// Fields to always exclude
const SKIP_FIELDS = new Set([
  'id', 'resultsVersion', 'fetchedContent', 'fetchedHtml',
  'fetchStatus', 'fetchedAt', 'ollamaResponse',
])

// Namespace blob keys — excluded from scanning
const NAMESPACE_KEYS = new Set([
  'gbif', 'llds', 'ads', 'adsLibrary', 'mds', 'europeana',
  'ariadne', 'smg', 'vam', 'geocoding',
])

// Field name suffixes/patterns that carry no geographic signal
const SKIP_NAME_RE = /(id|url|uri|thumbnail|image|date|version|status|count|message|content|html|cached|pid|source)$/i

// Highest-signal fields — sent first, within character budget
const PRIORITY_FIELDS = [
  'title', 'description', 'subject', 'spatialCoverage',
  'country', 'collection', 'periodName', 'creator', 'type',
]

function isSkippable(key: string, value: unknown): boolean {
  if (SKIP_FIELDS.has(key))      return true
  if (NAMESPACE_KEYS.has(key))   return true
  if (/^_/.test(key))            return true   // all internal _ prefixed fields
  if (SKIP_NAME_RE.test(key))    return true
  // Skip values that are plain URLs
  if (typeof value === 'string' && /^https?:\/\//.test(value.trim())) return true
  return false
}

/** Collect fields worth scanning, priority fields first. */
export function collectScanFields(record: Record<string, unknown>): string[] {
  const priority: string[] = []
  const rest: string[]     = []
  for (const k of Object.keys(record)) {
    const v = record[k]
    if (v === null || v === undefined) continue
    if (isSkippable(k, v)) continue
    if (typeof v !== 'string' && !Array.isArray(v)) continue
    if (PRIORITY_FIELDS.includes(k)) priority.push(k)
    else rest.push(k)
  }
  // Return priority fields in declared order, then everything else
  return [
    ...PRIORITY_FIELDS.filter(f => priority.includes(f)),
    ...rest,
  ]
}

function buildFieldText(record: Record<string, unknown>, fields: string[]): string {
  const lines: string[] = []
  let budget = 600
  for (const field of fields) {
    if (budget <= 0) break
    const val = record[field]
    if (val === null || val === undefined || val === '') continue
    const str = (Array.isArray(val) ? (val as unknown[]).map(String).join('; ') : String(val)).trim()
    if (!str) continue
    const line = `${field}: ${str.slice(0, Math.min(budget, 200))}`
    lines.push(line)
    budget -= line.length
  }
  return lines.join('\n')
}

// Lean prompt — fewer words means the reasoning model spends less time re-reading rules
const SYSTEM_PROMPT = `Extract 1–3 place names from this museum/archive record for geocoding.

- Institution names → their city: "Bodleian Library" → "Oxford", "V&A" → "London", "British Museum" → "London"
- Adjective/cultural forms → proper nouns: "Scottish" → "Scotland", "Indian headdress" → "India", "Roman" → "Rome", "Byzantine" → "Constantinople"
- The country field is a valid coarse fallback when no specific place is evident
- Skip: years, centuries, people's names, raw materials (wood, bronze), generic words (local, foreign, unknown)

Return ONLY valid JSON, nothing else: {"terms": ["most specific first", "broader fallback"]}
No place found: {"terms": []}`

function parseTerms(content: string): string[] {
  try {
    const match = content.match(/\{[\s\S]*?"terms"[\s\S]*?\}/)
    if (!match) return []
    const parsed = JSON.parse(match[0]) as { terms?: unknown }
    if (!Array.isArray(parsed.terms)) return []
    return (parsed.terms as unknown[])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 1)
      .map(t => t.trim())
      .slice(0, 3)
  } catch { return [] }
}

/**
 * Ask KCL to extract geographic search terms from one record's fields.
 * Falls back to the `country` field if the LLM returns nothing.
 */
export async function extractPlaceTerms(
  record:  Record<string, unknown>,
  fields:  string[],
  apiKey:  string,
  model:   string,
): Promise<string[]> {
  const fieldText = buildFieldText(record, fields)

  // Country fallback helper
  const countryFallback = (): string[] => {
    const c = record['country']
    if (!c) return []
    const s = (Array.isArray(c) ? (c as unknown[])[0] : c) as string
    return s?.trim() ? [s.trim()] : []
  }

  if (!fieldText.trim()) return countryFallback()

  const res = await fetch(KCL_CHAT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream:      false,
      max_tokens:  8192,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: fieldText },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`KCL API HTTP ${res.status}`)

  const json    = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content?.trim() ?? ''
  const terms   = parseTerms(content)

  return terms.length > 0 ? terms : countryFallback()
}
