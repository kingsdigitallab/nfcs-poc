import type { Node, Edge } from '@xyflow/react'
import type { VASearchNodeData } from '../nodes/VASearchNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'

const VA_BASE      = '/vam-proxy/v2/objects/search'
const PAGE_SIZE    = 100
const FETCH_TIMEOUT = 30_000

// ── Adapter ───────────────────────────────────────────────────────────────────

interface VAPrimaryMaker { name?: string; association?: string }

interface VARawRecord {
  systemNumber:    string
  accessionNumber: string
  objectType:      string
  _primaryTitle:   string
  _primaryMaker:   VAPrimaryMaker
  _primaryDate:    string
  _primaryPlace:   string
  _currentLocation?: { displayName?: string; onDisplay?: boolean }
  _images?: {
    _primary_thumbnail?:    string
    _iiif_image_base_url?:  string
    _iiif_presentation_url?: string
  }
}

function adaptVARecord(raw: VARawRecord): UnifiedRecord {
  const title    = raw._primaryTitle || raw.objectType || ''
  const creator  = raw._primaryMaker?.name || undefined
  const selfUrl  = `https://collections.vam.ac.uk/item/${raw.systemNumber}`

  return {
    id:         `vam:${raw.systemNumber}`,
    _source:    'vam',
    _sourceId:  raw.systemNumber,
    _sourceUrl: selfUrl,
    _pid:       raw.accessionNumber || undefined,
    _citation:  [title, 'Victoria and Albert Museum', raw.accessionNumber && `Acc. no. ${raw.accessionNumber}`, selfUrl]
      .filter(Boolean).join('. '),
    title,
    creator,
    date:    raw._primaryDate || undefined,
    subject: raw.objectType ? [raw.objectType] : undefined,
    language: 'eng',
    vam: {
      objectType:      raw.objectType || undefined,
      place:           raw._primaryPlace || undefined,
      accessionNumber: raw.accessionNumber || undefined,
      onDisplay:       raw._currentLocation?.onDisplay,
      location:        raw._currentLocation?.displayName || undefined,
      thumbnail:       raw._images?._primary_thumbnail,
      manifest:        raw._images?._iiif_presentation_url,
      iiifImageBase:   raw._images?._iiif_image_base_url,
    },
  } as UnifiedRecord
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

interface VAResponse {
  info: { record_count: number; pages: number; page: number; page_size: number }
  records: VARawRecord[]
}

async function fetchVA(params: URLSearchParams): Promise<VAResponse> {
  const url = `${VA_BASE}?${params}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    console.log('[V&A] GET', url)
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.json() as VAResponse
  } finally {
    clearTimeout(timer)
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runVASearchNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as VASearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  const resolveHandle = (handleId: string, dataKey: keyof VASearchNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const query    = resolveHandle('query', 'inlineQuery')
  const rawLimit = parseInt(resolveHandle('limit', 'inlineLimit') || '20', 10)
  const limit    = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, PAGE_SIZE)
  const fetchAll = d.fetchAll ?? false

  const accessDate   = new Date().toISOString()
  const citationBase = {
    service:    'Victoria and Albert Museum Collections',
    serviceUrl: 'https://collections.vam.ac.uk',
    publisher:  'Victoria and Albert Museum',
    accessDate,
    query,
  }

  try {
    if (fetchAll) {
      // Probe with full page size so info.pages reflects actual page count
      updateNodeData(nodeId, { statusMessage: 'Probing total…' })
      const probeParams = buildParams(query, PAGE_SIZE, 1, d)
      const probeResp   = await fetchVA(probeParams)
      const totalPages  = probeResp.info?.pages ?? 0
      const total       = probeResp.info?.record_count ?? 0

      if (total === 0 || totalPages === 0) {
        const version = setNodeResults(nodeId, [])
        updateNodeData(nodeId, { status: 'success', statusMessage: '✓ 0 results', count: 0, resultsVersion: version })
        return
      }

      // First batch already fetched in probe
      const allRecords: UnifiedRecord[] = (probeResp.records ?? []).map(adaptVARecord)

      for (let page = 2; page <= totalPages; page++) {
        updateNodeData(nodeId, {
          statusMessage: `Page ${page}/${totalPages} (${allRecords.length} fetched)…`,
        })
        const params = buildParams(query, PAGE_SIZE, page, d)
        const resp   = await fetchVA(params)
        const batch  = (resp.records ?? []).map(adaptVARecord)
        allRecords.push(...batch)
        if (batch.length < PAGE_SIZE) break
      }

      const cited   = addCitation(allRecords as Record<string, unknown>[], citationBase)
      const version = setNodeResults(nodeId, cited)
      updateNodeData(nodeId, {
        status: 'success',
        statusMessage: `✓ ${allRecords.length.toLocaleString()} of ${total.toLocaleString()}`,
        count: total,
        resultsVersion: version,
      })
    } else {
      const params  = buildParams(query, limit, 1, d)
      const resp    = await fetchVA(params)
      const records = (resp.records ?? []).map(adaptVARecord)
      const total   = resp.info?.record_count ?? records.length
      const cited   = addCitation(records as Record<string, unknown>[], citationBase)
      const version = setNodeResults(nodeId, cited)
      updateNodeData(nodeId, {
        status: 'success',
        statusMessage: `✓ ${records.length} of ${total.toLocaleString()}`,
        count: total,
        resultsVersion: version,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[V&A] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}

function buildParams(
  query: string,
  pageSize: number,
  pageNumber: number,
  d: VASearchNodeData,
): URLSearchParams {
  const p = new URLSearchParams()
  if (query)       p.set('q',              query)
  if (d.imagesOnly) p.set('images_exist', '1')
  if (d.yearFrom)  p.set('year_made_from', d.yearFrom)
  if (d.yearTo)    p.set('year_made_to',   d.yearTo)
  if (d.objectType) p.set('kw_object_type', d.objectType)
  p.set('page_size', String(pageSize))
  p.set('page',      String(pageNumber))
  return p
}
