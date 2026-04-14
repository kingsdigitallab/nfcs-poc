import { useEffect, useRef, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { UnifiedRecord } from '../types/UnifiedRecord'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { runSpatialFilterNode } from '../utils/runSpatialFilterNode'

export interface SpatialFilterNodeData {
  bbox: { north: number; south: number; east: number; west: number } | null
  status: 'idle' | 'success' | 'error'
  statusMessage: string
  results: UnifiedRecord[] | undefined
  inputCount: number
  outputCount: number
  [key: string]: unknown
}

const MAP_W = 340
const MAP_H = 220

const S = {
  inHandle: { background: '#3b82f6', width: 8, height: 8 },
  outHandle: { background: '#10b981', width: 8, height: 8 },
}

export function SpatialFilterNode({ id }: { id: string }) {
  const { getNodes, getEdges: snap, updateNodeData } = useReactFlow()
  const { records: upstreamRecords, connected } = useUpstreamRecords(id)
  const nodeData = getNodes().find(n => n.id === id)?.data as SpatialFilterNodeData | undefined

  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const rectangleRef = useRef<L.Rectangle | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startLatLng, setStartLatLng] = useState<L.LatLng | null>(null)

  // Initialize map once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return

    const map = L.map(mapDivRef.current, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false,
    })

    map.setView([20, 0], 2)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    const layerGroup = L.layerGroup().addTo(map)
    mapRef.current = map
    layerGroupRef.current = layerGroup

    return () => {
      if (mapRef.current) mapRef.current.remove()
      mapRef.current = null
    }
  }, [])

  // Update plotted records
  useEffect(() => {
    if (!layerGroupRef.current || !upstreamRecords) return

    layerGroupRef.current.clearLayers()

    const recordsWithCoords = upstreamRecords.filter(
      r => r.decimalLatitude != null && r.decimalLongitude != null,
    )

    recordsWithCoords.forEach(r => {
      L.circleMarker([+r.decimalLatitude!, +r.decimalLongitude!], {
        radius: 4,
        color: '#3b82f6',
        weight: 1,
        opacity: 0.7,
        fillColor: '#3b82f6',
        fillOpacity: 0.5,
      }).addTo(layerGroupRef.current!)
    })
  }, [upstreamRecords])

  // Draw saved bbox rectangle
  useEffect(() => {
    if (!mapRef.current) return

    if (rectangleRef.current) {
      rectangleRef.current.remove()
      rectangleRef.current = null
    }

    if (nodeData?.bbox) {
      const { north, south, east, west } = nodeData.bbox
      const rect = L.rectangle([[south, west], [north, east]], {
        color: '#f59e0b',
        weight: 2,
        fillColor: '#fbbf24',
        fillOpacity: 0.2,
        dashArray: '5, 5',
      }).addTo(mapRef.current)
      rectangleRef.current = rect
    }
  }, [nodeData?.bbox])

  // Map interaction: drawing
  const handleMapMouseDown = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!isDrawing || !mapRef.current) return
      setStartLatLng(e.latlng)
    },
    [isDrawing],
  )

  const handleMapMouseMove = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!isDrawing || !startLatLng || !mapRef.current) return

      if (rectangleRef.current) rectangleRef.current.remove()

      const rect = L.rectangle([[startLatLng.lat, startLatLng.lng], [e.latlng.lat, e.latlng.lng]], {
        color: '#ef4444',
        weight: 2,
        fillColor: '#fca5a5',
        fillOpacity: 0.3,
      }).addTo(mapRef.current)

      rectangleRef.current = rect
    },
    [isDrawing, startLatLng],
  )

  const handleMapMouseUp = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!isDrawing || !startLatLng || !mapRef.current) return

      // Create final bbox
      const lat1 = startLatLng.lat
      const lat2 = e.latlng.lat
      const lon1 = startLatLng.lng
      const lon2 = e.latlng.lng

      const bbox = {
        north: Math.max(lat1, lat2),
        south: Math.min(lat1, lat2),
        east: Math.max(lon1, lon2),
        west: Math.min(lon1, lon2),
      }

      // Save bbox and exit draw mode
      updateNodeData(id, { bbox })
      setIsDrawing(false)
      setStartLatLng(null)

      // Redraw with final colors
      if (rectangleRef.current) rectangleRef.current.remove()
      const finalRect = L.rectangle(
        [[bbox.south, bbox.west], [bbox.north, bbox.east]],
        {
          color: '#f59e0b',
          weight: 2,
          fillColor: '#fbbf24',
          fillOpacity: 0.2,
          dashArray: '5, 5',
        },
      ).addTo(mapRef.current)
      rectangleRef.current = finalRect
    },
    [isDrawing, startLatLng, id, updateNodeData],
  )

  useEffect(() => {
    if (!mapRef.current) return

    if (isDrawing) {
      // Disable map dragging to allow rectangle drawing
      mapRef.current.dragging.disable()
      mapRef.current.on('mousedown', handleMapMouseDown)
      mapRef.current.on('mousemove', handleMapMouseMove)
      mapRef.current.on('mouseup', handleMapMouseUp)
      mapDivRef.current!.style.cursor = 'crosshair'

      return () => {
        mapRef.current?.off('mousedown', handleMapMouseDown)
        mapRef.current?.off('mousemove', handleMapMouseMove)
        mapRef.current?.off('mouseup', handleMapMouseUp)
        mapRef.current?.dragging.enable()
        mapDivRef.current!.style.cursor = 'grab'
      }
    } else {
      mapDivRef.current!.style.cursor = 'grab'
    }
  }, [isDrawing, handleMapMouseDown, handleMapMouseMove, handleMapMouseUp])

  const handleRun = useCallback(
    () => runSpatialFilterNode(id, getNodes, snap(), updateNodeData),
    [id, getNodes, snap, updateNodeData],
  )

  const handleClear = useCallback(() => {
    updateNodeData(id, { bbox: null, results: undefined, statusMessage: '' })
    if (rectangleRef.current) {
      rectangleRef.current.remove()
      rectangleRef.current = null
    }
  }, [id, updateNodeData])

  const statusColor =
    nodeData?.status === 'success'
      ? '#10b981'
      : nodeData?.status === 'error'
        ? '#ef4444'
        : '#6b7280'

  return (
    <div className="bg-white border-l-4 rounded shadow-lg" style={{ borderLeftColor: '#0891b2' }}>
      {/* Header */}
      <div
        className="px-4 py-2 font-semibold text-white text-sm"
        style={{ backgroundColor: '#0891b2' }}
      >
        Spatial Filter
      </div>

      {/* Content */}
      <div className="w-full" style={{ width: MAP_W }}>
        {/* Map */}
        <div
          ref={mapDivRef}
          className="nodrag nowheel"
          style={{ width: MAP_W, height: MAP_H, borderBottom: '1px solid #e5e7eb' }}
        />

        {/* Controls */}
        <div className="p-3 space-y-2 bg-gray-50 border-t">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setIsDrawing(!isDrawing)}
              className={`px-2 py-1 rounded text-xs font-medium nodrag ${
                isDrawing
                  ? 'bg-red-500 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {isDrawing ? 'Cancel' : 'Draw Box'}
            </button>
            <button
              onClick={handleClear}
              disabled={!nodeData?.bbox}
              className="px-2 py-1 rounded text-xs font-medium nodrag bg-gray-300 hover:bg-gray-400 text-gray-800 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              onClick={handleRun}
              disabled={!connected}
              className="px-2 py-1 rounded text-xs font-medium nodrag bg-green-500 hover:bg-green-600 text-white disabled:opacity-50"
            >
              Run
            </button>
          </div>

          {/* Status */}
          <div className="text-xs">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: statusColor }}
              />
              <span className="text-gray-700 font-medium">
                {nodeData?.inputCount ?? 0} → {nodeData?.outputCount ?? 0}
              </span>
            </div>
            {nodeData?.statusMessage && (
              <div className="text-gray-600 mt-1 truncate">{nodeData.statusMessage}</div>
            )}
          </div>

          {/* Bbox info */}
          {nodeData?.bbox && (
            <div className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-200">
              <div className="font-semibold mb-1">Bounding Box:</div>
              <div>N: {nodeData.bbox.north.toFixed(2)}°</div>
              <div>S: {nodeData.bbox.south.toFixed(2)}°</div>
              <div>E: {nodeData.bbox.east.toFixed(2)}°</div>
              <div>W: {nodeData.bbox.west.toFixed(2)}°</div>
            </div>
          )}
        </div>
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} id="data" style={S.inHandle} />
      <Handle type="source" position={Position.Right} id="results" style={S.outHandle} />
    </div>
  )
}
