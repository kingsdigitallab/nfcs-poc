/**
 * ConnectionSuggestions — shown when a user drags a connector onto empty canvas.
 * Suggests contextually appropriate downstream nodes based on the source node type.
 *
 * HandlePicker — secondary popup shown when a selected target node has multiple
 * wirable param handles and the user needs to choose which one to connect to.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Suggestion {
  type: string
  label: string
  sub: string
  color: string
  /** null means the target has multiple param handles — show HandlePicker before creating the edge */
  targetHandle: string | null
}

export interface ParamHandle {
  id:    string
  label: string
}

// ── Param-handle registry ──────────────────────────────────────────────────────
// Maps node type → the wirable target handles that accept a Param connection.

export const NODE_PARAM_HANDLES: Record<string, ParamHandle[]> = {
  europeanaSearch: [
    { id: 'apiKey', label: 'apiKey' },
    { id: 'query',  label: 'query'  },
    { id: 'limit',  label: 'limit'  },
  ],
  ariadneSearch: [
    { id: 'query', label: 'query' },
    { id: 'limit', label: 'limit' },
  ],
  gbifSearch: [
    { id: 'q',              label: 'q (free text)'    },
    { id: 'scientificName', label: 'scientificName'   },
    { id: 'country',        label: 'country'          },
    { id: 'year',           label: 'year'             },
    { id: 'limit',          label: 'limit'            },
  ],
  lldsSearch: [
    { id: 'query', label: 'query' },
    { id: 'limit', label: 'limit' },
  ],
  mdsSearch: [
    { id: 'query', label: 'query' },
    { id: 'limit', label: 'limit' },
  ],
  kclNode:        [{ id: 'apiKey', label: 'apiKey' }],
  kclField:       [{ id: 'apiKey', label: 'apiKey' }],
  bodleianSearch: [{ id: 'query', label: 'query' }, { id: 'limit', label: 'limit' }],
}

// ── Suggestion sets ────────────────────────────────────────────────────────────

const DATA_SOURCES = new Set([
  'gbifSearch', 'lldsSearch', 'adsSearchAdvanced', 'adsLibrarySearch',
  'mdsSearch', 'europeanaSearch', 'ariadneSearch', 'bodleianSearch',
  'localFolderSource', 'localFileSource', 'loadSavedSearch',
])

const PROCESS_NODES = new Set([
  'filterTransform', 'spatialFilter', 'reconciliation',
  'urlFetch', 'htmlSection', 'xmlSection',
  'wikidataEnrich', 'mergeByQID', 'htmlPreview', 'deduplicate',
])

const INFERENCE_NODES = new Set([
  'kclNode', 'kclField', 'ollamaNode', 'ollamaField',
])

const PASS_THROUGH = new Set(['tableOutput', 'mapOutput', 'fieldDistribution', 'timelineView', 'imageView'])

const OUTPUT_SUITE: Suggestion[] = [
  { type: 'tableOutput',      label: 'TableOutput',           sub: 'Paginated results table',       color: '#0d9488', targetHandle: 'data' },
  { type: 'mapOutput',        label: 'MapOutput',             sub: 'Geo map (lat/lon)',              color: '#14532d', targetHandle: 'data' },
  { type: 'timelineView',     label: 'TimelineView',          sub: 'Year-resolution timeline',      color: '#1e293b', targetHandle: 'data' },
  { type: 'fieldDistribution',label: 'FieldDistribution',     sub: 'Faceted bar chart',             color: '#047857', targetHandle: 'data' },
  { type: 'export',           label: 'Export',                sub: 'CSV / JSON / GeoJSON',          color: '#b45309', targetHandle: 'data' },
  { type: 'imageView',        label: 'ImageView',             sub: 'IIIF manifest viewer',          color: '#1c3144', targetHandle: 'data' },
]

const ENRICH_SUITE: Suggestion[] = [
  { type: 'filterTransform',  label: 'FilterTransform',       sub: 'Filter + transform records',    color: '#4f46e5', targetHandle: 'data' },
  { type: 'deduplicate',      label: 'Deduplicate',           sub: 'Remove duplicate records',      color: '#0f766e', targetHandle: 'data' },
  { type: 'kclNode',          label: 'KingsInference',        sub: 'KCL inference on records',      color: '#881337', targetHandle: 'data' },
  { type: 'kclField',         label: 'KingsInferenceByField', sub: 'KCL inference on a field',      color: '#7f1d1d', targetHandle: 'data' },
  { type: 'reconciliation',   label: 'Reconciliation',        sub: 'Wikidata entity matching',       color: '#7c3aed', targetHandle: 'data' },
  { type: 'urlFetch',         label: 'URLContentFetch',       sub: 'Fetch URL content into records', color: '#0c4a6e', targetHandle: 'data' },
]

const SUGGESTIONS: Record<string, Suggestion[]> = {
  dataSource: [...OUTPUT_SUITE, ...ENRICH_SUITE],
  process:    [...OUTPUT_SUITE, ...ENRICH_SUITE],
  passThrough: [
    { type: 'filterTransform',  label: 'FilterTransform',       sub: 'Filter + transform records', color: '#4f46e5', targetHandle: 'data' },
    { type: 'deduplicate',      label: 'Deduplicate',           sub: 'Remove duplicate records',   color: '#0f766e', targetHandle: 'data' },
    { type: 'kclNode',          label: 'KingsInference',        sub: 'KCL inference on records',   color: '#881337', targetHandle: 'data' },
    { type: 'mapOutput',        label: 'MapOutput',             sub: 'Geo map (lat/lon)',           color: '#14532d', targetHandle: 'data' },
    { type: 'timelineView',     label: 'TimelineView',          sub: 'Year-resolution timeline',   color: '#1e293b', targetHandle: 'data' },
    { type: 'jsonOutput',       label: 'JSONOutput',            sub: 'Formatted JSON viewer',      color: '#6d28d9', targetHandle: 'data' },
    { type: 'export',           label: 'Export',                sub: 'CSV / JSON / GeoJSON',       color: '#b45309', targetHandle: 'data' },
  ],
  inference: [
    { type: 'kclOutput',        label: 'KingsInferenceOutput',  sub: 'Display inference responses', color: '#3b0764', targetHandle: 'data' },
    { type: 'tableOutput',      label: 'TableOutput',           sub: 'Paginated results table',     color: '#0d9488', targetHandle: 'data' },
    { type: 'jsonOutput',       label: 'JSONOutput',            sub: 'Formatted JSON viewer',       color: '#6d28d9', targetHandle: 'data' },
    { type: 'fieldDistribution',label: 'FieldDistribution',     sub: 'Faceted bar chart',           color: '#047857', targetHandle: 'data' },
    { type: 'export',           label: 'Export',                sub: 'CSV / JSON / GeoJSON',        color: '#b45309', targetHandle: 'data' },
  ],
  // Param suggestions: null targetHandle = multiple handles available → show HandlePicker
  param: [
    { type: 'europeanaSearch',  label: 'EuropeanaSearch',       sub: 'apiKey / query / limit',      color: '#2563eb', targetHandle: null },
    { type: 'kclNode',          label: 'KingsInference',        sub: 'Connect as API key',          color: '#881337', targetHandle: 'apiKey' },
    { type: 'kclField',         label: 'KingsInferenceByField', sub: 'Connect as API key',          color: '#7f1d1d', targetHandle: 'apiKey' },
    { type: 'ariadneSearch',    label: 'ARIADNESearch',         sub: 'query / limit',               color: '#164e63', targetHandle: null },
    { type: 'gbifSearch',       label: 'GBIFSearch',            sub: 'q / scientificName / …',      color: '#0f4c81', targetHandle: null },
    { type: 'lldsSearch',       label: 'LLDSSearch',            sub: 'query / limit',               color: '#92400e', targetHandle: null },
    { type: 'mdsSearch',        label: 'MDSSearch',             sub: 'query / limit',               color: '#1e3a8a', targetHandle: null },
    { type: 'bodleianSearch',   label: 'BodleianSearch',        sub: 'query / limit',               color: '#003865', targetHandle: null },
  ],
}

export function getSuggestions(nodeType: string): Suggestion[] {
  if (DATA_SOURCES.has(nodeType))    return SUGGESTIONS.dataSource
  if (PROCESS_NODES.has(nodeType))   return SUGGESTIONS.process
  if (PASS_THROUGH.has(nodeType))    return SUGGESTIONS.passThrough
  if (INFERENCE_NODES.has(nodeType)) return SUGGESTIONS.inference
  if (nodeType === 'param')          return SUGGESTIONS.param
  return []
}

// ── ConnectionSuggestions component ───────────────────────────────────────────

interface SuggestionsProps {
  x: number
  y: number
  sourceNodeType: string
  onSelect: (s: Suggestion) => void
  onClose: () => void
}

const PANEL_W = 232

export function ConnectionSuggestions({ x, y, sourceNodeType, onSelect, onClose }: SuggestionsProps) {
  const suggestions = getSuggestions(sourceNodeType)
  if (suggestions.length === 0) return null

  const panelH = suggestions.length * 42 + 32
  const clampX = Math.min(x + 8,  window.innerWidth  - PANEL_W - 12)
  const clampY = Math.min(y - 16, window.innerHeight - panelH  - 12)

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={onClose} />
      <div style={{ position: 'fixed', left: clampX, top: clampY, zIndex: 9999, ...panelStyle }}>
        <div style={headerStyle}>Add connected node</div>
        {suggestions.map(s => (
          <button
            key={s.type}
            style={itemStyle}
            onClick={() => { onSelect(s); onClose() }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>
                {s.label}
                {s.targetHandle === null && (
                  <span style={{ marginLeft: 5, fontSize: 9, color: '#9ca3af', fontWeight: 400 }}>pick handle ›</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.3 }}>{s.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

// ── HandlePicker component ─────────────────────────────────────────────────────

interface HandlePickerProps {
  x: number
  y: number
  handles: ParamHandle[]
  onSelect: (handleId: string) => void
  onClose: () => void
}

export function HandlePicker({ x, y, handles, onSelect, onClose }: HandlePickerProps) {
  const panelH = handles.length * 36 + 32
  const clampX = Math.min(x + 8,  window.innerWidth  - PANEL_W - 12)
  const clampY = Math.min(y - 16, window.innerHeight - panelH  - 12)

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={onClose} />
      <div style={{ position: 'fixed', left: clampX, top: clampY, zIndex: 9999, ...panelStyle }}>
        <div style={headerStyle}>Connect to handle</div>
        {handles.map(h => (
          <button
            key={h.id}
            style={itemStyle}
            onClick={() => { onSelect(h.id); onClose() }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
            <code style={{ fontSize: 12, color: '#4f46e5', fontWeight: 600 }}>{h.id}</code>
            {h.label !== h.id && (
              <span style={{ fontSize: 10, color: '#9ca3af' }}>{h.label}</span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background:   '#fff',
  border:       '1px solid #e5e7eb',
  borderRadius: 8,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.13)',
  minWidth:     PANEL_W,
  overflow:     'hidden',
}

const headerStyle: React.CSSProperties = {
  padding:       '7px 12px 6px',
  borderBottom:  '1px solid #f3f4f6',
  fontSize:      11,
  fontWeight:    700,
  color:         '#6b7280',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const itemStyle: React.CSSProperties = {
  display:    'flex',
  alignItems: 'center',
  gap:        9,
  padding:    '7px 12px',
  width:      '100%',
  border:     'none',
  background: 'transparent',
  cursor:     'pointer',
  textAlign:  'left',
}
