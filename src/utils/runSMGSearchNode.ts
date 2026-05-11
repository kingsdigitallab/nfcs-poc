import type { Node, Edge } from '@xyflow/react'
import type { SMGSearchNodeData } from '../nodes/SMGSearchNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'

// SMG Collections Online API — requires proxy (no CORS from browser Origin)
const SMG_BASE     = '/smg-proxy'
const PAGE_SIZE    = 100   // API max is 100
const FETCH_TIMEOUT = 30_000

const MUSEUM_NAMES: Record<string, string> = {
  SMG:        'Science Museum',
  NRM:        'National Railway Museum',
  NSMM:       'National Science and Media Museum',
  MSI:        'Museum of Science and Industry',
  Locomotion: 'Locomotion',
  SSPL:       'Science & Society Picture Library',
}

// ── Adapter ───────────────────────────────────────────────────────────────────

interface SMGRawRecord {
  id: string
  type: string
  attributes: Record<string, unknown>
  links?: { self?: string }
}

type ArrOfVal = Array<{ value?: string; primary?: boolean }>

function primaryVal(arr: ArrOfVal | undefined): string {
  if (!arr?.length) return ''
  return arr.find(x => x.primary)?.value ?? arr[0]?.value ?? ''
}

function thumbnailUrl(multimedia: unknown): string | undefined {
  const arr = multimedia as Array<Record<string, unknown>> | undefined
  const m   = arr?.[0]
  if (!m) return undefined
  const processed  = m['@processed'] as Record<string, unknown> | undefined
  const largeTh    = processed?.large_thumbnail as { location?: string } | undefined
  if (!largeTh?.location) return undefined
  return largeTh.location.startsWith('http')
    ? largeTh.location
    : `https://coimages.sciencemuseumgroup.org.uk/${largeTh.location}`
}

function adaptSMGRecord(raw: SMGRawRecord): UnifiedRecord {
  const a = raw.attributes

  const title =
    primaryVal(a.title as ArrOfVal) ||
    primaryVal(a.name  as ArrOfVal) ||
    (a.summary as { title?: string } | undefined)?.title || ''

  const description = primaryVal(a.description as ArrOfVal)

  const creation = a.creation as {
    maker?: Array<{ summary?: { title?: string }; name?: Array<{ value?: string }> }>
    date?:  Array<{ value?: string; source?: string }>
    place?: Array<{ summary?: { title?: string } }>
  } | undefined

  const makers = creation?.maker
    ?.map(m => m.summary?.title ?? m.name?.[0]?.value ?? '')
    .filter(Boolean) ?? []
  const creator = makers.length === 1 ? makers[0] : makers.length > 1 ? makers : undefined

  const dateVal =
    (creation?.date?.find(d => d.source === 'catalogue') ?? creation?.date?.[0])?.value ?? ''

  const categories = (a.category as Array<{ name?: string; museum?: string }> | undefined) ?? []
  const subject    = categories.map(c => c.name).filter((n): n is string => !!n)
  const museumCode = categories[0]?.museum ?? ''
  const museumName = MUSEUM_NAMES[museumCode] ?? museumCode

  const accessionNumber = primaryVal(a.identifier as ArrOfVal) || undefined

  const selfUrl = raw.links?.self ?? `https://collection.sciencemuseumgroup.org.uk/objects/${raw.id}`

  const thumbnail = thumbnailUrl(a.multimedia)

  const multimediaArr = a.multimedia as Array<{ legal?: { rights?: Array<{ licence?: string }> } }> | undefined

  return {
    id:         `smg:${raw.id}`,
    _source:    'smg',
    _sourceId:  raw.id,
    _sourceUrl: selfUrl,
    _pid:       accessionNumber,
    _citation:  [title, museumName, accessionNumber && `Accession no. ${accessionNumber}`, selfUrl]
      .filter(Boolean).join('. '),
    title,
    description,
    creator,
    date:    dateVal,
    subject: subject.length > 0 ? subject : undefined,
    language: (a.language as Array<{ value?: string }> | undefined)?.[0]?.value ?? 'eng',
    smg: {
      museum:          museumName || undefined,
      museumCode:      museumCode || undefined,
      accessionNumber,
      manifest:        `https://collection.sciencemuseumgroup.org.uk/iiif/objects/${raw.id}`,
      categories:      subject.length > 0 ? subject : undefined,
      makingPlace:     creation?.place?.[0]?.summary?.title,
      thumbnail,
      dimensions:      primaryVal(
        (a.measurements as { dimensions?: ArrOfVal } | undefined)?.dimensions
      ) || undefined,
      credit:          (a.legal as { credit?: string } | undefined)?.credit,
      imageRights:     multimediaArr?.[0]?.legal?.rights?.[0]?.licence,
    },
  } as UnifiedRecord
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

interface SMGResponse {
  data: SMGRawRecord[]
  meta: {
    total_pages: number
    count: { type: { all: number } }
  }
}

async function fetchSMG(searchType: string, params: URLSearchParams): Promise<SMGResponse> {
  const url = `${SMG_BASE}/search/${searchType}?${params}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    console.log('[SMG] GET', url)
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.json() as SMGResponse
  } finally {
    clearTimeout(timer)
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runSMGSearchNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as SMGSearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  // Resolve wired or inline query/limit
  const resolveHandle = (handleId: string, dataKey: keyof SMGSearchNodeData): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return (d[dataKey] as string | undefined) ?? ''
  }

  const query      = resolveHandle('query', 'inlineQuery')
  const rawLimit   = parseInt(resolveHandle('limit', 'inlineLimit') || '20', 10)
  const limit      = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, PAGE_SIZE)
  const fetchAll   = d.fetchAll ?? false
  const searchType = d.searchType || 'objects'

  const accessDate   = new Date().toISOString()
  const citationBase = {
    service:    'Science Museum Group',
    serviceUrl: 'https://collection.sciencemuseumgroup.org.uk',
    publisher:  'Science Museum Group',
    accessDate,
    query,
  }

  try {
    if (fetchAll) {
      // Probe total pages first
      updateNodeData(nodeId, { statusMessage: 'Probing total…' })
      const probe      = buildParams(query, 1, 0, d)
      const probeResp  = await fetchSMG(searchType, probe)
      const totalPages = probeResp.meta?.total_pages ?? 0
      const total      = probeResp.meta?.count?.type?.all ?? 0

      if (total === 0 || totalPages === 0) {
        const version = setNodeResults(nodeId, [])
        updateNodeData(nodeId, { status: 'success', statusMessage: '✓ 0 results', count: 0, resultsVersion: version })
        return
      }

      const allRecords: UnifiedRecord[] = []

      for (let page = 0; page < totalPages; page++) {
        updateNodeData(nodeId, {
          statusMessage: `Page ${page + 1}/${totalPages} (${allRecords.length} fetched)…`,
        })
        const params = buildParams(query, PAGE_SIZE, page, d)
        const resp   = await fetchSMG(searchType, params)
        const batch  = (resp.data ?? []).map(adaptSMGRecord)
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
      const params  = buildParams(query, limit, 0, d)
      const resp    = await fetchSMG(searchType, params)
      const records = (resp.data ?? []).map(adaptSMGRecord)
      const total   = resp.meta?.count?.type?.all ?? records.length
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
    console.error('[SMG] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}

function buildParams(
  query: string,
  pageSize: number,
  pageNumber: number,
  d: SMGSearchNodeData,
): URLSearchParams {
  const p = new URLSearchParams()
  if (query)       p.set('q',            query)
  if (d.museum)    p.set('museum',       d.museum)
  if (d.dateFrom)  p.set('date[from]',  d.dateFrom)
  if (d.dateTo)    p.set('date[to]',    d.dateTo)
  p.set('page[size]',   String(pageSize))
  p.set('page[number]', String(pageNumber))
  return p
}
