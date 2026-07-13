import type { NodeTypeId } from '../nodes'

/** A single sidebar palette entry. `type` must be a registered node type —
 * a typo here is a compile error, not a silently missing palette entry. */
export interface SidebarItem {
  type:        NodeTypeId
  label:       string
  sub:         string
  color:       string
  group:       SidebarGroup
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

// ─── Advanced-only node types (hidden in Simple mode) ─────────────────────────
// Hoisted to module level — previously re-allocated on every render inside the
// sidebar .map() callback.

export const ADVANCED_TYPES = new Set([
  'frameSenseSource', 'smartFilter', 'smartGeocoder',
  'ollamaNode', 'ollamaField', 'ollamaOutput',
])

// ─── Sidebar items ─────────────────────────────────────────────────────────────

export const SIDEBAR_ITEMS: SidebarItem[] = [
  // ── Workflow Planning (TaDiRAH: Interpretation > Modeling; Canvas primitives) ─
  { type: 'quickStart',  label: 'QuickStart',        sub: 'AI workflow planner — describe a question, auto-build a workflow', color: '#202d47', group: 'Workflow Planning' },
  { type: 'comment',     label: 'Comment',           sub: 'Annotation label',                                color: '#b3862f', group: 'Workflow Planning' },
  { type: 'param',       label: 'Param',             sub: 'Text / Integer value',                            color: '#3d6aa5', group: 'Workflow Planning' },
  // ── Discovering (TaDiRAH: Capture > Discovering) ───────────────────────────────
  { type: 'ariadneSearch',     label: 'ARIADNESearch',         sub: 'ARIADNE pan-European archaeology portal',  color: '#2f4a6b', group: 'Discovering' },
  { type: 'hsdsSearch',        label: 'HSDSSearch',            sub: 'Heritage Science Data Service',           color: '#2b5852', group: 'Discovering' },
  { type: 'bodleianSearch',    label: 'BodleianSearch',        sub: 'Bodleian Digital Collections (Oxford)',    color: '#26426a', group: 'Discovering' },
  { type: 'europeanaSearch',   label: 'EuropeanaSearch',       sub: 'Europeana cultural heritage aggregator',  color: '#3a5896', group: 'Discovering' },
  { type: 'gbifSearch',        label: 'GBIFSearch',            sub: 'GBIF occurrence search',                  color: '#2c5a74', group: 'Discovering' },
  { type: 'lldsSearch',        label: 'LLDSSearch',            sub: 'Lit. & Linguistic Data',                  color: '#7a4b25', group: 'Discovering' },
  { type: 'mdsSearch',         label: 'MDSSearch',             sub: 'Museum Data Services',                    color: '#34406e', group: 'Discovering' },
  { type: 'smgSearch',         label: 'SMGSearch',             sub: 'Science Museum Group collections',        color: '#5b3560', group: 'Discovering' },
  { type: 'vaSearch',          label: 'VASearch',              sub: 'Victoria and Albert Museum collections',  color: '#7a2f3a', group: 'Discovering' },
  // ── Gathering (TaDiRAH: Capture > Gathering) ──────────────────────────────────
  { type: 'localFileSource',   label: 'LocalFileSource',       sub: 'Single CSV, XML, image or PDF file',      color: '#2f5f57', group: 'Gathering' },
  { type: 'localFolderSource', label: 'LocalFolderSource',     sub: 'Read files from local folder',            color: '#315a3f', group: 'Gathering' },
  { type: 'sampleDataSource',  label: 'SampleDataSource',      sub: 'Load packaged collection data (XML, text, PDF)', color: '#33465f', group: 'Gathering' },
  { type: 'urlFetch',          label: 'URLContentFetch',       sub: 'Fetch URL content into records',          color: '#2b5265', group: 'Gathering' },
  // ── Enriching (TaDiRAH: Enrichment) ───────────────────────────────────────────
  { type: 'kclNode',           label: 'KingsInference',        sub: 'KCL inference — file/content records',    color: '#7a2f3a', group: 'Enriching' },
  { type: 'kclField',          label: 'KingsInferenceByField', sub: 'KCL inference on a chosen field',         color: '#6f2f2f', group: 'Enriching' },
  { type: 'geocoding',         label: 'Geocoding',             sub: 'TGN + Wikidata place enrichment',         color: '#2f5f57', group: 'Enriching' },
  { type: 'smartGeocoder',     label: 'SmartGeocoder',         sub: 'LLM place extraction → Nominatim + TGN + Wikidata', color: '#33465f', group: 'Enriching' },
  { type: 'htmlSection',       label: 'HTMLExtract',           sub: 'Extract page section by CSS selector',    color: '#3a5a44', group: 'Enriching' },
  { type: 'xmlSection',        label: 'XMLExtract',            sub: 'Extract XML content by XPath',            color: '#4a4640', group: 'Enriching' },
  { type: 'reconciliation',    label: 'Reconciliation',        sub: 'Wikidata field reconciler',               color: '#5a3f7a', group: 'Enriching' },
  { type: 'wikidataEnrich',    label: 'WikidataEnrich',        sub: 'Fetch Wikidata properties for QIDs',      color: '#2f5f7a', group: 'Enriching' },
  { type: 'mergeByQID',        label: 'MergeByQID',            sub: 'Join records from multiple sources by QID', color: '#55396e', group: 'Enriching' },
  { type: 'quickNote',         label: 'QuickNote',             sub: 'Read a field in full and write per-record notes', color: '#2f6660', group: 'Enriching' },
  // ── Analysing (TaDiRAH: Analysis) ─────────────────────────────────────────────
  { type: 'fieldDistribution', label: 'FieldDistribution',     sub: 'Faceted bar chart — click bars to filter', color: '#37624a', group: 'Analysing' },
  { type: 'smartFilter',       label: 'SmartFilter',           sub: 'Natural language → filter records',       color: '#2c5a74', group: 'Analysing' },
  { type: 'filterTransform',   label: 'FilterTransform',       sub: 'Filter + transform records',              color: '#454a8a', group: 'Analysing' },
  { type: 'spatialFilter',     label: 'SpatialFilter',         sub: 'Draw bounding box to filter by location', color: '#2f6673', group: 'Analysing' },
  { type: 'deduplicate',       label: 'Deduplicate',           sub: 'Remove duplicate records by field value', color: '#2f6660', group: 'Analysing' },
  { type: 'sourceProfile',     label: 'SourceProfile',         sub: 'Schema, field stats, completeness + AI narrative', color: '#2b3340', group: 'Analysing' },
  { type: 'evaluatorNode',     label: 'Evaluator',             sub: 'LLM-as-judge — score candidate vs reference field', color: '#454138', group: 'Analysing' },
  // ── Visualising (TaDiRAH: Analysis > Visual Analysis; Dissemination > Sharing) ─
  { type: 'quickView',         label: 'QuickView',             sub: 'Inspect one field in full',               color: '#2b3340', group: 'Visualising' },
  { type: 'imageView',         label: 'ImageView',             sub: 'Image + IIIF manifest viewer',            color: '#29394a', group: 'Visualising' },
  { type: 'htmlPreview',       label: 'HTMLPreview',           sub: 'Browse captured HTML, click to capture CSS selectors', color: '#2b5265', group: 'Visualising' },
  { type: 'tableOutput',       label: 'TableOutput',           sub: 'Paginated results table',                 color: '#2f5f57', group: 'Visualising' },
  { type: 'mapOutput',         label: 'MapOutput',             sub: 'Geo map (lat/lon records)',                color: '#315a3f', group: 'Visualising' },
  { type: 'timelineView',      label: 'TimelineView',          sub: 'Filter records by date range + timeline', color: '#2b3340', group: 'Visualising' },
  { type: 'timelineOutput',    label: 'TimelineOutput',        sub: 'Display-only timeline of records by date (no filtering)', color: '#4c5460', group: 'Visualising' },
  // ── Disseminating (TaDiRAH: Dissemination; Storage > Organizing/Archiving) ────
  { type: 'citation',          label: 'Citation',              sub: 'Data source citations for this workflow stage', color: '#6f4a25', group: 'Disseminating' },
  { type: 'export',            label: 'Export',                sub: 'CSV / JSON / GeoJSON',                    color: '#8a5a22', group: 'Disseminating' },
  { type: 'jsonOutput',        label: 'JSONOutput',            sub: 'Formatted JSON viewer',                   color: '#4f3f7a', group: 'Disseminating' },
  { type: 'kclOutput',         label: 'KingsInferenceOutput',  sub: 'Display KCL inference text',              color: '#3d2f5c', group: 'Disseminating' },
  { type: 'comparisonReport',  label: 'ComparisonReport',      sub: 'Judge-vs-human evaluation cards + agreement summary', color: '#3a3a6e', group: 'Disseminating' },
  { type: 'saveSearch',        label: 'SaveSearch',            sub: 'Save records + metadata to .nfcs.json',   color: '#2f5540', group: 'Disseminating' },
  { type: 'loadSavedSearch',   label: 'LoadSavedSearch',       sub: 'Replay a .nfcs.json saved search',        color: '#443a72', group: 'Disseminating' },
  // ── Experimental (alpha nodes — hidden in Simple mode, collapsed by default) ───
  { type: 'frameSenseSource',  label: 'FrameSenseSource',      sub: 'Load pre-processed FrameSense video shots', color: '#29394a', group: 'Experimental', alpha: true },
  { type: 'sparqlSearch',      label: 'SPARQLSearch',          sub: 'Wikidata SPARQL — query builder or raw query', color: '#443a72', group: 'Experimental', alpha: true },
  // ── Hidden (kept registered but not shown in sidebar) ────────────────────────
  { type: 'adsLibrarySearch',  label: 'ADSLibrary',            sub: 'ADS Library catalogue',                   color: '#33465f', group: 'Disseminating', hidden: true },
  { type: 'adsSearchAdvanced', label: 'ADSSearch',             sub: 'Archaeology Data Services',               color: '#7c3b2e', group: 'Disseminating', hidden: true },
  { type: 'ollamaNode',        label: 'Ollama',                sub: 'Local LLM — file/content records',        color: '#3a3a6e', group: 'Enriching' },
  { type: 'ollamaField',       label: 'OllamaByField',         sub: 'LLM inference on a chosen field',         color: '#2f2d52', group: 'Enriching' },
  { type: 'ollamaOutput',      label: 'OllamaOutput',          sub: 'Display Ollama inference text',           color: '#202d47', group: 'Disseminating' },
]
