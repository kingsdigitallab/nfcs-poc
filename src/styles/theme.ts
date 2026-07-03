/**
 * theme.ts — "Archive" design tokens for the NFCS workflow editor makeover.
 *
 * Single source of truth for the restyle. Import these constants into the
 * shell (appStyles.ts), the shared search shell (BackboneSearchNode.tsx),
 * the per-node style blocks, and sidebarItems.ts. Nothing here changes any
 * node `type`, data key, handle id, or the pinned handle geometry — this is
 * a skin, not a data contract.
 *
 * Direction: warm parchment canvas, oxblood (King's-red-derived) actions,
 * muted "archival jewel" node identities, Spectral serif for titles over
 * IBM Plex Sans, IBM Plex Mono for param micro-labels.
 *
 * Fonts must be loaded once (see index.css @import, or a <link> in index.html):
 *   Spectral, IBM Plex Sans, IBM Plex Mono.
 */

// ── Type ────────────────────────────────────────────────────────────────────
export const FONT = {
  serif: "'Spectral', Georgia, 'Times New Roman', serif", // node/section titles, wordmark
  sans:  "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif", // UI body
  mono:  "'IBM Plex Mono', ui-monospace, 'SF Mono', monospace", // param labels, debug
} as const

// ── Warm neutrals (the paper system) ────────────────────────────────────────
export const NEUTRAL = {
  canvas:      '#efe9db', // React Flow page background
  canvasDot:   '#d8cfba', // Background dot colour (set via <Background color=…/>)
  chrome:      '#f8f3e9', // top bar / sidebar / assistant panel fill
  chromeBorder:'#e6ddca', // divider between chrome and canvas
  card:        '#fffdf7', // node card fill
  cardBorder:  '#d6ccb5', // node card border at rest (== status idle)
  hairline:    '#ece3d0', // in-card dividers, sidebar item borders
  inputBorder: '#ded3bd', // input / select borders
  ink:         '#2c2a24', // primary text
  body:        '#33302a', // body text on cards
  muted:       '#8a8168', // secondary / param labels
  faint:       '#b0a891', // placeholders, disabled, captions
  tintRow:     '#faf6ec', // zebra row / subtle fill
} as const

// ── Accents ─────────────────────────────────────────────────────────────────
export const ACCENT = {
  action:  '#9d2b2b', // BRAND — Run / Run All / primary CTA (refined King's red)
  actionFg:'#fdf3ec', // text on action
  blue:    '#3d6aa5', // active / selected / wired handle
  amber:   '#b3862f', // comment + experimental accent
  navy:    '#2c3d54', // "Advanced" toggle-on chrome
} as const

// ── Status (semantics preserved: blue running / green ok / red error / grey idle) ──
export const STATUS_BORDER: Record<string, string> = {
  idle:    '#d6ccb5',
  loading: '#3d6ea3',
  success: '#4c7c4f',
  error:   '#a63b37',
  cached:  '#4c7c4f',
}
export const STATUS_BADGE: Record<string, string> = {
  idle:    '#b0a891',
  loading: '#a9c4e0',
  success: '#b7e0bb',
  error:   '#e6b0ac',
  cached:  '#b7e0bb',
}

// ── Radii / shadow / spacing ────────────────────────────────────────────────
export const RADIUS = { node: 8, header: 6, input: 5, button: 7, pill: 5 } as const
export const SHADOW = {
  node:  '0 2px 8px rgba(50,42,26,0.10)',
  raised:'0 3px 12px rgba(50,42,26,0.12)',
  panel: '0 2px 8px rgba(50,42,26,0.10)',
} as const

// ── Node identity palette (muted archival jewel tones) ──────────────────────
// Keyed by node `type`. Re-tuned from the original hand-picked Tailwind hexes,
// preserving each service's hue FAMILY so identity relationships survive
// (searches blue/teal, LLM violet, outputs teal/amber, enriching oxblood…).
// The SAME hex must be written into sidebarItems.ts `color` for each type —
// that field drives both the sidebar dot AND the minimap (nodeColourMap).
export const NODE_IDENTITY: Record<string, string> = {
  // Workflow Planning
  quickStart:       '#202d47', // ink navy
  comment:          '#b3862f', // amber
  param:            '#3d6aa5', // param blue
  // Discovering (searches)
  ariadneSearch:    '#2f4a6b', // ink blue  ← anchor tone (shown in mockup)
  hsdsSearch:       '#2b5852', // teal
  bodleianSearch:   '#26426a', // oxford ink blue
  europeanaSearch:  '#3a5896', // soft blue
  gbifSearch:       '#2c5a74', // blue-teal
  lldsSearch:       '#7a4b25', // umber
  mdsSearch:        '#34406e', // indigo
  smgSearch:        '#5b3560', // aubergine
  vaSearch:         '#7a2f3a', // oxblood
  // Gathering
  localFileSource:  '#2f5f57', // viridian
  localFolderSource:'#315a3f', // pine
  sampleDataSource: '#33465f', // slate
  urlFetch:         '#2b5265', // steel-teal
  // Enriching
  kclNode:          '#7a2f3a', // oxblood (King's)
  kclField:         '#6f2f2f', // brick-red
  geocoding:        '#2f5f57', // viridian
  smartGeocoder:    '#33465f', // slate
  htmlSection:      '#3a5a44', // moss
  xmlSection:       '#4a4640', // warm stone
  reconciliation:   '#5a3f7a', // violet
  wikidataEnrich:   '#2f5f7a', // steel-blue
  mergeByQID:       '#55396e', // violet-aubergine
  quickNote:        '#2f6660', // teal
  // Analysing
  fieldDistribution:'#37624a', // moss
  smartFilter:      '#2c5a74', // blue-teal
  filterTransform:  '#454a8a', // indigo-violet
  spatialFilter:    '#2f6673', // cyan-teal
  deduplicate:      '#2f6660', // teal
  sourceProfile:    '#2b3340', // near-black slate
  evaluatorNode:    '#454138', // warm graphite
  // Visualising
  quickView:        '#2b3340', // slate
  imageView:        '#29394a', // deep slate
  htmlPreview:      '#2b5265', // steel-teal
  tableOutput:      '#2f5f57', // viridian
  mapOutput:        '#315a3f', // pine
  timelineView:     '#2b3340', // slate
  timelineOutput:   '#4c5460', // slate-grey
  // Disseminating
  citation:         '#6f4a25', // umber
  export:           '#8a5a22', // bronze
  jsonOutput:       '#4f3f7a', // violet
  kclOutput:        '#3d2f5c', // deep violet
  comparisonReport: '#3a3a6e', // indigo
  saveSearch:       '#2f5540', // forest
  loadSavedSearch:  '#443a72', // violet
  // Experimental / hidden
  frameSenseSource: '#29394a', // deep slate
  sparqlSearch:     '#443a72', // violet
  adsLibrarySearch: '#33465f', // slate
  adsSearchAdvanced:'#7c3b2e', // brick
  ollamaNode:       '#3a3a6e', // indigo
  ollamaField:      '#2f2d52', // deep indigo
  ollamaOutput:     '#202d47', // ink navy
}

// ── BackboneTheme derivation ────────────────────────────────────────────────
// Every search-node config's `theme` object can now be replaced with a call to
// this helper, e.g.  theme: deriveBackboneTheme(NODE_IDENTITY.ariadneSearch)
// It keeps the coloured identity header, a single oxblood Run button across all
// services, and calm warm-neutral filter accents (no per-service tint noise).
export interface BackboneTheme {
  header: string; runBtn: string; accentBg: string; accentBorder: string
  sectionBg: string; clearBtn: string; fixtureIcon: string
}
export function deriveBackboneTheme(identity: string): BackboneTheme {
  return {
    header:       identity,
    runBtn:       ACCENT.action,      // consistent oxblood CTA
    accentBg:     '#f2ede0',          // warm neutral (filter toggle bg)
    accentBorder: '#e2d8c3',
    sectionBg:    '#f6f1e6',          // filter panel fill
    clearBtn:     ACCENT.action,
    fixtureIcon:  identity,           // 📦 tints to the node's own colour when on
  }
}
