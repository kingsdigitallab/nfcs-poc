/**
 * MapOutputNode — Leaflet map with optional bounding-box spatial filter.
 *
 * Input handles:
 *   Left  `data` — any search / process node
 *   Top   `gis`  — GIS layer overlays
 *
 * Output handle:
 *   Right `results` — filtered records (all records when no bbox drawn)
 *
 * Draw a bbox on the map, then click Run to apply the spatial filter and
 * emit the filtered set through the `results` handle to downstream nodes
 * (Table, Timeline, Export, etc.).  When no bbox is drawn, Run passes all
 * upstream records through unchanged.
 *
 * Leaflet is used directly (vanilla JS) rather than via react-leaflet to
 * avoid React 19 compatibility concerns.
 */

import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import {
  Handle, Position, type NodeProps,
  useNodes, useEdges, useReactFlow,
} from '@xyflow/react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// @ts-ignore
import 'leaflet.markercluster'
// @ts-ignore
import 'leaflet.markercluster/dist/MarkerCluster.css'
// @ts-ignore
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { runMapOutputNode } from '../utils/runMapOutputNode'
import type { GisLayer } from '../utils/gisReaders'

// ─── data interface ───────────────────────────────────────────────────────────

export interface MapOutputNodeData {
  bbox:           { north: number; south: number; east: number; west: number } | null
  inputCount:     number
  outputCount:    number
  resultsVersion: number
  [key: string]: unknown
}

// ─── source colour palette ────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  gbif: '#16a34a',
  ads:  '#c2410c',
  mds:  '#1d4ed8',
  llds: '#b45309',
}
const FALLBACK_COLOR = '#6366f1'

function markerColor(source: string | undefined): string {
  return SOURCE_COLORS[source ?? ''] ?? FALLBACK_COLOR
}

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
  const { records, connected, status, sourceCount, count } = useUpstreamRecords(id)
  const [clusteringEnabled, setClusteringEnabled] = useState(true)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startLatLng, setStartLatLng] = useState<L.LatLng | null>(null)

  const { updateNodeData, getNodes, getEdges } = useReactFlow()

  const allNodes = useNodes()
  const allEdges = useEdges()

  const nodeData = useMemo(
    () => allNodes.find(n => n.id === id)?.data as MapOutputNodeData | undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allNodes, id],
  )

  const gisLayers = useMemo<GisLayer[]>(() => {
    const gisEdges = allEdges.filter(e => e.target === id && e.targetHandle === 'gis')
    return gisEdges.flatMap(e => {
      const src = allNodes.find(n => n.id === e.source)
      return (src?.data?.gisLayers as GisLayer[] | undefined) ?? []
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEdges, allNodes, id])

  const mapDivRef       = useRef<HTMLDivElement>(null)
  const mapRef          = useRef<L.Map | null>(null)
  const layerGroupRef   = useRef<L.LayerGroup | null>(null)
  const clusterGroupRef = useRef<any>(null)
  const gisLayerGroupRef = useRef<L.LayerGroup | null>(null)
  const rectangleRef    = useRef<L.Rectangle | null>(null)
  const fittedFpRef     = useRef<string | null>(null)   // prevents fitBounds on non-data re-renders
  const lastRunFpRef    = useRef<string | null>(null)   // loop guard for auto pass-through
  const panOverrideRef  = useRef(false)                 // true while Shift-to-pan is active

  // ── legend data ────────────────────────────────────────────────────────────
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

  // ── init Leaflet map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return

    const map = L.map(mapDivRef.current, {
      center:      [54.0, -2.0],
      zoom:        5,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current         = map
    clusterGroupRef.current = (L as any).markerClusterGroup()
    layerGroupRef.current   = L.layerGroup().addTo(map)
    gisLayerGroupRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current          = null
      layerGroupRef.current   = null
      clusterGroupRef.current = null
      gisLayerGroupRef.current = null
    }
  }, [])

  // ── rebuild markers when records / clustering / bbox changes ───────────────
  useEffect(() => {
    const map          = mapRef.current
    const regularLayer = layerGroupRef.current
    const clusterGroup = clusterGroupRef.current
    if (!map || !regularLayer || !clusterGroup) return

    const mappable = (records ?? []).filter(
      r => r.decimalLatitude != null && r.decimalLongitude != null,
    )

    regularLayer.clearLayers()
    clusterGroup.clearLayers()

    if (mappable.length === 0) return

    const bbox        = nodeData?.bbox ?? null
    const targetLayer = clusteringEnabled ? clusterGroup : regularLayer
    const bounds: L.LatLngTuple[] = []

    for (const r of mappable) {
      const lat   = r.decimalLatitude  as number
      const lng   = r.decimalLongitude as number
      const color = markerColor(r._source)

      const inBbox = bbox
        ? lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east
        : true

      const rawTitle = (r.title as string | undefined)
        ?? (String((r.gbif as Record<string, unknown> | undefined)?.scientificName ?? '') || '(no title)')
      const title    = rawTitle.length > 80 ? rawTitle.slice(0, 80) + '…' : rawTitle
      const rawDesc  = r.description ?? ''
      const desc     = rawDesc.length > 140 ? rawDesc.slice(0, 140) + '…' : rawDesc

      const popup = `
        <div style="font-family:system-ui,sans-serif;min-width:180px;max-width:260px">
          <strong style="font-size:12px;line-height:1.4;display:block">${esc(title)}</strong>
          <div style="margin-top:3px;font-size:11px;color:#6b7280;display:flex;align-items:center;gap:4px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
            ${esc(r._source ?? '')}${r.date ? ` · ${esc(String(r.date))}` : ''}
          </div>
          ${desc ? `<div style="margin-top:5px;font-size:11px;color:#374151;line-height:1.4">${esc(desc)}</div>` : ''}
          ${r._sourceUrl
            ? `<a href="${esc(r._sourceUrl)}" target="_blank" rel="noopener noreferrer"
                style="display:inline-block;margin-top:6px;font-size:11px;color:#0d9488;text-decoration:none">
                View record →
               </a>`
            : ''}
        </div>`

      L.circleMarker([lat, lng], {
        radius:      6,
        color:       '#fff',
        weight:      1.5,
        fillColor:   color,
        fillOpacity: inBbox ? 0.85 : 0.2,
        opacity:     inBbox ? 1    : 0.35,
      })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(targetLayer)

      bounds.push([lat, lng])
    }

    if (clusteringEnabled && !map.hasLayer(clusterGroup)) {
      map.addLayer(clusterGroup)
    } else if (!clusteringEnabled && map.hasLayer(clusterGroup)) {
      map.removeLayer(clusterGroup)
    }

    if (bounds.length > 0) {
      // Only fit when the plotted point set actually changes — not on bbox draws,
      // clustering toggles, or unrelated re-renders (fingerprint pattern per CLAUDE.md gotcha #3).
      const fp = `${bounds.length}:${bounds[0]?.join(',')}:${bounds[bounds.length - 1]?.join(',')}`
      if (fittedFpRef.current !== fp) {
        fittedFpRef.current = fp
        try {
          map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 12 })
        } catch {
          // ignore degenerate bounds
        }
      }
    }
  // nodeData?.bbox included so markers re-dim when bbox changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, clusteringEnabled, nodeData?.bbox])

  // ── render saved bbox rectangle on map ────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return

    if (rectangleRef.current) {
      rectangleRef.current.remove()
      rectangleRef.current = null
    }

    const bbox = nodeData?.bbox
    if (!bbox) return

    const { north, south, east, west } = bbox
    rectangleRef.current = L.rectangle([[south, west], [north, east]], {
      color:       '#f59e0b',
      weight:      2,
      fillColor:   '#fbbf24',
      fillOpacity: 0.12,
      dashArray:   '6, 4',
    }).addTo(mapRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.bbox])

  // ── GIS overlay layers ─────────────────────────────────────────────────────
  useEffect(() => {
    const map      = mapRef.current
    const gisGroup = gisLayerGroupRef.current
    if (!map || !gisGroup) return

    gisGroup.clearLayers()
    if (gisLayers.length === 0) return

    const GIS_COLORS = ['#f97316', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

    gisLayers.forEach((layer, idx) => {
      const color = GIS_COLORS[idx % GIS_COLORS.length]
      L.geoJSON(layer.geojson as Parameters<typeof L.geoJSON>[0], {
        style: {
          color,
          weight:      2,
          opacity:     0.8,
          fillColor:   color,
          fillOpacity: 0.15,
        },
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, {
            radius:      5,
            color:       '#fff',
            weight:      1,
            fillColor:   color,
            fillOpacity: 0.7,
          }),
        onEachFeature: (feature, leafletLayer) => {
          if (!feature.properties) return
          const props = feature.properties as Record<string, unknown>
          const label = (props.name ?? props.NAME ?? props.label ?? props.LABEL ?? layer.name) as string
          const rows = Object.entries(props)
            .filter(([, v]) => v != null && v !== '')
            .slice(0, 8)
            .map(([k, v]) =>
              `<tr><td style="font-weight:600;padding-right:6px;white-space:nowrap">${esc(k)}</td><td>${esc(String(v))}</td></tr>`,
            )
            .join('')
          leafletLayer.bindPopup(
            `<div style="font-family:system-ui,sans-serif;font-size:11px;min-width:160px">
              <strong style="display:block;margin-bottom:4px;font-size:12px">${esc(String(label))}</strong>
              ${rows ? `<table style="border-collapse:collapse">${rows}</table>` : ''}
            </div>`,
            { maxWidth: 280 },
          )
        },
      }).addTo(gisGroup)
    })
  }, [gisLayers])

  // ── bbox draw interaction ──────────────────────────────────────────────────

  const handleMapMouseDown = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!isDrawing || panOverrideRef.current) return
      setStartLatLng(e.latlng)
    },
    [isDrawing],
  )

  const handleMapMouseMove = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!isDrawing || !startLatLng || !mapRef.current) return
      if (rectangleRef.current) rectangleRef.current.remove()
      rectangleRef.current = L.rectangle(
        [[startLatLng.lat, startLatLng.lng], [e.latlng.lat, e.latlng.lng]],
        { color: '#ef4444', weight: 2, fillColor: '#fca5a5', fillOpacity: 0.3 },
      ).addTo(mapRef.current)
    },
    [isDrawing, startLatLng],
  )

  const handleMapMouseUp = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!isDrawing || !startLatLng) return
      const bbox = {
        north: Math.max(startLatLng.lat, e.latlng.lat),
        south: Math.min(startLatLng.lat, e.latlng.lat),
        east:  Math.max(startLatLng.lng, e.latlng.lng),
        west:  Math.min(startLatLng.lng, e.latlng.lng),
      }
      // The saved-bbox effect will replace the red preview with the permanent rect
      updateNodeData(id, { bbox })
      setIsDrawing(false)
      setStartLatLng(null)
    },
    [isDrawing, startLatLng, id, updateNodeData],
  )

  useEffect(() => {
    const map = mapRef.current
    const div = mapDivRef.current
    if (!map || !div) return

    if (isDrawing) {
      map.dragging.disable()
      map.on('mousedown', handleMapMouseDown)
      map.on('mousemove', handleMapMouseMove)
      map.on('mouseup',   handleMapMouseUp)
      div.style.cursor = 'crosshair'

      return () => {
        map.off('mousedown', handleMapMouseDown)
        map.off('mousemove', handleMapMouseMove)
        map.off('mouseup',   handleMapMouseUp)
        map.dragging.enable()
        div.style.cursor = ''
      }
    } else {
      div.style.cursor = ''
    }
  }, [isDrawing, handleMapMouseDown, handleMapMouseMove, handleMapMouseUp])

  // ── Shift-to-pan modifier during draw mode ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const div = mapDivRef.current
    if (!map || !div || !isDrawing) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || panOverrideRef.current) return
      panOverrideRef.current = true
      map.dragging.enable()
      div.style.cursor = 'grab'
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      panOverrideRef.current = false
      map.dragging.disable()
      div.style.cursor = 'crosshair'
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      panOverrideRef.current = false
    }
  }, [isDrawing])

  // ── run / clear ────────────────────────────────────────────────────────────

  const handleRun = useCallback(
    () => runMapOutputNode(id, getNodes, getEdges(), updateNodeData),
    [id, getNodes, getEdges, updateNodeData],
  )

  const handleClear = useCallback(() => {
    updateNodeData(id, { bbox: null, inputCount: 0, outputCount: 0 })
    if (rectangleRef.current) {
      rectangleRef.current.remove()
      rectangleRef.current = null
    }
  }, [id, updateNodeData])

  // ── auto pass-through / live bbox filter ──────────────────────────────────
  // Runs the node automatically whenever upstream data or the bbox changes so
  // downstream nodes always receive current results without requiring Run click.
  // Fingerprint guards against the render-loop that updateNodeData would cause.
  useEffect(() => {
    if (!connected) return
    const fp = `${records?.length ?? 0}|${count}|${JSON.stringify(nodeData?.bbox ?? null)}`
    if (lastRunFpRef.current === fp) return
    lastRunFpRef.current = fp
    runMapOutputNode(id, getNodes, getEdges(), updateNodeData)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, count, connected, nodeData?.bbox, id, getNodes, getEdges, updateNodeData])

  // ── header badge text ──────────────────────────────────────────────────────

  const hasBbox    = !!nodeData?.bbox
  const hasRunData = (nodeData?.inputCount ?? 0) > 0

  const headerNote = !connected
    ? 'Connect a search or table node'
    : status === 'loading'
      ? 'Loading…'
      : hasRunData
        ? hasBbox
          ? `${nodeData!.outputCount} / ${nodeData!.inputCount} in bbox → downstream`
          : `${nodeData!.outputCount} records → downstream`
        : mappableCount > 0
          ? `${mappableCount} point${mappableCount !== 1 ? 's' : ''}${sourceCount > 1 ? ` · ${sourceCount} sources` : ''}`
          : records
            ? 'No mappable records'
            : 'Run the upstream node'

  const GIS_COLORS = ['#f97316', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left}  id="data" style={styles.inputHandle} />
      <Handle type="target" position={Position.Top}   id="gis"  style={styles.gisInputHandle} title="GIS layer input" />
      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} title="Filtered results output" />

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

      {/* Controls */}
      <div style={styles.controls}>
        <label style={styles.clusterToggle}>
          <input
            type="checkbox"
            checked={clusteringEnabled}
            onChange={(e) => setClusteringEnabled(e.target.checked)}
            style={styles.checkbox}
          />
          <span>Cluster</span>
        </label>

        <div style={styles.separator} />

        <button
          className="nodrag"
          onClick={() => setIsDrawing(d => !d)}
          style={{ ...styles.btn, ...(isDrawing ? styles.btnCancel : styles.btnDraw) }}
        >
          {isDrawing ? 'Cancel' : 'Draw bbox'}
        </button>

        {isDrawing && (
          <span style={styles.shiftHint}>⇧ Shift to pan</span>
        )}

        {hasBbox && (
          <button className="nodrag" onClick={handleClear}
            style={{ ...styles.btn, ...styles.btnClear }}>
            Clear
          </button>
        )}

        <button
          className="nodrag"
          onClick={handleRun}
          disabled={!connected}
          style={{ ...styles.btn, ...styles.btnRun, ...(!connected ? styles.btnDisabled : {}) }}
        >
          Run ▶
        </button>

        {hasRunData && hasBbox && (
          <span style={styles.countBadge}>
            {nodeData!.outputCount} / {nodeData!.inputCount}
          </span>
        )}
      </div>

      {/* Bbox coordinate summary */}
      {hasBbox && (
        <div style={styles.bboxInfo}>
          N {nodeData!.bbox!.north.toFixed(2)}° · S {nodeData!.bbox!.south.toFixed(2)}° ·{' '}
          E {nodeData!.bbox!.east.toFixed(2)}° · W {nodeData!.bbox!.west.toFixed(2)}°
        </div>
      )}

      {/* Legend */}
      {(Object.keys(bySource).length > 0 || gisLayers.length > 0) && (
        <div style={styles.legend}>
          {Object.entries(bySource).map(([src, n]) => (
            <span key={src} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: markerColor(src) }} />
              {src} ({n})
            </span>
          ))}
          {gisLayers.map((layer, idx) => (
            <span key={`gis-${idx}`} style={styles.legendItem}
              title={layer.noPrj
                ? 'No .prj file — coordinates assumed WGS84. Add a .prj file alongside the .shp for automatic reprojection.'
                : undefined}>
              <span style={{ ...styles.legendDot, background: GIS_COLORS[idx % GIS_COLORS.length], borderRadius: 2 }} />
              {layer.name} ({layer.featureCount}){layer.noPrj ? ' ⚠' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#14532d'

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
  controls: {
    display:    'flex',
    alignItems: 'center',
    flexWrap:   'wrap' as const,
    gap:        6,
    padding:    '5px 8px',
    background: '#f3f4f6',
    borderTop:  '1px solid #e5e7eb',
    fontSize:   11,
  },
  clusterToggle: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    cursor:     'pointer' as const,
    color:      '#374151',
    userSelect: 'none' as const,
  },
  checkbox: { cursor: 'pointer' as const, width: 13, height: 13 },
  separator: { width: 1, height: 16, background: '#d1d5db' },
  btn: {
    padding:      '2px 8px',
    borderRadius: 4,
    border:       'none',
    fontSize:     11,
    fontWeight:   600,
    cursor:       'pointer' as const,
    lineHeight:   '18px',
  },
  btnDraw:     { background: '#3b82f6', color: '#fff' },
  btnCancel:   { background: '#ef4444', color: '#fff' },
  btnClear:    { background: '#e5e7eb', color: '#374151' },
  shiftHint:   { fontSize: 10, color: '#6b7280', fontStyle: 'italic' as const },
  btnRun:      { background: '#15803d', color: '#fff' },
  btnDisabled: { opacity: 0.45, cursor: 'not-allowed' as const },
  countBadge: {
    fontSize:     10,
    fontWeight:   700,
    color:        '#374151',
    background:   '#e5e7eb',
    padding:      '1px 7px',
    borderRadius: 10,
    marginLeft:   'auto',
  },
  bboxInfo: {
    fontSize:   10,
    color:      '#6b7280',
    padding:    '3px 10px',
    background: '#fffbeb',
    borderTop:  '1px solid #fde68a',
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
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
  gisInputHandle: {
    width:     10,
    height:    10,
    background: '#3b82f6',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #3b82f6',
  },
  outputHandle: {
    width:     10,
    height:    10,
    background: '#10b981',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #10b981',
  },
}
