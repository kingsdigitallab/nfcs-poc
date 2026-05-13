const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'
const TIMEOUT_MS = 25_000

// Fields never useful for place inference
const SKIP_FIELDS = new Set([
  '_source', '_sourceId', '_sourceUrl', '_pid', '_cached', '_citation',
  'decimalLatitude', 'decimalLongitude', 'id', 'resultsVersion',
])

// Namespace blob keys — excluded from scanning by default
const NAMESPACE_KEYS = new Set([
  'gbif', 'llds', 'ads', 'adsLibrary', 'mds', 'europeana',
  'ariadne', 'smg', 'vam', 'geocoding',
])

const SYSTEM_PROMPT = `You are a geographic entity extractor for cultural heritage museum and archive records.
Given a set of field values from a single record, extract all geographic search terms that could be used to locate the record on a map.

Rules:
1. Extract explicit place names: "Village in Norfolk" → ["Norfolk"]
2. Convert adjectival/cultural forms to the proper geographic noun:
   - "Scottish" → "Scotland"
   - "Indian headdress" → "India"
   - "Roman pottery" → "Rome"
   - "Byzantine icon" → "Constantinople"
   - "Aztec calendar" → "Mexico"
   - "Viking brooch" → "Scandinavia"
   - "Aboriginal bark painting" → "Australia"
   - "Inuit carving" → "Arctic Canada"
3. Accept partial or indirect references: "Made in the Low Countries" → ["Netherlands", "Belgium"]
4. Named regions and historical territories are valid: "Mesopotamia", "Persia", "Anatolia"
5. Return 1–5 terms, most specific and most likely first
6. Exclude purely generic terms ("local", "regional", "foreign", "exotic", "unknown", "various")
7. Exclude purely temporal terms (years, centuries) and purely material terms (bronze, clay, wood)

Return ONLY valid JSON in this exact format with no surrounding text:
{"terms": ["term1", "term2"]}

If no geographic terms can be inferred, return: {"terms": []}`

/** Collect all scannable text fields from a record. */
export function collectScanFields(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter(k => {
    if (SKIP_FIELDS.has(k) || NAMESPACE_KEYS.has(k)) return false
    const v = record[k]
    if (v === null || v === undefined) return false
    return typeof v === 'string' || Array.isArray(v)
  })
}

function buildFieldText(record: Record<string, unknown>, fields: string[]): string {
  const lines: string[] = []
  for (const field of fields) {
    if (SKIP_FIELDS.has(field) || NAMESPACE_KEYS.has(field)) continue
    const val = record[field]
    if (val === null || val === undefined || val === '') continue
    const str = Array.isArray(val) ? (val as unknown[]).map(String).join('; ') : String(val)
    const trimmed = str.trim()
    if (trimmed) lines.push(`${field}: ${trimmed.slice(0, 300)}`)
  }
  return lines.join('\n')
}

/**
 * Ask KCL to extract geographic search terms from one record's fields.
 * Returns up to 5 terms in descending specificity order.
 */
export async function extractPlaceTerms(
  record:  Record<string, unknown>,
  fields:  string[],
  apiKey:  string,
  model:   string,
): Promise<string[]> {
  const fieldText = buildFieldText(record, fields)
  if (!fieldText.trim()) return []

  const res = await fetch(KCL_CHAT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream:      false,
      max_tokens:  2048,
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

  try {
    const match = content.match(/\{[\s\S]*"terms"[\s\S]*\}/)
    if (!match) return []
    const parsed = JSON.parse(match[0]) as { terms?: unknown }
    if (!Array.isArray(parsed.terms)) return []
    return (parsed.terms as unknown[])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 1)
      .map(t => t.trim())
      .slice(0, 5)
  } catch {
    return []
  }
}
