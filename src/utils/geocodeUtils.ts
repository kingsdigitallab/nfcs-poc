// ── Place-name preprocessing ───────────────────────────────────────────────────
// All functions are pure — safe to unit-test without any DOM or network deps.

const LEAD_PHRASES =
  /^(?:excavated\s+(?:near|at|from)|found\s+(?:near|at|from)|manufactured?\s+in|produced\s+in|made\s+in|created\s+in|born\s+in|died?\s+in|near|from|at|in|of)\s+/i

/**
 * Strip noise from a raw place string and return the core toponym.
 *
 * "Excavated near Bath (Somerset), England, c.1880" → "Bath"
 * "Made in London, England"                         → "London"
 * "Paris, France (c. 1740)"                         → "Paris"
 * "Constantinople"                                  → "Constantinople"
 */
export function extractToponym(raw: string): string {
  let s = raw.trim()

  // 1. Strip parenthetical content
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ')

  // 2. Strip date qualifiers: c., circa, ca., fl., d.
  s = s.replace(/\b(?:c\.|circa|ca\.|fl\.|d\.)\s*/gi, '')

  // 3. Strip year expressions (bare years, ranges, centuries with optional era suffix)
  s = s.replace(
    /\b\d{1,4}(?:s|st|nd|rd|th)?(?:\s*[-–]\s*\d{1,4}(?:s|st|nd|rd|th)?)?\s*(?:BCE?|CE|AD)?\b/g,
    '',
  )

  // 4. Split on commas / semicolons and clean each segment
  const segments = s
    .split(/[,;]/)
    .map(seg => seg.trim().replace(LEAD_PHRASES, '').replace(/\s+/g, ' ').trim())
    .filter(seg => seg.length >= 2)

  if (segments.length === 0) return raw.trim()

  // 5. Score segments — prefer short, capitalised segments (likely toponyms)
  const scored = segments.map(seg => {
    const words = seg.split(/\s+/).filter(Boolean)
    const capWords = words.filter(w => /^[A-Z]/.test(w)).length
    const capRatio = words.length > 0 ? capWords / words.length : 0
    return { seg, score: capRatio * 2 - words.length * 0.1 }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0].seg.replace(/\s+/g, ' ').trim() || raw.trim()
}

// ── String similarity ─────────────────────────────────────────────────────────

/** Sørensen–Dice coefficient on character bigrams. Range [0, 1]. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bigrams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a[i] + a[i + 1]
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1)
  }
  let intersection = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b[i] + b[i + 1]
    const count = bigrams.get(bg) ?? 0
    if (count > 0) {
      bigrams.set(bg, count - 1)
      intersection++
    }
  }
  return (2 * intersection) / (a.length + b.length - 2)
}

// ── Domain detection ──────────────────────────────────────────────────────────

const NATURAL_HISTORY_SOURCES = new Set(['gbif', 'ariadne'])

/**
 * Detect collection domain from _source value.
 * Determines tier weighting: TGN preferred for humanities, Wikidata more
 * useful for natural history (broader contemporary coverage).
 */
export function detectDomain(source: string): 'humanities' | 'natural_history' {
  return NATURAL_HISTORY_SOURCES.has(source.toLowerCase())
    ? 'natural_history'
    : 'humanities'
}
