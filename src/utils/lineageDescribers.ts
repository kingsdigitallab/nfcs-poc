/**
 * lineageDescribers — per-node-type "what I did" sentences for the lineage
 * narrative (docs/context-accrual.md §5). Each describer reads ONLY node.data
 * and returns one human-readable sentence. Key names are pinned by
 * lineageDescribers.test.ts — the count/config keys are NOT uniform across
 * node types (reconciliation `resolvedCount`/`reviewCount`, geocoding bare
 * `resolved`/`pending`/`failed`, merge `mergedCount`/`unmatchedCount`, …).
 *
 * Registered per node type with the same `satisfies` guard as nodeRunners —
 * a typo'd type string is a compile error. Types without a describer get the
 * generic label + counts fallback via describeNode().
 */
import type { Node } from '@xyflow/react'
import type { NodeTypeId } from '../nodes'
import { SIDEBAR_ITEMS } from '../config/sidebarItems'

type NodeData = Record<string, unknown>
export type LineageDescriber = (data: NodeData) => string

const LABEL_BY_TYPE = new Map<string, string>(SIDEBAR_ITEMS.map(i => [i.type as string, i.label]))

// ── helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function clip(s: string, max = 90): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** "Country=England; Period=Iron Age" from the non-empty keys of a facet map. */
function facetSummary(d: NodeData, facets: Array<[key: string, label: string]>): string {
  const parts: string[] = []
  for (const [key, label] of facets) {
    const v = d[key]
    if (typeof v === 'string' && v.trim() !== '' && v !== 'any') parts.push(`${label}=${v}`)
    if (v === true) parts.push(label)
  }
  return parts.join('; ')
}

function countClause(d: NodeData): string {
  const count = num(d.count)
  if (count === undefined) return ''
  const total = num(d._total)
  if (d._capped === true && total !== undefined) return `; retrieved ${count} of ${total} results`
  return `; retrieved ${count} results`
}

/** Shared describer for the search family — query + optional facets + counts. */
function describeSearch(service: string, facets: Array<[string, string]> = []): LineageDescriber {
  return d => {
    const query = str(d.inlineQuery) || str(d.inlineQ)
    const f = facetSummary(d, facets)
    let s = `Searched ${service}`
    s += query ? ` for "${query}"` : ' with no query term'
    if (f) s += ` with filters: ${f}`
    if (d.fetchAll === true) s += ' (fetching all results)'
    s += countClause(d)
    return `${s}.`
  }
}

const ARIADNE_FACETS: Array<[string, string]> = [
  ['ariadneSubject', 'Resource type'], ['derivedSubject', 'Getty AAT subject'],
  ['nativeSubject', 'Native subject'], ['country', 'Country'],
  ['dataType', 'Data type'], ['temporal', 'Period'], ['contributor', 'Contributor'],
]

// ── registry ─────────────────────────────────────────────────────────────────

export const lineageDescribers: Record<string, LineageDescriber> = {
  // Search family
  ariadneSearch:   describeSearch('ARIADNE (pan-European archaeology portal)', ARIADNE_FACETS),
  hsdsSearch:      describeSearch('HSDS (UK Heritage Science Data Service)', ARIADNE_FACETS),
  gbifSearch:      describeSearch('GBIF (biodiversity occurrences)', [
    ['inlineScientificName', 'Scientific name'], ['inlineCountry', 'Country'], ['inlineYear', 'Year'],
  ]),
  europeanaSearch: describeSearch('Europeana (pan-European cultural heritage)', [
    ['typeFilter', 'Type'], ['reusability', 'Reusability'], ['mediaOnly', 'Media only'],
  ]),
  bodleianSearch:  describeSearch('Bodleian Digital Collections'),
  smgSearch:       describeSearch('Science Museum Group collection'),
  vaSearch:        describeSearch('V&A collection'),
  lldsSearch:      describeSearch('LLDS (Oxford linguistics data)'),
  mdsSearch:       describeSearch('Museum Data Service'),

  sparqlSearch: d => {
    const kw     = str(d.inlineQuery)
    const cls    = str(d.builderInstanceOf)
    const custom = d.builderCustom === true || d.queryMode === 'raw'
    let s = 'Queried Wikidata (SPARQL)'
    if (kw) s += ` for "${kw}"`
    if (custom) s += ' with a hand-written query'
    else if (cls) s += ` — instances of ${cls}`
    s += countClause(d)
    return `${s}.`
  },

  filterTransform: d => {
    const parts: string[] = []
    const filterOps = Array.isArray(d.filterOps) ? d.filterOps as Array<Record<string, unknown>> : []
    const transformOps = Array.isArray(d.transformOps) ? d.transformOps as Array<Record<string, unknown>> : []
    if (filterOps.length > 0) {
      const combinator = d.filterCombinator === 'OR' ? ' OR ' : ' AND '
      const clauses = filterOps.slice(0, 3)
        .map(op => `${op.field} ${op.operator} ${op.value !== '' && op.value != null ? `"${op.value}"` : ''}`.trim())
        .join(combinator)
      parts.push(`Filtered records where ${clauses}${filterOps.length > 3 ? ` (+${filterOps.length - 3} more)` : ''}`)
    }
    if (transformOps.length > 0) {
      const kinds = transformOps.slice(0, 3)
        .map(op => op.type === 'rename' ? `renamed "${op.field}" → "${op.newName}"` : `${op.type} on "${op.field}"`)
        .join(', ')
      parts.push(`${parts.length > 0 ? 'transformed' : 'Transformed'} fields: ${kinds}${transformOps.length > 3 ? ` (+${transformOps.length - 3} more)` : ''}`)
    }
    if (parts.length === 0) parts.push('Filter/Transform (no operations configured)')
    const inC = num(d.inputCount), outC = num(d.outputCount)
    const counts = inC !== undefined && outC !== undefined ? `: ${outC} of ${inC} records passed` : ''
    return `${parts.join('; ')}${counts}.`
  },

  smartFilter: d => {
    const gf = d.generatedFilter as { explanation?: unknown } | null | undefined
    const explanation = gf && typeof gf === 'object' ? str(gf.explanation) : ''
    const matched = num(d.matchCount), total = num(d.totalCount)
    const counts = matched !== undefined && total !== undefined && total > 0
      ? ` (${matched} of ${total} records matched)` : ''
    if (explanation) return `Smart-filtered records: ${explanation}${counts}.`
    const nl = str(d.nlQuery)
    return nl ? `Smart-filtered records by "${nl}"${counts}.` : `SmartFilter (no filter generated)${counts}.`
  },

  deduplicate: d => {
    const field = str(d.dedupeField) || 'id'
    const removed = num(d.removedCount)
    const inC = num(d.inputCount), outC = num(d.outputCount)
    const counts = inC !== undefined && outC !== undefined
      ? `: ${outC} unique of ${inC} records${removed !== undefined ? ` (${removed} duplicates removed)` : ''}` : ''
    return `Deduplicated records by "${field}"${counts}.`
  },

  spatialFilter: d => {
    const bbox = d.bbox as { north?: number; south?: number; east?: number; west?: number } | null | undefined
    const box = bbox && typeof bbox === 'object' && num(bbox.north) !== undefined
      ? ` to bounding box ${bbox.south?.toFixed(2)}..${bbox.north?.toFixed(2)}N, ${bbox.west?.toFixed(2)}..${bbox.east?.toFixed(2)}E` : ''
    const inC = num(d.inputCount), outC = num(d.outputCount)
    const counts = inC !== undefined && outC !== undefined ? `: ${outC} of ${inC} records inside` : ''
    return `Spatially filtered records${box}${counts}.`
  },

  reconciliation: d => {
    const field = str(d.selectedField)
    const authority = str(d.selectedAuthority)
    const threshold = num(d.confidenceThreshold)
    const resolved = num(d.resolvedCount), review = num(d.reviewCount)
    const counts = resolved !== undefined || review !== undefined
      ? ` (${resolved ?? 0} auto-resolved, ${review ?? 0} for review)` : ''
    return `Reconciled "${field || '?'}" against ${authority || 'Wikidata'}${threshold !== undefined ? ` at threshold ${threshold}` : ''}${counts}.`
  },

  mergeByQID: d => {
    const merged = num(d.mergedCount), unmatched = num(d.unmatchedCount)
    const counts = merged !== undefined
      ? `: ${merged} merged entities${unmatched !== undefined ? `, ${unmatched} unmatched${d.keepUnmatched === true ? ' (kept)' : ' (dropped)'}` : ''}` : ''
    return `Merged records from multiple sources by shared Wikidata QID${counts}.`
  },

  geocoding: d => {
    const field = str(d.placeField)
    const resolved = num(d.resolved), pending = num(d.pending), failed = num(d.failed)
    const counts = resolved !== undefined
      ? ` (${resolved} resolved, ${pending ?? 0} pending review, ${failed ?? 0} failed)` : ''
    return `Geocoded place names from "${field || '?'}" via Getty TGN + Wikidata${counts}.`
  },

  wikidataEnrich: d => {
    const props = Array.isArray(d.selectedProperties) ? d.selectedProperties.length : 0
    return `Enriched records with ${props > 0 ? `${props} Wikidata propert${props === 1 ? 'y' : 'ies'}` : 'Wikidata properties'} for reconciled QIDs.`
  },

  kclNode: d => {
    const prompt = clip(str(d.userPromptTemplate))
    return `Ran KCL inference (${str(d.model) || 'ARC model'}) per record${prompt ? ` with prompt "${prompt}"` : ''}.`
  },

  kclField: d => {
    const field = str(d.selectedField)
    return `Ran KCL field inference (${str(d.model) || 'ARC model'}, ${str(d.mode) || 'per-record'}) on "${field || '?'}".`
  },

  ollamaNode: d => {
    const prompt = clip(str(d.userPromptTemplate))
    return `Ran local Ollama inference (${str(d.model) || 'local model'}) per record${prompt ? ` with prompt "${prompt}"` : ''}.`
  },

  ollamaField: d => {
    const field = str(d.selectedField)
    return `Ran local Ollama field inference (${str(d.model) || 'local model'}, ${str(d.mode) || 'per-record'}) on "${field || '?'}".`
  },

  urlFetch: d => {
    const field = str(d.urlField) || '_sourceUrl'
    const fetched = num(d.outputCount)
    return `Fetched web content from URLs in "${field}"${d.renderJs === true ? ' (JS-rendered)' : ''}${fetched !== undefined ? `: ${fetched} records processed` : ''}.`
  },

  htmlSection: d => `Extracted HTML sections matching CSS selector "${str(d.selector) || '?'}" into the record content.`,

  xmlSection: d => `Extracted XML via XPath "${str(d.xpath) || '?'}".`,
} satisfies Partial<Record<NodeTypeId, LineageDescriber>>

// ── dispatch ─────────────────────────────────────────────────────────────────

/** Generic fallback: sidebar label + whatever counts the node exposes. */
function describeGeneric(node: Node): string {
  const label = LABEL_BY_TYPE.get(node.type ?? '') ?? node.type ?? 'node'
  const d = node.data as NodeData
  const inC = num(d.inputCount)
  const outC = num(d.outputCount) ?? num(d.count)
  if (inC !== undefined && outC !== undefined) return `${label}: ${inC} records in, ${outC} out.`
  if (outC !== undefined) return `${label}: produced ${outC} records.`
  return `${label}.`
}

/** One-sentence description of what a node did, from its data alone. */
export function describeNode(node: Node): string {
  const describer = lineageDescribers[node.type ?? '']
  return describer ? describer(node.data as NodeData) : describeGeneric(node)
}
