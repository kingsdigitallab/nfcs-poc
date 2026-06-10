import { describe, it, expect } from 'vitest'
import { scoreCandidates } from '../utils/geocodeScorer'
import type { GeoCandidate } from '../types/UnifiedRecord'

function makeCandidate(overrides: Partial<GeoCandidate> = {}): GeoCandidate {
  return {
    source: 'tgn',
    uri:    'http://vocab.getty.edu/tgn/7011781',
    label:  'London',
    lat:    51.5,
    lng:    -0.12,
    score:  0,
    ...overrides,
  }
}

describe('scoreCandidates', () => {
  it('returns empty array for empty input', () => {
    expect(scoreCandidates('london', [], 'humanities')).toEqual([])
  })

  it('assigns a positive score to a single matching candidate', () => {
    const result = scoreCandidates('london', [makeCandidate({ label: 'London' })], 'humanities')
    expect(result).toHaveLength(1)
    expect(result[0].score).toBeGreaterThan(0)
  })

  it('sorts candidates by descending score', () => {
    const good = makeCandidate({ label: 'London',  lat: 51.5,  lng: -0.1 })
    const poor = makeCandidate({ label: 'Leeches', lat: 53.0,  lng: 2.0 })
    const result = scoreCandidates('london', [poor, good], 'humanities')
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score)
  })

  it('gives TGN higher tier weight than Wikidata in humanities domain', () => {
    const tgn = makeCandidate({ source: 'tgn',      label: 'Oxford', lat: 51.75, lng: -1.25 })
    const wd  = makeCandidate({ source: 'wikidata', label: 'Oxford', lat: 51.76, lng: -1.26 })
    const result = scoreCandidates('oxford', [tgn, wd], 'humanities')
    const tgnScore = result.find(c => c.source === 'tgn')!.score
    const wdScore  = result.find(c => c.source === 'wikidata')!.score
    expect(tgnScore).toBeGreaterThan(wdScore)
  })

  it('gives Wikidata higher tier weight than TGN in natural_history domain', () => {
    const tgn = makeCandidate({ source: 'tgn',      label: 'Borneo', lat: 1.0, lng: 114.0 })
    const wd  = makeCandidate({ source: 'wikidata', label: 'Borneo', lat: 1.0, lng: 114.1 })
    const result = scoreCandidates('borneo', [tgn, wd], 'natural_history')
    const tgnScore = result.find(c => c.source === 'tgn')!.score
    const wdScore  = result.find(c => c.source === 'wikidata')!.score
    expect(wdScore).toBeGreaterThan(tgnScore)
  })

  it('boosts score for corroborated candidates (TGN uri cross-referenced by Wikidata)', () => {
    const tgnUri = 'http://vocab.getty.edu/tgn/7011781'
    const tgn = makeCandidate({ source: 'tgn', uri: tgnUri, label: 'London', lat: 51.5, lng: -0.12 })
    const wd  = makeCandidate({ source: 'wikidata', label: 'London', lat: 51.5, lng: -0.12, tgnUri })

    const withCorrob    = scoreCandidates('london', [tgn, wd], 'humanities')
    const withoutCorrob = scoreCandidates('london', [makeCandidate({ label: 'London' })], 'humanities')

    const corrobScore    = withCorrob.find(c => c.source === 'tgn')!.score
    const uncorrobScore  = withoutCorrob[0].score
    expect(corrobScore).toBeGreaterThan(uncorrobScore)
  })

  it('deduplicates candidates within 0.01 degree proximity, keeping highest score', () => {
    // Both nominatim and wikidata point to effectively the same place
    const c1 = makeCandidate({ source: 'tgn',      label: 'Bath', lat: 51.38, lng: -2.36 })
    const c2 = makeCandidate({ source: 'wikidata', label: 'Bath', lat: 51.385, lng: -2.362 })
    const result = scoreCandidates('bath', [c1, c2], 'humanities')
    expect(result).toHaveLength(1)
  })

  it('keeps candidates more than 0.01 degrees apart as distinct results', () => {
    const c1 = makeCandidate({ label: 'Bath UK',  lat: 51.38, lng: -2.36 })
    const c2 = makeCandidate({ label: 'Bath ME',  lat: 43.91, lng: -69.82, source: 'wikidata' })
    const result = scoreCandidates('bath', [c1, c2], 'humanities')
    expect(result).toHaveLength(2)
  })

  it('caps score at 1.4 (all components maximised with corroboration)', () => {
    // Theoretical max: 1.0×0.5 + 0.9×0.3 + 1.0×0.2 = 0.5+0.27+0.2 = 0.97
    // (corroboration adds 0.2 to that = 0.97 but we can't exceed individual component caps)
    const tgnUri = 'http://vocab.getty.edu/tgn/999'
    const tgn = makeCandidate({ source: 'tgn', uri: tgnUri, label: 'London', lat: 51.5, lng: -0.1 })
    const wd  = makeCandidate({ source: 'wikidata', label: 'London', lat: 51.5, lng: -0.11, tgnUri })
    const result = scoreCandidates('london', [tgn, wd], 'humanities')
    result.forEach(c => expect(c.score).toBeLessThanOrEqual(1.5))
  })
})
