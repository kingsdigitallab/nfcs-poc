/**
 * MapOutputNode — renders a Leaflet map inside a React Flow node.
 *
 * Accepts connections from:
 *   - Any SearchNode (GBIF, ADS, LLDS, MDS) via the `data` input handle
 *   - TableOutputNode via its pass-through `results` output handle
 *
 * Records that carry decimalLatitude + decimalLongitude are plotted as
 * colour-coded CircleMarkers, one colour per _source. Clicking a marker
 * opens a popup with title, source badge, date, description snippet and a
 * "View record" link.
 *
 * Leaflet is used directly (vanilla JS) rather than via react-leaflet to
 * avoid React 19 compatibility concerns. The map DOM node is stable across
 * re-renders; only the marker layer is rebuilt when upstream records change.
 *
 * `className="nodrag nowheel"` on the map container tells React Flow to
 * leave mouse events alone so Leaflet's pan and scroll-zoom work normally.
 */

import { useEffect, useRef, useMemo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'

// ─── source colour palette ────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  gbif: '#16a34a',   // green
  ads:  '#c2410c',   // orange-red
  mds:  '#1d4ed8',   // blue
  llds: '#b45309',   // amber
}
const FALLBACK_COLOR = '#6366f1'

function markerColor(source: string | undefined): string {
  return SOURCE_COLORS[source ?? ''] ?? FALLBACK_COLOR
}

// Simple HTML escaping for popup content built as a string
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── component ────────────────────────────────────────────────────────────────

const MAP_W = 480
const MAP_H = 300

export function MapOutputNode({ id }: NodeProps) {
  const { records, connected, status, sourceCount } = useUpstreamRecords(id)

  const mapDivRef     = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const prevKeyRef    = useRef('')

  // ── legend data (render-time, not in effect) ───────────────────────────────
  const { mappableCount, bySource } = useMemo(() => {
    const bySource: Record<string, number> = {}
    let mappableCount = 0
    for (const r of records ?? []) {
      if (r.decimalLatitude != null && r.decimalLongitude != null) {
        mappableCount++
        const src = r._source ?? 'unknown'
        bySource[src] = (bySource[src] ?? 0) + 1
      }
    }
    return { mappableCount, bySource }
  }, [records])

  // ── initialise Leaflet map once on mount ───────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return

    const map = L.map(mapDivRef.current, {
      center:      [54.0, -2.0],   // UK centroid
      zoom:        5,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current        = map
    layerGroupRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current        = null
      layerGroupRef.current = null
    }
  }, [])

  // ── rebuild markers when records change ────────────────────────────────────
  useEffect(() => {
    const map   = mapRef.current
    const layer = layerGroupRef.current
    if (!map || !layer) return

    const mappable = (records ?? []).filter(
      r => r.decimalLatitude != null && r.decimalLongitude != null,
    )

    // Bail out early if the set of mapped points hasn't actually changed
    const key = mappable
      .map(r => `${r.id}:${r.decimalLatitude},${r.decimalLongitude}`)
      .join('|')
    if (key === prevKeyRef.current) return
    prevKeyRef.current = key

    layer.clearLayers()
    if (mappable.length === 0) return

    const bounds: L.LatLngTuple[] = []

    for (const r of mappable) {
      const lat   = r.decimalLatitude  as number
      const lng   = r.decimalLongitude as number
      const color = markerColor(r._source)

      const rawTitle = r.title ?? r.scientificName ?? '(no title)'
      const title    = rawTitle.length > 80 ? rawTitle.slice(0, 80) + '…' : rawTitle
      const rawDesc  = r.description ?? ''
      const desc     = rawDesc.length > 140 ? rawDesc.slice(0, 140) + '…' : rawDesc

      const popup = `
        <div style="font-family:system-ui,sans-serif;min-width:180px;max-width:260px">
          <strong style="font-size:12px;line-height:1.4;display:block">
            ${esc(title)}
          </strong>
          <div style="margin-top:3px;font-size:11px;color:#6b7280;display:flex;align-items:center;gap:4px">
            <span style="
              display:inline-block;width:8px;height:8px;border-radius:50%;
              background:${color};flex-shrink:0
            "></span>
            ${esc(r._source ?? '')}${r.date ? ` · ${esc(String(r.date))}` : ''}
          </div>
          ${desc ? `<div style="margin-top:5px;font-size:11px;color:#374151;line-height:1.4">${esc(desc)}</div>` : ''}
          ${r._sourceUrl ? `<a href="${esc(r._sourceUrl)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;margin-top:6px;font-size:11px;color:#0d9488;text-decoration:none">
              View record →
            </a>` : ''}
        </div>`

      L.circleMarker([lat, lng], {
        radius:      6,
        color:       '#fff',
        weight:      1.5,
        fillColor:   color,
        fillOpacity: 0.85,
      })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(layer)

      bounds.push([lat, lng])
    }

    if (bounds.length > 0) {
      try {
        map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 12 })
      } catch {
        // fitBounds can throw on degenerate bounds — ignore
      }
    }
  }, [records])

  // ── status text shown in the header ───────────────────────────────────────
  const headerNote = !connected
    ? 'Connect a search or table node'
    : status === 'loading'
      ? 'Loading…'
      : mappableCount > 0
        ? `${mappableCount} point${mappableCount !== 1 ? 's' : ''}${sourceCount > 1 ? ` · ${sourceCount} sources` : ''}`
        : records
          ? 'No mappable records (no coordinates)'
          : 'Run the upstream node'

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Map Output</span>
        <span style={styles.badge}>{headerNote}</span>
      </div>

      {/* Leaflet map — nodrag + nowheel prevent RF from consuming map events */}
      <div
        ref={mapDivRef}
        className="nodrag nowheel"
        style={{ width: MAP_W, height: MAP_H }}
      />

      {/* Legend */}
      {Object.keys(bySource).length > 0 && (
        <div style={styles.legend}>
          {Object.entries(bySource).map(([src, n]) => (
            <span key={src} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: markerColor(src) }} />
              {src} ({n})
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#14532d'   // dark forest green — evokes maps/geography

const styles = {
  card: {
    background:   '#fff',
    border:       '1.5px solid #d1d5db',
    borderRadius: 8,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    overflow:     'hidden',
    width:        MAP_W,
  },
  header: {
    background:     HEADER_COLOR,
    padding:        '6px 10px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  title: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
    flexShrink: 0,
  },
  badge: {
    color:        '#bbf7d0',
    fontSize:     10,
    fontWeight:   600,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  legend: {
    display:    'flex',
    flexWrap:   'wrap' as const,
    gap:        '4px 12px',
    padding:    '5px 10px 6px',
    background: '#f9fafb',
    borderTop:  '1px solid #e5e7eb',
  },
  legendItem: {
    display:    'flex',
    alignItems: 'center',
    gap:        5,
    fontSize:   10,
    color:      '#4b5563',
  },
  legendDot: {
    width:        8,
    height:       8,
    borderRadius: '50%',
    flexShrink:   0,
  },
  inputHandle: {
    width:      10,
    height:     10,
    background: HEADER_COLOR,
    border:     '2px solid #fff',
    boxShadow:  `0 0 0 1px ${HEADER_COLOR}`,
  },
}
