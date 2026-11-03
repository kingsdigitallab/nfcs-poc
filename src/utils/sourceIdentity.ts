/**
 * sourceIdentity — the ONE table of how a record's `_source` looks and is
 * named across the app: display name, marker colour, a dark banner variant
 * and a marker shape. Timeline, Map, Source Profile and the Image View /
 * AI-node labels all read it. Never add a local SOURCE_COLORS table to a
 * node: three drifted copies are how six institutions ended up as the same
 * indigo circle on the timeline (Nov 2026).
 *
 * Shapes carry identity as well as colour so two sources never collide on
 * both; each shape group is spread across the hue wheel.
 */

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond'

export interface SourceIdentity {
  key:    string
  name:   string
  /** Mid-tone marker/legend colour (readable on cream node bodies and map tiles). */
  colour: string
  /** Dark (-900) variant for banners with near-white text. */
  banner: string
  shape:  MarkerShape
}

export const SHAPE_GLYPHS: Record<MarkerShape, string> = {
  circle:   '●',
  square:   '■',
  triangle: '▲',
  diamond:  '◆',
}

/** Neutral grey — says "unmapped source", unlike a colour that could pass for an institution. */
export const FALLBACK_COLOUR = '#a1a1aa'
const FALLBACK_BANNER = '#52525b'

const id = (key: string, name: string, shape: MarkerShape, colour: string, banner: string): SourceIdentity =>
  ({ key, name, shape, colour, banner })

export const SOURCE_IDENTITIES: Record<string, SourceIdentity> = Object.fromEntries([
  // circles
  id('gbif',        'GBIF',                    'circle',   '#16a34a', '#14532d'),
  id('nhm',         'Natural History Museum',  'circle',   '#0d9488', '#134e4a'),
  id('framesense',  'FrameSense',              'circle',   '#475569', '#1e293b'),
  id('imageView',   'Image View',              'circle',   '#64748b', '#334155'),
  id('kclField',    'AI Inference',            'circle',   '#71717a', '#3f3f46'),
  id('ollamaField', 'Ollama (by field)',       'circle',   '#57534e', '#292524'),
  id('merged',      'Merged',                  'circle',   '#78716c', '#44403c'),
  // squares
  id('europeana',   'Europeana',               'square',   '#2563eb', '#1e3a8a'),
  id('bodleian',    'Bodleian',                'square',   '#7c3aed', '#4c1d95'),
  id('llds',        'LLDS',                    'square',   '#ca8a04', '#713f12'),
  // triangles
  id('smg',         'Science Museum Group',    'triangle', '#ea580c', '#7c2d12'),
  id('hsds',        'HSDS',                    'triangle', '#db2777', '#831843'),
  id('mds',         'MDS',                     'triangle', '#0e7490', '#164e63'),
  // diamonds
  id('vam',         'V&A',                     'diamond',  '#be123c', '#881337'),
  id('ariadne',     'ARIADNE',                 'diamond',  '#78350f', '#451a03'),
  id('sparql',      'Wikidata SPARQL',         'diamond',  '#4f46e5', '#312e81'),
].map(i => [i.key, i]))

/** Display names for `_source` keys — derived from the identities. */
export const SOURCE_NAMES: Record<string, string> =
  Object.fromEntries(Object.values(SOURCE_IDENTITIES).map(i => [i.key, i.name]))

export function sourceName(src: string | undefined): string {
  if (!src) return 'Unknown source'
  return SOURCE_NAMES[src] ?? src.charAt(0).toUpperCase() + src.slice(1)
}

export function sourceIdentity(src: string | undefined): SourceIdentity {
  return (src && SOURCE_IDENTITIES[src]) || {
    key: src ?? '', name: sourceName(src), colour: FALLBACK_COLOUR, banner: FALLBACK_BANNER, shape: 'circle',
  }
}

const SHAPE_ORDER: Record<MarkerShape, number> = { circle: 0, square: 1, triangle: 2, diamond: 3 }

/** Sort comparator: same-shape sources cluster, then by key (fallback sources sort last within their shape). */
export function compareBySourceShape(a: { _source?: unknown }, b: { _source?: unknown }): number {
  const ia = sourceIdentity(typeof a._source === 'string' ? a._source : undefined)
  const ib = sourceIdentity(typeof b._source === 'string' ? b._source : undefined)
  const d = SHAPE_ORDER[ia.shape] - SHAPE_ORDER[ib.shape]
  if (d !== 0) return d
  const ka = SOURCE_IDENTITIES[ia.key] ? ia.key : '~' + ia.key
  const kb = SOURCE_IDENTITIES[ib.key] ? ib.key : '~' + ib.key
  return ka < kb ? -1 : ka > kb ? 1 : 0
}
