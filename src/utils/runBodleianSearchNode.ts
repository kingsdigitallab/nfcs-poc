import type { Node, Edge } from '@xyflow/react'
import type { BodleianSearchNodeData } from '../nodes/BodleianSearchNode'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'
import type { UnifiedRecord } from '../types/UnifiedRecord'

// Trailing slash required — without it the API 301-redirects to HTML
const BODLEIAN_SEARCH = '/bodleian-proxy/search/'
const PAGE_SIZE       = 100
const MAX_PAGES       = 5   // hard cap: 500 records
const FETCH_TIMEOUT   = 30_000

// ── Actual Bodleian API response types ────────────────────────────────────────
// Confirmed by probing https://digital.bodleian.ox.ac.uk/search/?q=...
// Response is JSON-LD (Content-Type: application/json)

interface BodleianDisplayFields {
  title?:         string[]
  dateStatement?: string[]
  origins?:       string[]
  shelfmark?:     string[]
  snippet?:       string[]
  [key: string]:  string[] | undefined
}

interface BodleianThumbnail {
  id:   string
  type: string
}

interface BodleianManifest {
  id:   string
  type: string
}

interface BodleianMember {
  id:            string
  type:          string
  shelfmark?:    string
  surfaceCount?: number
  thumbnail?:    BodleianThumbnail[]
  manifest?:     BodleianManifest
  displayFields?: BodleianDisplayFields
  completeness?: string
  textAvailable?: boolean
}

interface BodleianResponse {
  totalItems?: number
  member?:     BodleianMember[]
  view?: {
    first?: string
    next?:  string
    last?:  string
    totalPages?: number
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

function first(arr: string[] | undefined): string {
  return arr?.length ? stripHtml(arr[0]) : ''
}

function adaptMember(member: BodleianMember): UnifiedRecord {
  const url  = member.id ?? ''
  const uuid = url.replace(/^.*\/objects\/([^/]+)\/?.*$/, '$1')
  const df   = member.displayFields ?? {}

  const title     = first(df.title) || member.shelfmark || ''
  const date      = first(df.dateStatement)
  const origins   = df.origins?.map(stripHtml).join(', ') ?? ''
  const shelfmark = first(df.shelfmark) || member.shelfmark || ''
  const thumbnail = member.thumbnail?.[0]?.id ?? ''
  const manifest  = member.manifest?.id ?? ''

  return {
    _id:        uuid || url,
    _sourceUrl: url,
    _service:   'bodleian',
    title,
    date,
    type:       member.type ?? '',
    thumbnail,
    bodleian: {
      uuid,
      manifest,
      thumbnail,
      shelfmark,
      origins,
      completeness:   member.completeness ?? '',
      textAvailable:  member.textAvailable ?? false,
      surfaceCount:   member.surfaceCount ?? 0,
    },
  }
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchPage(q: string, page: number, sort: string, objectType: string): Promise<BodleianResponse> {
  const params = new URLSearchParams({ rows: String(PAGE_SIZE), page: String(page) })
  if (q)                          params.set('q', q)
  if (sort && sort !== 'relevance') params.set('sort', sort)
  if (objectType)                 params.set('fq', `type:"${objectType}"`)
  const url        = `${BODLEIAN_SEARCH}?${params}`
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    console.log('[Bodleian] GET', url)
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.json() as BodleianResponse
  } finally {
    clearTimeout(timer)
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runBodleianSearchNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as BodleianSearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  const resolve = (handleId: string, fallback: string): string => {
    const edge = edges.find(e => e.target === nodeId && e.targetHandle === handleId)
    if (edge) {
      const src = nodes.find(n => n.id === edge.source)
      return (src?.data as { value?: string } | undefined)?.value ?? ''
    }
    return fallback
  }

  const q          = resolve('query', d.inlineQuery ?? '')
  const rawLimit   = parseInt(resolve('limit', d.inlineLimit ?? '20'), 10)
  const limit      = isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit
  const sort       = d.sort || 'relevance'
  const fetchAll   = d.fetchAll ?? false
  const objectType = d.objectType ?? ''

  const citationBase = {
    service:    'Bodleian Digital Collections',
    serviceUrl: 'https://digital.bodleian.ox.ac.uk',
    publisher:  'Bodleian Libraries, University of Oxford',
    accessDate: new Date().toISOString(),
    query:      q,
  }

  try {
    const firstPage = await fetchPage(q, 1, sort, objectType)
    const total     = firstPage.totalItems ?? 0

    if (!firstPage.member?.length) {
      const version = setNodeResults(nodeId, [])
      updateNodeData(nodeId, { status: 'success', statusMessage: '✓ 0 results', count: 0, resultsVersion: version })
      return
    }

    if (fetchAll) {
      const maxPage    = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE))
      const allRecords: UnifiedRecord[] = firstPage.member.map(adaptMember)

      for (let page = 2; page <= maxPage; page++) {
        updateNodeData(nodeId, { statusMessage: `Page ${page}/${maxPage} (${allRecords.length} fetched)…` })
        const response = await fetchPage(q, page, sort, objectType)
        const batch    = (response.member ?? []).map(adaptMember)
        allRecords.push(...batch)
        if (batch.length < PAGE_SIZE || !response.view?.next) break
      }

      const cited   = addCitation(allRecords as Record<string, unknown>[], citationBase)
      const version = setNodeResults(nodeId, cited)
      updateNodeData(nodeId, {
        status:         'success',
        statusMessage:  `✓ ${allRecords.length.toLocaleString()} of ${total.toLocaleString()}`,
        count:          total,
        resultsVersion: version,
      })
    } else {
      const allRecords: UnifiedRecord[] = firstPage.member.map(adaptMember)

      if (limit > PAGE_SIZE && firstPage.view?.next) {
        const pageCount = Math.min(Math.ceil(limit / PAGE_SIZE), MAX_PAGES)
        for (let page = 2; page <= pageCount; page++) {
          const r     = await fetchPage(q, page, sort, objectType)
          const batch = (r.member ?? []).map(adaptMember)
          allRecords.push(...batch)
          if (batch.length < PAGE_SIZE || !r.view?.next) break
        }
      }

      const trimmed = allRecords.slice(0, limit)
      const cited   = addCitation(trimmed as Record<string, unknown>[], citationBase)
      const version = setNodeResults(nodeId, cited)
      updateNodeData(nodeId, {
        status:         'success',
        statusMessage:  `✓ ${trimmed.length} of ${total.toLocaleString()}`,
        count:          total,
        resultsVersion: version,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Bodleian] error', msg)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
