import type { Node, Edge } from '@xyflow/react'
import type { GeoCandidate, GeoConfirmed } from '../types/UnifiedRecord'
import type { GeocodingNodeData } from '../nodes/GeocodingNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { collectUpstreamRecords } from './upstreamRecords'
import { extractToponym, detectDomain } from './geocodeUtils'
import { getCached, setCached } from './geocodeCache'
import { scoreCandidates } from './geocodeScorer'
import { queryTGN } from './gazetteers/tgnClient'
import { queryWikidata } from './gazetteers/wikidataGazetteer'

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyResolved(
  rec: Record<string, unknown>,
  placeRaw: string,
  placeCleaned: string,
  lat: number,
  lng: number,
  geocoded: 'auto' | 'manual',
  source: 'tgn' | 'wikidata',
  uri: string,
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
      place_cleaned:      placeCleaned,
      confidence,
    },
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runGeocodingNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const node = getNodes().find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as GeocodingNodeData

  const placeField  = d.placeField ?? ''
  const threshold   = d.confidenceThreshold ?? 0.75
  const passNative  = d.passNativeCoords ?? true
  const confirmed   = (d.confirmedChoices ?? {}) as Record<string, GeoConfirmed>

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', resolved: 0, pending: 0, failed: 0 })

  const upstream = collectUpstreamRecords(nodeId, edges)

  if (upstream.length === 0) {
    const version = setNodeResults(nodeId, [])
    updateNodeData(nodeId, { status: 'success', statusMessage: '✓ No records', resolved: 0, pending: 0, failed: 0, resultsVersion: version })
    return
  }

  // Detect domain from first record's _source for tier weighting
  const domain = detectDomain(String(upstream[0]?._source ?? ''))

  // Build enriched copy; mark each record with its processing intent
  const enriched: Record<string, unknown>[] = upstream.map(r => ({ ...r }))

  // Map cleaned toponym → indices of records sharing that toponym
  const topoToIndices = new Map<string, number[]>()
  let nativeCount = 0

  for (let i = 0; i < upstream.length; i++) {
    const rec = upstream[i]

    // Coordinate pass-through
    if (
      passNative &&
      typeof rec.decimalLatitude  === 'number' && rec.decimalLatitude  !== null &&
      typeof rec.decimalLongitude === 'number' && rec.decimalLongitude !== null
    ) {
      enriched[i] = {
        ...rec,
        geocoding: {
          geocoded:      'native',
          geocode_source: 'native',
          place_raw:     placeField ? String(rec[placeField] ?? '') : '',
          confidence:    1,
        },
      }
      nativeCount++
      continue
    }

    const raw = placeField ? String(rec[placeField] ?? '').trim() : ''
    if (!raw) {
      enriched[i] = { ...rec, geocoding: { geocoded: 'failed', place_raw: '', place_cleaned: '', confidence: 0 } }
      continue
    }

    const cleaned = extractToponym(raw)
    // Stash raw/cleaned on enriched record so we can reference them later
    ;(enriched[i] as Record<string, unknown>)['_geo_raw']     = raw
    ;(enriched[i] as Record<string, unknown>)['_geo_cleaned']  = cleaned

    if (!topoToIndices.has(cleaned)) topoToIndices.set(cleaned, [])
    topoToIndices.get(cleaned)!.push(i)
  }

  let resolved = nativeCount
  let pending  = 0
  let failed   = 0
  let done     = 0
  const total  = topoToIndices.size

  for (const [cleaned, indices] of topoToIndices) {
    done++
    updateNodeData(nodeId, { statusMessage: `Geocoding place ${done}/${total} (${upstream.length} records)…` })

    const placeRaw = String((enriched[indices[0]] as Record<string, unknown>)['_geo_raw'] ?? cleaned)

    // Check user-confirmed choices first (no network needed)
    const choice = confirmed[cleaned]
    if (choice) {
      for (const idx of indices) {
        enriched[idx] = applyResolved(enriched[idx], placeRaw, cleaned, choice.lat, choice.lng, 'manual', choice.source, choice.uri, [], 1)
      }
      resolved++
      continue
    }

    // Check localStorage cache
    let candidates = getCached(cleaned)
    let fromCache  = true

    if (!candidates) {
      fromCache = false
      // Query TGN and Wikidata in parallel; a failure in one tier doesn't abort the other
      const [tgnResult, wdResult] = await Promise.allSettled([
        queryTGN(cleaned),
        queryWikidata(cleaned),
      ])
      const tgnCandidates = tgnResult.status === 'fulfilled' ? tgnResult.value : []
      const wdCandidates  = wdResult.status  === 'fulfilled' ? wdResult.value  : []

      console.group(`[Geocoding] "${cleaned}" (raw: "${placeRaw}")`)
      console.log('TGN:', tgnResult.status === 'fulfilled'
        ? tgnCandidates.map(c => `${c.label} (${c.lat.toFixed(3)},${c.lng.toFixed(3)})`)
        : `FAILED — ${tgnResult.reason}`)
      console.log('Wikidata:', wdResult.status === 'fulfilled'
        ? wdCandidates.map(c => `${c.label} (${c.lat.toFixed(3)},${c.lng.toFixed(3)})`)
        : `FAILED — ${wdResult.reason}`)

      const rawCandidates: GeoCandidate[] = [...tgnCandidates, ...wdCandidates]
      candidates = scoreCandidates(cleaned, rawCandidates, domain)
      setCached(cleaned, candidates)
    } else {
      console.group(`[Geocoding] "${cleaned}" (cache hit — ${candidates.length} candidates)`)
    }

    const top    = candidates[0]
    const second = candidates[1]
    const gap    = top && second ? top.score - second.score : Infinity

    console.log('Scored candidates:', candidates.map(c =>
      `${c.label} [${c.source}] score=${(c.score * 100).toFixed(1)}%`))
    console.log(`threshold=${(threshold * 100).toFixed(0)}%  top=${top ? (top.score * 100).toFixed(1) + '%' : 'none'}  gap=${gap === Infinity ? '∞' : (gap * 100).toFixed(1) + '%'} (need >20%)`)

    if (top && top.score >= threshold && gap > 0.2) {
      console.log('→ AUTO resolved via', top.source, `(${top.label})`)
      console.groupEnd()
      for (const idx of indices) {
        enriched[idx] = applyResolved(enriched[idx], placeRaw, cleaned, top.lat, top.lng, 'auto', top.source, top.uri, candidates, top.score)
      }
      resolved++
    } else if (candidates.length > 0) {
      const reason = !top || top.score < threshold
        ? `score ${top ? (top.score * 100).toFixed(1) + '%' : 'n/a'} < threshold ${(threshold * 100).toFixed(0)}%`
        : `gap ${(gap * 100).toFixed(1)}% ≤ 20%`
      console.log(`→ PENDING REVIEW (${reason})`)
      console.groupEnd()
      for (const idx of indices) {
        enriched[idx] = {
          ...enriched[idx],
          geocoding: {
            geocoded:           'pending_review',
            geocode_candidates: candidates.slice(0, 3),
            place_raw:          placeRaw,
            place_cleaned:      cleaned,
            confidence:         top?.score ?? 0,
          },
        }
      }
      pending++
    } else {
      console.log('→ FAILED (no candidates from TGN or Wikidata)')
      console.groupEnd()
      for (const idx of indices) {
        enriched[idx] = {
          ...enriched[idx],
          geocoding: { geocoded: 'failed', place_raw: placeRaw, place_cleaned: cleaned, confidence: 0 },
        }
      }
      failed++
    }

    void fromCache  // suppress unused-var warning when logs are stripped

    // Stream partial results every 10 unique toponyms
    if (done % 10 === 0 || done === total) {
      const version = setNodeResults(nodeId, enriched)
      updateNodeData(nodeId, { resolved, pending, failed, resultsVersion: version })
    }
  }

  // Strip internal working fields before final write
  const cleaned = enriched.map(r => {
    const { _geo_raw, _geo_cleaned, ...rest } = r as Record<string, unknown>
    void _geo_raw; void _geo_cleaned
    return rest
  })

  const version = setNodeResults(nodeId, cleaned)
  updateNodeData(nodeId, {
    status:        'success',
    statusMessage: `✓ ${resolved} resolved · ${pending} pending · ${failed} failed`,
    resolved,
    pending,
    failed,
    resultsVersion: version,
  })
}
