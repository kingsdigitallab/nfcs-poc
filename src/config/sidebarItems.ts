import type { NodeTypeId } from '../nodes'
import { tierIncludes, type NodeTier } from './nodeTiers'

/** A single sidebar palette entry. `type` must be a registered node type —
 * a typo here is a compile error, not a silently missing palette entry.
 * `tier` is the MINIMUM visibility tier (Basic / Intermediate / Full) at which
 * the item appears; it is required so a new node cannot forget to declare one. */
export interface SidebarItem {
  type:        NodeTypeId
  label:       string
  sub:         string
  color:       string
  group:       SidebarGroup
  tier:        NodeTier
  hidden?:     true
  deprecated?: true
  alpha?:      true
}

// ─── Group ordering ────────────────────────────────────────────────────────────
// Labels use TaDiRAH 2.0 terminology; cross-checked against TADIRAHMapping.tsx.
// IMPORTANT: these strings are sidebar UI labels only — they are NOT serialised
// into .nfcs.json workflow files. Only node `type` strings (e.g. 'gbifSearch')
// are persisted and must never be renamed.

export const SIDEBAR_GROUPS = [
  'Workflow Planning',
  'Discovering',
  'Gathering',
  'Enriching',
  'Analysing',
  'Visualising',
  'Disseminating',
  'Experimental',
] as const

export type SidebarGroup = typeof SIDEBAR_GROUPS[number]

/** Groups collapsed by default when the sidebar first renders. */
export const DEFAULT_COLLAPSED_GROUPS = new Set<SidebarGroup>([
  'Discovering',
  'Gathering',
  'Enriching',
  'Analysing',
  'Disseminating',
  'Experimental',
])

// ─── Sidebar items ─────────────────────────────────────────────────────────────
// Display labels are plain English (e.g. 'AI Inference'); the node `type` keys
// and the on-disk workflow format are unchanged.

export const SIDEBAR_ITEMS: SidebarItem[] = [
  // ── Workflow Planning (TaDiRAH: Interpretation > Modeling; Canvas primitives) ─
  { type: 'quickStart',  label: 'QuickStart',        sub: 'AI workflow planner — describe a question, auto-build a workflow', color: '#202d47', group: 'Workflow Planning', tier: 'intermediate' },
  { type: 'comment',     label: 'Comment',           sub: 'Annotation label',                                color: '#b3862f', group: 'Workflow Planning', tier: 'basic' },
  { type: 'param',       label: 'Search Parameter',  sub: 'Text / Integer value shared across search nodes', color: '#3d6aa5', group: 'Workflow Planning', tier: 'basic' },
  // ── Discovering (TaDiRAH: Capture > Discovering) ───────────────────────────────
  { type: 'ariadneSearch',     label: 'ARIADNESearch',         sub: 'ARIADNE pan-European archaeology portal',  color: '#2f4a6b', group: 'Discovering', tier: 'basic' },
  { type: 'hsdsSearch',        label: 'HSDSSearch',            sub: 'Heritage Science Data Service',           color: '#2b5852', group: 'Discovering', tier: 'basic' },
  { type: 'bodleianSearch',    label: 'BodleianSearch',        sub: 'Bodleian Digital Collections (Oxford)',    color: '#26426a', group: 'Discovering', tier: 'basic' },
  { type: 'europeanaSearch',   label: 'EuropeanaSearch',       sub: 'Europeana cultural heritage aggregator',  color: '#3a5896', group: 'Discovering', tier: 'basic' },
  { type: 'gbifSearch',        label: 'GBIFSearch',            sub: 'GBIF occurrence search',                  color: '#2c5a74', group: 'Discovering', tier: 'basic' },
  { type: 'lldsSearch',        label: 'LLDSSearch',            sub: 'Lit. & Linguistic Data',                  color: '#7a4b25', group: 'Discovering', tier: 'basic' },
  { type: 'mdsSearch',         label: 'MDSSearch',             sub: 'Museum Data Services',                    color: '#34406e', group: 'Discovering', tier: 'basic' },
  { type: 'nhmSearch',         label: 'NHMSearch',             sub: 'Natural History Museum specimens (incl. mineralogy)', color: '#5e6b2b', group: 'Discovering', tier: 'basic' },
  { type: 'smgSearch',         label: 'SMGSearch',             sub: 'Science Museum Group collections',        color: '#5b3560', group: 'Discovering', tier: 'basic' },
  { type: 'vaSearch',          label: 'VASearch',              sub: 'Victoria and Albert Museum collections',  color: '#7a2f3a', group: 'Discovering', tier: 'basic' },
  // ── Gathering (TaDiRAH: Capture > Gathering) ──────────────────────────────────
  { type: 'localFileSource',   label: 'LocalFileSource',       sub: 'Single CSV, XML, image or PDF file',      color: '#2f5f57', group: 'Gathering', tier: 'basic' },
  { type: 'localFolderSource', label: 'LocalFolderSource',     sub: 'Read files from local folder',            color: '#315a3f', group: 'Gathering', tier: 'intermediate' },
  { type: 'sampleDataSource',  label: 'SampleDataSource',      sub: 'Load packaged collection data (XML, text, PDF)', color: '#33465f', group: 'Gathering', tier: 'basic' },
  { type: 'urlFetch',          label: 'URLContentFetch',       sub: 'Fetch URL content into records',          color: '#2b5265', group: 'Gathering', tier: 'intermediate' },
  // ── Enriching (TaDiRAH: Enrichment) ───────────────────────────────────────────
  { type: 'kclNode',           label: 'AI Inference',            sub: 'AI inference over file/content records',  color: '#7a2f3a', group: 'Enriching', tier: 'basic' },
  { type: 'kclField',          label: 'AI Inference (by field)', sub: 'AI inference on a chosen field',          color: '#6f2f2f', group: 'Enriching', tier: 'basic' },
  { type: 'geocoding',         label: 'Geocoding',             sub: 'TGN + Wikidata place enrichment',         color: '#2f5f57', group: 'Enriching', tier: 'full' },
  { type: 'smartGeocoder',     label: 'SmartGeocoder',         sub: 'LLM place extraction → Nominatim + TGN + Wikidata', color: '#33465f', group: 'Enriching', tier: 'full' },
  { type: 'htmlSection',       label: 'HTMLExtract',           sub: 'Extract page section by CSS selector',    color: '#3a5a44', group: 'Enriching', tier: 'intermediate' },
  { type: 'xmlSection',        label: 'XMLExtract',            sub: 'Extract XML content by XPath',            color: '#4a4640', group: 'Enriching', tier: 'intermediate' },
  { type: 'reconciliation',    label: 'Reconciliation',        sub: 'Wikidata field reconciler',               color: '#5a3f7a', group: 'Enriching', tier: 'intermediate' },
  { type: 'wikidataEnrich',    label: 'WikidataEnrich',        sub: 'Fetch Wikidata properties for QIDs',      color: '#2f5f7a', group: 'Enriching', tier: 'intermediate' },
  { type: 'mergeByQID',        label: 'MergeByQID',            sub: 'Join records from multiple sources by QID', color: '#55396e', group: 'Enriching', tier: 'full' },
  { type: 'quickNote',         label: 'QuickNote',             sub: 'Read a field in full and write per-record notes', color: '#2f6660', group: 'Enriching', tier: 'full' },
  // ── Analysing (TaDiRAH: Analysis) ─────────────────────────────────────────────
  { type: 'fieldDistribution', label: 'FieldDistribution',     sub: 'Faceted bar chart — click bars to filter', color: '#37624a', group: 'Analysing', tier: 'basic' },
  { type: 'smartFilter',       label: 'SmartFilter',           sub: 'Natural language → filter records',       color: '#2c5a74', group: 'Analysing', tier: 'full' },
  { type: 'filterTransform',   label: 'Filter and Transform',  sub: 'Filter + transform records',              color: '#454a8a', group: 'Analysing', tier: 'intermediate' },
  { type: 'spatialFilter',     label: 'SpatialFilter',         sub: 'Draw bounding box to filter by location', color: '#2f6673', group: 'Analysing', tier: 'full' },
  { type: 'deduplicate',       label: 'Deduplicate',           sub: 'Remove duplicate records by field value', color: '#2f6660', group: 'Analysing', tier: 'intermediate' },
  { type: 'sourceProfile',     label: 'SourceProfile',         sub: 'Schema, field stats, completeness + AI narrative', color: '#2b3340', group: 'Analysing', tier: 'basic' },
  { type: 'evaluatorNode',     label: 'Evaluator',             sub: 'LLM-as-judge — score candidate vs reference field', color: '#454138', group: 'Analysing', tier: 'full' },
  // ── Visualising (TaDiRAH: Analysis > Visual Analysis; Dissemination > Sharing) ─
  { type: 'quickView',         label: 'QuickView',             sub: 'Inspect one field in full',               color: '#2b3340', group: 'Visualising', tier: 'intermediate' },
  { type: 'imageView',         label: 'ImageView',             sub: 'Image + IIIF manifest viewer',            color: '#29394a', group: 'Visualising', tier: 'intermediate' },
  { type: 'htmlPreview',       label: 'HTMLPreview',           sub: 'Browse captured HTML, click to capture CSS selectors', color: '#2b5265', group: 'Visualising', tier: 'intermediate' },
  { type: 'tableOutput',       label: 'TableOutput',           sub: 'Paginated results table',                 color: '#2f5f57', group: 'Visualising', tier: 'basic' },
  { type: 'mapOutput',         label: 'MapOutput',             sub: 'Geo map (lat/lon records)',                color: '#315a3f', group: 'Visualising', tier: 'basic' },
  { type: 'timelineView',      label: 'Timeline',              sub: 'Timeline of records by date — drag to filter by range', color: '#2b3340', group: 'Visualising', tier: 'basic' },
  // `timelineOutput` is a backward-compat alias of `timelineView` (same component +
  // runner). Kept registered so saved workflows load, and kept HERE (hidden) so the
  // minimap colour / lineage label lookups still resolve — but not offered in the palette.
  { type: 'timelineOutput',    label: 'Timeline',              sub: 'Alias of Timeline (legacy workflows)',    color: '#2b3340', group: 'Visualising', tier: 'basic', hidden: true },
  // ── Disseminating (TaDiRAH: Dissemination; Storage > Organizing/Archiving) ────
  { type: 'citation',          label: 'Citation',              sub: 'Data source citations for this workflow stage', color: '#6f4a25', group: 'Disseminating', tier: 'basic' },
  { type: 'export',            label: 'Export',                sub: 'CSV / JSON / GeoJSON',                    color: '#8a5a22', group: 'Disseminating', tier: 'basic' },
  { type: 'jsonOutput',        label: 'JSONOutput',            sub: 'Formatted JSON viewer',                   color: '#4f3f7a', group: 'Disseminating', tier: 'intermediate' },
  { type: 'kclOutput',         label: 'AI Inference Output',   sub: 'Display AI inference text',               color: '#3d2f5c', group: 'Disseminating', tier: 'basic' },
  { type: 'comparisonReport',  label: 'ComparisonReport',      sub: 'Judge-vs-human evaluation cards + agreement summary', color: '#3a3a6e', group: 'Disseminating', tier: 'full' },
  { type: 'saveSearch',        label: 'SaveSearch',            sub: 'Save records + metadata to .nfcs.json',   color: '#2f5540', group: 'Disseminating', tier: 'basic' },
  { type: 'loadSavedSearch',   label: 'LoadSavedSearch',       sub: 'Replay a .nfcs.json saved search',        color: '#443a72', group: 'Disseminating', tier: 'basic' },
  // ── Experimental (alpha nodes — collapsed by default; the group appears once any item is in tier) ─
  { type: 'frameSenseSource',  label: 'FrameSenseSource',      sub: 'Load pre-processed FrameSense video shots', color: '#29394a', group: 'Experimental', tier: 'full', alpha: true },
  { type: 'sparqlSearch',      label: 'SPARQLSearch',          sub: 'Wikidata SPARQL — query builder or raw query', color: '#443a72', group: 'Experimental', tier: 'intermediate', alpha: true },
  // ── Full tier only: local Ollama inference ───────────────────────────────────
  { type: 'ollamaNode',        label: 'Ollama',                sub: 'Local LLM — file/content records',        color: '#3a3a6e', group: 'Enriching', tier: 'full' },
  { type: 'ollamaField',       label: 'OllamaByField',         sub: 'LLM inference on a chosen field',         color: '#2f2d52', group: 'Enriching', tier: 'full' },
  { type: 'ollamaOutput',      label: 'OllamaOutput',          sub: 'Display Ollama inference text',           color: '#202d47', group: 'Disseminating', tier: 'full' },
]

/** Palette entries visible at `tier` (hidden aliases excluded), in declaration order. */
export function visibleSidebarItems(tier: NodeTier): SidebarItem[] {
  return SIDEBAR_ITEMS.filter(i => !i.hidden && tierIncludes(tier, i.tier))
}

const TIER_BY_TYPE = new Map<string, NodeTier>(SIDEBAR_ITEMS.map(i => [i.type, i.tier]))

/** True when a node type is offered at `tier` (unknown types are always allowed). */
export function isTypeInTier(type: string, tier: NodeTier): boolean {
  const required = TIER_BY_TYPE.get(type)
  return required === undefined || tierIncludes(tier, required)
}
