import type { Node, Edge } from '@xyflow/react'
import type { GeoCandidate, GeoConfirmed } from '../types/UnifiedRecord'
import type { SmartGeocoderNodeData } from '../nodes/SmartGeocoderNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { detectDomain } from './geocodeUtils'
import { getCached, setCached } from './geocodeCache'
import { scoreCandidates } from './geocodeScorer'
import { queryTGN } from './gazetteers/tgnClient'
import { queryWikidata } from './gazetteers/wikidataGazetteer'
import { queryNominatim } from './gazetteers/nominatimClient'
import { extractPlaceTerms, collectScanFields } from './smartGeoExtractor'

const KCL_BATCH = 5   // concurrent KCL extraction calls
const GEO_BATCH = 4   // concurrent gazetteer lookups

function applyResolved(
  rec:        Record<string, unknown>,
  term:       string,
  allTerms:   string[],
  lat:        number,
  lng:        number,
  geocoded:   'auto' | 'manual',
  source:     string,
  uri:        string,
  candidates: GeoCandidate[],
  confidence: number,
): Record<string, unknown> {
  return {
    ...rec,
    decimalLatitude:  lat,
    decimalLongitude: lng,
    geocoding: {
      geocoded,
      geocode_source:     source,
      geocode_uri:        uri,
      geocode_candidates: candidates,
      place_raw:          term,
      place_cleaned:      term,
      place_terms:        allTerms,
      confidence,
    },
  }
}

export async function runSmartGeocoderNode(
  nodeId:         string,
  getNodes:       () => Node[],
  edges:          Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const node = getNodes().find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as SmartGeocoderNodeData

  const apiKey     = d.apiKey ?? ''
  const model      = d.model  ?? 'arc:nano'
  const threshold  = d.confidenceThreshold ?? 0.6
  const passNative = d.passNativeCoords    ?? true
  const scanAll    = d.scanAllFields       ?? true
  const selFields  = (d.selectedFields    ?? []) as string[]
  const confirmed  = (d.confirmedChoices   ?? {}) as Record<string, GeoConfirmed>

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', resolved: 0, pending: 0, failed: 0 })

  const upstream = collectUpstreamRecords(nodeId, edges)
  if (upstream.length === 0) {
    const version = setNodeResults(nodeId, [])
    updateNodeData(nodeId, { status: 'success', statusMessage: '✓ No records', resolved: 0, pending: 0, failed: 0, resultsVersion: version })
    return
  }

  const domain   = detectDomain(String(upstream[0]?._source ?? ''))
  const enriched = upstream.map(r => ({ ...r })) as Record<string, unknown>[]

  // ── Pass 1: native coordinate pass-through ────────────────────────────────
  const toExtract: number[] = []
  let nativeCount = 0

  for (let i = 0; i < upstream.length; i++) {
    const rec = upstream[i]
    if (
      passNative &&
      typeof rec.decimalLatitude  === 'number' && rec.decimalLatitude  !== null &&
      typeof rec.decimalLongitude === 'number' && rec.decimalLongitude !== null
    ) {
      enriched[i] = { ...rec, geocoding: { geocoded: 'native', geocode_source: 'native', confidence: 1 } }
      nativeCount++
    } else {
      toExtract.push(i)
    }
  }

  // ── Pass 2: KCL extraction ────────────────────────────────────────────────
  // recordTerms[idx] = ordered list of extracted place terms (most specific first)
  const recordTerms = new Map<number, string[]>()
  const allUniqueTerms = new Set<string>()
  let extractFailed = 0

  updateNodeData(nodeId, { statusMessage: `Extracting place terms from ${toExtract.length} records…` })

  for (let b = 0; b < toExtract.length; b += KCL_BATCH) {
    const batch = toExtract.slice(b, b + KCL_BATCH)
    await Promise.allSettled(batch.map(async idx => {
      const rec    = upstream[idx] as Record<string, unknown>
      const fields = scanAll ? collectScanFields(rec) : selFields
      try {
        const terms = await extractPlaceTerms(rec, fields, apiKey, model)
        if (terms.length > 0) {
          recordTerms.set(idx, terms)
          terms.forEach(t => allUniqueTerms.add(t))
        } else {
          extractFailed++
          enriched[idx] = { ...enriched[idx], geocoding: { geocoded: 'failed', place_raw: '', place_terms: [], confidence: 0 } }
        }
      } catch {
        extractFailed++
        enriched[idx] = { ...enriched[idx], geocoding: { geocoded: 'failed', place_raw: '', place_terms: [], confidence: 0 } }
      }
    }))
    updateNodeData(nodeId, { statusMessage: `Extracting… ${Math.min(b + KCL_BATCH, toExtract.length)}/${toExtract.length}` })
  }

  // ── Pass 3: geocode each unique term once ─────────────────────────────────
  // Each term is looked up in TGN + Wikidata + Nominatim in parallel.
  // Results are cached so repeated terms (across records) cost nothing extra.
  const termResults = new Map<string, GeoCandidate[]>()
  const termList    = [...allUniqueTerms]

  for (let b = 0; b < termList.length; b += GEO_BATCH) {
    const batch = termList.slice(b, b + GEO_BATCH)
    updateNodeData(nodeId, { statusMessage: `Geocoding ${b + 1}–${Math.min(b + GEO_BATCH, termList.length)} of ${termList.length} terms…` })

    await Promise.allSettled(batch.map(async term => {
      let candidates = getCached(term)
      if (!candidates) {
        const [tgnRes, wdRes, nomRes] = await Promise.allSettled([
          queryTGN(term),
          queryWikidata(term),
          queryNominatim(term),
        ])
        const raw: GeoCandidate[] = [
          ...(tgnRes.status === 'fulfilled' ? tgnRes.value : []),
          ...(wdRes.status  === 'fulfilled' ? wdRes.value  : []),
          ...(nomRes.status === 'fulfilled' ? nomRes.value : []),
        ]
        candidates = scoreCandidates(term, raw, domain)
        setCached(term, candidates)
      }
      termResults.set(term, candidates)
    }))
  }

  // ── Pass 4: resolve each record using best available term ─────────────────
  // Cascade through the record's terms (most specific → broadest fallback).
  // First term that auto-resolves wins. If none auto-resolves, the first term
  // with any candidates goes to pending review. Otherwise: failed.
  let autoResolved = nativeCount
  let pending      = 0
  let failed       = extractFailed

  for (const [idx, terms] of recordTerms) {
    // Check confirmed choices first
    const confirmedTerm = terms.find(t => confirmed[t])
    if (confirmedTerm) {
      const choice = confirmed[confirmedTerm]!
      enriched[idx] = applyResolved(
        enriched[idx], confirmedTerm, terms,
        choice.lat, choice.lng, 'manual',
        choice.source, choice.uri, [], 1,
      )
      autoResolved++
      continue
    }

    // Try each term in order: first auto-resolve wins
    let resolved = false
    for (const term of terms) {
      const candidates = termResults.get(term) ?? []
      const top        = candidates[0]
      const second     = candidates[1]
      const gap        = top && second ? top.score - second.score : Infinity

      if (top && top.score >= threshold && gap > 0.15) {
        enriched[idx] = applyResolved(
          enriched[idx], term, terms,
          top.lat, top.lng, 'auto', top.source, top.uri, candidates, top.score,
        )
        autoResolved++
        resolved = true
        break
      }
    }
    if (resolved) continue

    // No auto-resolve — find first term with any candidates for review
    let pendingTerm = ''
    let pendingCandidates: GeoCandidate[] = []
    for (const term of terms) {
      const candidates = termResults.get(term) ?? []
      if (candidates.length > 0) {
        pendingTerm       = term
        pendingCandidates = candidates
        break
      }
    }

    if (pendingCandidates.length > 0) {
      enriched[idx] = {
        ...enriched[idx],
        geocoding: {
          geocoded:           'pending_review',
          geocode_candidates: pendingCandidates.slice(0, 5),
          place_raw:          pendingTerm,
          place_cleaned:      pendingTerm,
          place_terms:        terms,
          confidence:         pendingCandidates[0]?.score ?? 0,
        },
      }
      pending++
    } else {
      enriched[idx] = {
        ...enriched[idx],
        geocoding: { geocoded: 'failed', place_raw: terms[0] ?? '', place_terms: terms, confidence: 0 },
      }
      failed++
    }
  }

  // Stream partial results then write final
  const version = setNodeResults(nodeId, enriched)
  updateNodeData(nodeId, {
    status:        'success',
    statusMessage: `✓ ${autoResolved} resolved · ${pending} pending · ${failed} failed`,
    resolved:      autoResolved,
    pending,
    failed,
    resultsVersion: version,
  })
}
