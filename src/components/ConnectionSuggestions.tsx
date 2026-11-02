/**
 * ConnectionSuggestions — shown when a user drags a connector onto empty canvas.
 * Suggests contextually appropriate downstream nodes based on the source node type.
 *
 * HandlePicker — secondary popup shown when a selected target node has multiple
 * wirable param handles and the user needs to choose which one to connect to.
 */

import { SIDEBAR_ITEMS, isTypeInTier } from '../config/sidebarItems'
import type { NodeTier } from '../config/nodeTiers'
import type { NodeTypeId } from '../nodes'

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
  hsdsSearch: [
    { id: 'query', label: 'query' },
    { id: 'limit', label: 'limit' },
  ],
  nhmSearch: [
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
  smgSearch:      [{ id: 'query', label: 'query' }, { id: 'limit', label: 'limit' }],
  vaSearch:       [{ id: 'query', label: 'query' }, { id: 'limit', label: 'limit' }],
}

// ── Suggestion sets ────────────────────────────────────────────────────────────

const DATA_SOURCES = new Set([
  'gbifSearch', 'lldsSearch',
  'mdsSearch', 'europeanaSearch', 'ariadneSearch', 'hsdsSearch', 'nhmSearch', 'bodleianSearch',
  'smgSearch', 'vaSearch', 'localFolderSource', 'localFileSource', 'loadSavedSearch',
])

const PROCESS_NODES = new Set([
  'filterTransform', 'spatialFilter', 'smartFilter', 'reconciliation',
  'urlFetch', 'htmlSection', 'xmlSection',
  'wikidataEnrich', 'mergeByQID', 'htmlPreview', 'deduplicate', 'geocoding',
])

const INFERENCE_NODES = new Set([
  'kclNode', 'kclField', 'ollamaNode', 'ollamaField',
])

const PASS_THROUGH = new Set(['tableOutput', 'mapOutput', 'fieldDistribution', 'timelineView', 'imageView', 'sourceProfile', 'quickNote'])

// Display labels come from SIDEBAR_ITEMS (single source of truth) so a palette
// rename cannot drift out of sync with the suggestion popup.
const LABEL_BY_TYPE = new Map<string, string>(SIDEBAR_ITEMS.map(i => [i.type, i.label]))

/** Build a Suggestion whose label is looked up from the sidebar registry. */
const S = (type: NodeTypeId, sub: string, color: string, targetHandle: string | null = 'data'): Suggestion =>
  ({ type, label: LABEL_BY_TYPE.get(type) ?? type, sub, color, targetHandle })

const OUTPUT_SUITE: Suggestion[] = [
  S('tableOutput',       'Paginated results table',       '#0d9488'),
  S('mapOutput',         'Geo map (lat/lon)',             '#14532d'),
  S('timelineView',      'Year-resolution timeline',      '#1e293b'),
  S('fieldDistribution', 'Faceted bar chart',             '#047857'),
  S('export',            'CSV / JSON / GeoJSON',          '#b45309'),
  S('imageView',         'IIIF manifest viewer',          '#1c3144'),
]

const ENRICH_SUITE: Suggestion[] = [
  S('smartFilter',       'Natural language filter',        '#0f4c81'),
  S('filterTransform',   'Filter + transform records',     '#4f46e5'),
  S('deduplicate',       'Remove duplicate records',       '#0f766e'),
  S('kclNode',           'AI inference on records',        '#881337'),
  S('kclField',          'AI inference on a field',        '#7f1d1d'),
  S('reconciliation',    'Wikidata entity matching',       '#7c3aed'),
  S('urlFetch',          'Fetch URL content into records', '#0c4a6e'),
]

const SUGGESTIONS: Record<string, Suggestion[]> = {
  dataSource: [...OUTPUT_SUITE, ...ENRICH_SUITE],
  process:    [...OUTPUT_SUITE, ...ENRICH_SUITE],
  passThrough: [
    S('tableOutput',     'Paginated results table',                 '#0d9488'),
    S('mapOutput',       'Geo map (lat/lon)',                       '#14532d'),
    S('timelineView',    'Year-resolution timeline',                '#1e293b'),
    S('imageView',       'IIIF manifest viewer',                    '#1c3144'),
    S('quickNote',       'Read a field and write per-record notes', '#0f766e'),
    S('export',          'CSV / JSON / GeoJSON',                    '#b45309'),
    S('filterTransform', 'Filter + transform records',              '#4f46e5'),
    S('deduplicate',     'Remove duplicate records',                '#0f766e'),
    S('kclField',        'AI inference on a field',                 '#7f1d1d'),
    S('kclNode',         'AI inference on records',                 '#881337'),
    S('jsonOutput',      'Formatted JSON viewer',                   '#6d28d9'),
  ],
  inference: [
    S('kclOutput',         'Display inference responses', '#3b0764'),
    S('tableOutput',       'Paginated results table',     '#0d9488'),
    S('jsonOutput',        'Formatted JSON viewer',       '#6d28d9'),
    S('fieldDistribution', 'Faceted bar chart',           '#047857'),
    S('export',            'CSV / JSON / GeoJSON',        '#b45309'),
  ],
  // Param suggestions: null targetHandle = multiple handles available → show HandlePicker
  param: [
    S('europeanaSearch', 'apiKey / query / limit',  '#2563eb', null),
    S('kclNode',         'Connect as API key',      '#881337', 'apiKey'),
    S('kclField',        'Connect as API key',      '#7f1d1d', 'apiKey'),
    S('ariadneSearch',   'query / limit',           '#164e63', null),
    S('hsdsSearch',      'query / limit',           '#134e4a', null),
    S('nhmSearch',       'query / limit',           '#5e6b2b', null),
    S('gbifSearch',      'q / scientificName / …',  '#0f4c81', null),
    S('lldsSearch',      'query / limit',           '#92400e', null),
    S('mdsSearch',       'query / limit',           '#1e3a8a', null),
    S('bodleianSearch',  'query / limit',           '#003865', null),
    S('smgSearch',       'query / limit',           '#701a75', null),
    S('vaSearch',        'query / limit',           '#9f1239', null),
  ],
}

const SAMPLE_DATA_SUGGESTIONS: Suggestion[] = [
  S('tableOutput', 'Paginated results table',                 '#0d9488'),
  S('quickView',   'Inspect one field in full',               '#1e293b'),
  S('quickNote',   'Read a field and write per-record notes', '#0f766e'),
  S('xmlSection',  'Extract XML content by XPath',            '#44403c'),
  S('imageView',   'Image + IIIF manifest viewer',            '#1c3144'),
]

function suggestionsFor(nodeType: string): Suggestion[] {
  if (nodeType === 'sampleDataSource') return SAMPLE_DATA_SUGGESTIONS
  if (DATA_SOURCES.has(nodeType))    return SUGGESTIONS.dataSource
  if (PROCESS_NODES.has(nodeType))   return SUGGESTIONS.process
  if (PASS_THROUGH.has(nodeType))    return SUGGESTIONS.passThrough
  if (INFERENCE_NODES.has(nodeType)) return SUGGESTIONS.inference
  if (nodeType === 'param')          return SUGGESTIONS.param
  return []
}

/**
 * Suggestions for a source node type, restricted to nodes the user can also
 * find in the palette at the current visibility tier (default: everything).
 */
export function getSuggestions(nodeType: string, tier: NodeTier = 'full'): Suggestion[] {
  return suggestionsFor(nodeType).filter(s => isTypeInTier(s.type, tier))
}

// ── ConnectionSuggestions component ───────────────────────────────────────────

interface SuggestionsProps {
  x: number
  y: number
  sourceNodeType: string
  /** Current node visibility tier — suggestions outside it are not offered. */
  nodeTier?: NodeTier
  onSelect: (s: Suggestion) => void
  onClose: () => void
}

const PANEL_W = 232

export function ConnectionSuggestions({ x, y, sourceNodeType, nodeTier = 'full', onSelect, onClose }: SuggestionsProps) {
  const suggestions = getSuggestions(sourceNodeType, nodeTier)
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
              <div style={{ fontSize: 12, fontWeight: 600, color: '#2c2a24', lineHeight: 1.3 }}>
                {s.label}
                {s.targetHandle === null && (
                  <span style={{ marginLeft: 5, fontSize: 9, color: '#b0a891', fontWeight: 400 }}>pick handle ›</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#b0a891', lineHeight: 1.3 }}>{s.sub}</div>
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
              <span style={{ fontSize: 10, color: '#b0a891' }}>{h.label}</span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background:   '#fffdf7',
  border:       '1px solid #ece3d0',
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
  color:         '#8a8168',
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
