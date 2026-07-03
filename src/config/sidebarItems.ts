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
  { type: 'quickStart',  label: 'QuickStart',        sub: 'AI workflow planner — describe a question, auto-build a workflow', color: '#0c1445', group: 'Workflow Planning' },
  { type: 'comment',     label: 'Comment',           sub: 'Annotation label',                                color: '#f59e0b', group: 'Workflow Planning' },
  { type: 'param',       label: 'Param',             sub: 'Text / Integer value',                            color: '#3b82f6', group: 'Workflow Planning' },
  // ── Discovering (TaDiRAH: Capture > Discovering) ───────────────────────────────
  { type: 'ariadneSearch',     label: 'ARIADNESearch',         sub: 'ARIADNE pan-European archaeology portal',  color: '#164e63', group: 'Discovering' },
  { type: 'hsdsSearch',        label: 'HSDSSearch',            sub: 'Heritage Science Data Service',           color: '#134e4a', group: 'Discovering' },
  { type: 'bodleianSearch',    label: 'BodleianSearch',        sub: 'Bodleian Digital Collections (Oxford)',    color: '#003865', group: 'Discovering' },
  { type: 'europeanaSearch',   label: 'EuropeanaSearch',       sub: 'Europeana cultural heritage aggregator',  color: '#2563eb', group: 'Discovering' },
  { type: 'gbifSearch',        label: 'GBIFSearch',            sub: 'GBIF occurrence search',                  color: '#0f4c81', group: 'Discovering' },
  { type: 'lldsSearch',        label: 'LLDSSearch',            sub: 'Lit. & Linguistic Data',                  color: '#92400e', group: 'Discovering' },
  { type: 'mdsSearch',         label: 'MDSSearch',             sub: 'Museum Data Services',                    color: '#1e3a8a', group: 'Discovering' },
  { type: 'smgSearch',         label: 'SMGSearch',             sub: 'Science Museum Group collections',        color: '#701a75', group: 'Discovering' },
  { type: 'vaSearch',          label: 'VASearch',              sub: 'Victoria and Albert Museum collections',  color: '#9f1239', group: 'Discovering' },
  // ── Gathering (TaDiRAH: Capture > Gathering) ──────────────────────────────────
  { type: 'localFileSource',   label: 'LocalFileSource',       sub: 'Single CSV, XML, image or PDF file',      color: '#0e7490', group: 'Gathering' },
  { type: 'localFolderSource', label: 'LocalFolderSource',     sub: 'Read files from local folder',            color: '#14532d', group: 'Gathering' },
  { type: 'sampleDataSource',  label: 'SampleDataSource',      sub: 'Load packaged collection data (XML, text, PDF)', color: '#1e3a5f', group: 'Gathering' },
  { type: 'urlFetch',          label: 'URLContentFetch',       sub: 'Fetch URL content into records',          color: '#0c4a6e', group: 'Gathering' },
  // ── Enriching (TaDiRAH: Enrichment) ───────────────────────────────────────────
  { type: 'kclNode',           label: 'KingsInference',        sub: 'KCL inference — file/content records',    color: '#881337', group: 'Enriching' },
  { type: 'kclField',          label: 'KingsInferenceByField', sub: 'KCL inference on a chosen field',         color: '#7f1d1d', group: 'Enriching' },
  { type: 'geocoding',         label: 'Geocoding',             sub: 'TGN + Wikidata place enrichment',         color: '#065f46', group: 'Enriching' },
  { type: 'smartGeocoder',     label: 'SmartGeocoder',         sub: 'LLM place extraction → Nominatim + TGN + Wikidata', color: '#1e3a5f', group: 'Enriching' },
  { type: 'htmlSection',       label: 'HTMLExtract',           sub: 'Extract page section by CSS selector',    color: '#065f46', group: 'Enriching' },
  { type: 'xmlSection',        label: 'XMLExtract',            sub: 'Extract XML content by XPath',            color: '#44403c', group: 'Enriching' },
  { type: 'reconciliation',    label: 'Reconciliation',        sub: 'Wikidata field reconciler',               color: '#7c3aed', group: 'Enriching' },
  { type: 'wikidataEnrich',    label: 'WikidataEnrich',        sub: 'Fetch Wikidata properties for QIDs',      color: '#0369a1', group: 'Enriching' },
  { type: 'mergeByQID',        label: 'MergeByQID',            sub: 'Join records from multiple sources by QID', color: '#6b21a8', group: 'Enriching' },
  { type: 'quickNote',         label: 'QuickNote',             sub: 'Read a field in full and write per-record notes', color: '#0f766e', group: 'Enriching' },
  // ── Analysing (TaDiRAH: Analysis) ─────────────────────────────────────────────
  { type: 'fieldDistribution', label: 'FieldDistribution',     sub: 'Faceted bar chart — click bars to filter', color: '#047857', group: 'Analysing' },
  { type: 'smartFilter',       label: 'SmartFilter',           sub: 'Natural language → filter records',       color: '#0f4c81', group: 'Analysing' },
  { type: 'filterTransform',   label: 'FilterTransform',       sub: 'Filter + transform records',              color: '#4f46e5', group: 'Analysing' },
  { type: 'spatialFilter',     label: 'SpatialFilter',         sub: 'Draw bounding box to filter by location', color: '#0891b2', group: 'Analysing' },
  { type: 'deduplicate',       label: 'Deduplicate',           sub: 'Remove duplicate records by field value', color: '#0f766e', group: 'Analysing' },
  { type: 'sourceProfile',     label: 'SourceProfile',         sub: 'Schema, field stats, completeness + AI narrative', color: '#1f2937', group: 'Analysing' },
  { type: 'evaluatorNode',     label: 'Evaluator',             sub: 'LLM-as-judge — score candidate vs reference field', color: '#3f3f46', group: 'Analysing' },
  // ── Visualising (TaDiRAH: Analysis > Visual Analysis; Dissemination > Sharing) ─
  { type: 'quickView',         label: 'QuickView',             sub: 'Inspect one field in full',               color: '#1e293b', group: 'Visualising' },
  { type: 'imageView',         label: 'ImageView',             sub: 'Image + IIIF manifest viewer',            color: '#1c3144', group: 'Visualising' },
  { type: 'htmlPreview',       label: 'HTMLPreview',           sub: 'Browse captured HTML, click to capture CSS selectors', color: '#0c4a6e', group: 'Visualising' },
  { type: 'tableOutput',       label: 'TableOutput',           sub: 'Paginated results table',                 color: '#0d9488', group: 'Visualising' },
  { type: 'mapOutput',         label: 'MapOutput',             sub: 'Geo map (lat/lon records)',                color: '#14532d', group: 'Visualising' },
  { type: 'timelineView',      label: 'TimelineView',          sub: 'Filter records by date range + timeline', color: '#1e293b', group: 'Visualising' },
  { type: 'timelineOutput',    label: 'TimelineOutput',        sub: 'Display-only timeline of records by date (no filtering)', color: '#475569', group: 'Visualising' },
  // ── Disseminating (TaDiRAH: Dissemination; Storage > Organizing/Archiving) ────
  { type: 'citation',          label: 'Citation',              sub: 'Data source citations for this workflow stage', color: '#78350f', group: 'Disseminating' },
  { type: 'export',            label: 'Export',                sub: 'CSV / JSON / GeoJSON',                    color: '#b45309', group: 'Disseminating' },
  { type: 'jsonOutput',        label: 'JSONOutput',            sub: 'Formatted JSON viewer',                   color: '#6d28d9', group: 'Disseminating' },
  { type: 'kclOutput',         label: 'KingsInferenceOutput',  sub: 'Display KCL inference text',              color: '#3b0764', group: 'Disseminating' },
  { type: 'comparisonReport',  label: 'ComparisonReport',      sub: 'Judge-vs-human evaluation cards + agreement summary', color: '#3730a3', group: 'Disseminating' },
  { type: 'saveSearch',        label: 'SaveSearch',            sub: 'Save records + metadata to .nfcs.json',   color: '#1b4332', group: 'Disseminating' },
  { type: 'loadSavedSearch',   label: 'LoadSavedSearch',       sub: 'Replay a .nfcs.json saved search',        color: '#4c1d95', group: 'Disseminating' },
  // ── Experimental (alpha nodes — hidden in Simple mode, collapsed by default) ───
  { type: 'frameSenseSource',  label: 'FrameSenseSource',      sub: 'Load pre-processed FrameSense video shots', color: '#1c2a3a', group: 'Experimental', alpha: true },
  { type: 'sparqlSearch',      label: 'SPARQLSearch',          sub: 'Wikidata SPARQL — query builder or raw query', color: '#4c1d95', group: 'Experimental', alpha: true },
  // ── Hidden (kept registered but not shown in sidebar) ────────────────────────
  { type: 'adsLibrarySearch',  label: 'ADSLibrary',            sub: 'ADS Library catalogue',                   color: '#1e3a5f', group: 'Disseminating', hidden: true },
  { type: 'adsSearchAdvanced', label: 'ADSSearch',             sub: 'Archaeology Data Services',               color: '#7c2d12', group: 'Disseminating', hidden: true },
  { type: 'ollamaNode',        label: 'Ollama',                sub: 'Local LLM — file/content records',        color: '#312e81', group: 'Enriching' },
  { type: 'ollamaField',       label: 'OllamaByField',         sub: 'LLM inference on a chosen field',         color: '#1e1b4b', group: 'Enriching' },
  { type: 'ollamaOutput',      label: 'OllamaOutput',          sub: 'Display Ollama inference text',           color: '#0f172a', group: 'Disseminating' },
]
