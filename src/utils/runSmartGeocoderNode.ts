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

const BATCH_SIZE = 5  // concurrent KCL calls

function applyResolved(
  rec:        Record<string, unknown>,
  placeRaw:   string,
  terms:      string[],
  lat:        number,
  lng:        number,
  geocoded:   'auto' | 'manual',
  source:     'tgn' | 'wikidata' | 'nominatim',
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
      place_raw:          placeRaw,
      place_cleaned:      placeRaw,
      place_terms:        terms,
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

  // ── Pass 1: handle native coordinates ──────────────────────────────────────
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

  // ── Pass 2: KCL extraction in concurrent batches ────────────────────────────
  updateNodeData(nodeId, { statusMessage: `Extracting place terms from ${toExtract.length} records…` })

  // term → indices of records that share this primary term
  const termToIndices = new Map<string, number[]>()
  let extractFailed = 0

  for (let b = 0; b < toExtract.length; b += BATCH_SIZE) {
    const batch = toExtract.slice(b, b + BATCH_SIZE)
    await Promise.allSettled(batch.map(async idx => {
      const rec    = upstream[idx] as Record<string, unknown>
      const fields = scanAll ? collectScanFields(rec) : selFields
      try {
        const terms = await extractPlaceTerms(rec, fields, apiKey, model)
        enriched[idx]['_geo_terms'] = terms
        const primary = terms[0] ?? ''
        if (primary) {
          if (!termToIndices.has(primary)) termToIndices.set(primary, [])
          termToIndices.get(primary)!.push(idx)
        } else {
          // LLM found nothing geographic in this record
          enriched[idx] = {
            ...enriched[idx],
            geocoding: { geocoded: 'failed', place_raw: '', place_cleaned: '', place_terms: [], confidence: 0 },
          }
          extractFailed++
        }
      } catch {
        enriched[idx] = {
          ...enriched[idx],
          geocoding: { geocoded: 'failed', place_raw: '', place_cleaned: '', place_terms: [], confidence: 0 },
        }
        extractFailed++
      }
    }))

    const done = Math.min(b + BATCH_SIZE, toExtract.length)
    updateNodeData(nodeId, { statusMessage: `Extracting place terms… ${done}/${toExtract.length}` })
  }

  // ── Pass 3: geocode each unique extracted term ──────────────────────────────
  let resolved = nativeCount
  let pending  = 0
  let failed   = extractFailed
  let gDone    = 0
  const gTotal = termToIndices.size

  for (const [term, indices] of termToIndices) {
    gDone++
    updateNodeData(nodeId, { statusMessage: `Geocoding ${gDone}/${gTotal} unique terms…`, resolved, pending, failed })

    const allTerms = (enriched[indices[0]]?.['_geo_terms'] as string[] | undefined) ?? [term]

    // Check user-confirmed choices first (no network call)
    const choice = confirmed[term]
    if (choice) {
      for (const idx of indices) {
        enriched[idx] = applyResolved(enriched[idx], term, allTerms, choice.lat, choice.lng, 'manual', choice.source as 'tgn' | 'wikidata' | 'nominatim', choice.uri, [], 1)
      }
      resolved++
      continue
    }

    // Cache check
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

    const top    = candidates[0]
    const second = candidates[1]
    const gap    = top && second ? top.score - second.score : Infinity

    if (top && top.score >= threshold && gap > 0.15) {
      for (const idx of indices) {
        enriched[idx] = applyResolved(
          enriched[idx], term, allTerms,
          top.lat, top.lng, 'auto', top.source as 'tgn' | 'wikidata' | 'nominatim',
          top.uri, candidates, top.score,
        )
      }
      resolved++
    } else if (candidates.length > 0) {
      for (const idx of indices) {
        enriched[idx] = {
          ...enriched[idx],
          geocoding: {
            geocoded:           'pending_review',
            geocode_candidates: candidates.slice(0, 5),
            place_raw:          term,
            place_cleaned:      term,
            place_terms:        allTerms,
            confidence:         top?.score ?? 0,
          },
        }
      }
      pending++
    } else {
      for (const idx of indices) {
        enriched[idx] = {
          ...enriched[idx],
          geocoding: { geocoded: 'failed', place_raw: term, place_cleaned: term, place_terms: allTerms, confidence: 0 },
        }
      }
      failed += indices.length
    }

    if (gDone % 5 === 0 || gDone === gTotal) {
      const version = setNodeResults(nodeId, enriched)
      updateNodeData(nodeId, { resolved, pending, failed, resultsVersion: version })
    }
  }

  // Strip internal working fields
  const final = enriched.map(r => {
    const { _geo_terms, ...rest } = r
    void _geo_terms
    return rest
  })

  const version = setNodeResults(nodeId, final)
  updateNodeData(nodeId, {
    status:        'success',
    statusMessage: `✓ ${resolved} resolved · ${pending} pending · ${failed} failed`,
    resolved,
    pending,
    failed,
    resultsVersion: version,
  })
}
