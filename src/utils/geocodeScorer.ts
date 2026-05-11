import type { GeoCandidate } from '../types/UnifiedRecord'
import { diceCoefficient } from './geocodeUtils'

// Candidates within this coordinate distance (degrees) are considered the same place
const PROXIMITY_DEG = 0.01

/**
 * Score, deduplicate, and rank a mixed list of TGN + Wikidata candidates.
 *
 * Scoring formula (each component [0–1]):
 *   strSim   × 0.50  — Dice bigram similarity of cleaned toponym vs candidate label
 *   tierW    × 0.30  — TGN=0.9 (humanities) or 0.7 (natural_history); inverted for Wikidata
 *   corrob   × 0.20  — +1 if this place is confirmed by both TGN and Wikidata
 */
export function scoreCandidates(
  cleaned: string,
  raw: GeoCandidate[],
  domain: 'humanities' | 'natural_history',
): GeoCandidate[] {
  if (raw.length === 0) return []

  // Collect TGN URIs found in Wikidata cross-refs for corroboration detection
  const tgnUrisFromWikidata = new Set(
    raw.filter(c => c.source === 'wikidata' && c.tgnUri).map(c => c.tgnUri!),
  )
  const tgnUrisFromTGN = new Set(
    raw.filter(c => c.source === 'tgn').map(c => c.uri),
  )

  const tierWeight = (source: 'tgn' | 'wikidata'): number => {
    if (domain === 'humanities') return source === 'tgn' ? 0.9 : 0.7
    // Natural history: invert — Wikidata has broader contemporary coverage
    return source === 'wikidata' ? 0.9 : 0.7
  }

  const isCorroborated = (c: GeoCandidate): boolean => {
    if (c.source === 'tgn') return tgnUrisFromWikidata.has(c.uri)
    if (c.source === 'wikidata' && c.tgnUri) return tgnUrisFromTGN.has(c.tgnUri)
    return false
  }

  const cl = cleaned.toLowerCase()
  const scored = raw.map(c => ({
    ...c,
    score:
      diceCoefficient(cl, c.label.toLowerCase()) * 0.5 +
      tierWeight(c.source) * 0.3 +
      (isCorroborated(c) ? 1.0 : 0.0) * 0.2,
  }))

  // Deduplicate by coordinate proximity, keeping highest-scored from each cluster
  const kept: GeoCandidate[] = []
  for (const c of scored.sort((a, b) => b.score - a.score)) {
    const isDupe = kept.some(
      k => Math.abs(k.lat - c.lat) < PROXIMITY_DEG && Math.abs(k.lng - c.lng) < PROXIMITY_DEG,
    )
    if (!isDupe) kept.push(c)
  }

  return kept
}
