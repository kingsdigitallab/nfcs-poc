/**
 * ExportNode — output node that serialises upstream records and triggers a
 * browser file download in one of three formats: CSV, JSON, or GeoJSON.
 *
 * Connects to any node that exposes a `data` handle (search nodes, table node,
 * reconciliation node).  For GeoJSON, only records with both decimalLatitude
 * and decimalLongitude are included; the node shows how many are mappable.
 */
import { useState } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { toCSV, toJSON, toGeoJSON, downloadFile, dateStamp } from '../utils/exportUtils'

// ─── types ────────────────────────────────────────────────────────────────────

type ExportFormat = 'csv' | 'json' | 'geojson'

export interface ExportNodeData {
  format: ExportFormat
  [key: string]: unknown
}

// ─── format metadata ──────────────────────────────────────────────────────────

const FORMAT_META: Record<ExportFormat, { label: string; ext: string; mime: string; desc: string }> = {
  csv:     { label: 'CSV',     ext: 'csv',     mime: 'text/csv',              desc: 'Flat table, one row per record' },
  json:    { label: 'JSON',    ext: 'json',    mime: 'application/json',      desc: 'Full record graph incl. namespaces' },
  geojson: { label: 'GeoJSON', ext: 'geojson', mime: 'application/geo+json',  desc: 'FeatureCollection (lat/lon records only)' },
}

const HEADER_COLOR = '#b45309'   // amber-700 — "output/export" identity

// ─── component ────────────────────────────────────────────────────────────────

export function ExportNode({ id }: NodeProps) {
  const { getNodes } = useReactFlow()
  const { records, connected } = useUpstreamRecords(id)
  const nodeData = getNodes().find(n => n.id === id)?.data as ExportNodeData | undefined
  const format: ExportFormat = (nodeData?.format as ExportFormat) ?? 'csv'
  const { updateNodeData } = useReactFlow()

  const [lastDownloaded, setLastDownloaded] = useState<string | null>(null)

  const meta = FORMAT_META[format]

  const geoCount = format === 'geojson'
    ? (records ?? []).filter(r => r.decimalLatitude != null && r.decimalLongitude != null).length
    : null

  const canDownload = connected && records && records.length > 0 &&
    (format !== 'geojson' || (geoCount ?? 0) > 0)

  const handleDownload = () => {
    if (!records || records.length === 0) return
    const filename = `nfcs-export-${dateStamp()}.${meta.ext}`
    let content: string
    if (format === 'csv')     content = toCSV(records)
    else if (format === 'geojson') content = toGeoJSON(records)
    else                      content = toJSON(records)
    downloadFile(content, filename, meta.mime)
    setLastDownloaded(filename)
  }

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Export</span>
        {lastDownloaded && (
          <span style={styles.lastDl} title={lastDownloaded}>✓ saved</span>
        )}
      </div>

      {/* Body */}
      <div style={styles.body}>

        {/* Format selector */}
        <div style={styles.row}>
          <span style={styles.label}>format</span>
          <select
            style={styles.select}
            value={format}
            onChange={e => {
              updateNodeData(id, { format: e.target.value as ExportFormat })
              setLastDownloaded(null)
            }}
            className="nodrag"
          >
            {(Object.keys(FORMAT_META) as ExportFormat[]).map(f => (
              <option key={f} value={f}>{FORMAT_META[f].label}</option>
            ))}
          </select>
        </div>

        {/* Format description */}
        <p style={styles.desc}>{meta.desc}</p>

        {/* Record count / geo count */}
        {connected && records ? (
          <div style={styles.counts}>
            {format === 'geojson' ? (
              <>
                <span style={geoCount === 0 ? styles.countWarn : styles.countOk}>
                  {geoCount} mappable
                </span>
                <span style={styles.countMuted}>of {records.length} records</span>
              </>
            ) : (
              <span style={styles.countOk}>{records.length} records</span>
            )}
          </div>
        ) : (
          <div style={styles.placeholder}>
            {connected ? 'Run upstream node first' : 'Connect an upstream node'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button
          style={{ ...styles.btn, opacity: canDownload ? 1 : 0.45 }}
          disabled={!canDownload}
          onClick={handleDownload}
          className="nodrag"
        >
          ⬇  Download {meta.label}
        </button>
      </div>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background:   '#fff',
    border:       '1.5px solid #d1d5db',
    borderRadius: 8,
    minWidth:     220,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
  },
  header: {
    height:         32,
    background:     HEADER_COLOR,
    borderRadius:   '6px 6px 0 0',
    padding:        '0 10px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  title: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
  },
  lastDl: {
    fontSize:   10,
    color:      '#fde68a',
    fontWeight: 600,
  },
  body: {
    padding:       '8px 14px 4px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           5,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  label: {
    fontSize:   11,
    color:      '#6b7280',
    width:      48,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    background:   '#f9fafb',
    outline:      'none',
    height:       22,
  },
  desc: {
    margin:     '0 0 0 54px',
    fontSize:   9,
    color:      '#9ca3af',
    lineHeight: 1.3,
  },
  counts: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    marginTop:  2,
  },
  countOk: {
    fontSize:     10,
    fontWeight:   600,
    color:        '#15803d',
    background:   '#dcfce7',
    border:       '1px solid #86efac',
    borderRadius: 10,
    padding:      '1px 7px',
  },
  countWarn: {
    fontSize:     10,
    fontWeight:   600,
    color:        '#92400e',
    background:   '#fef9c3',
    border:       '1px solid #fde68a',
    borderRadius: 10,
    padding:      '1px 7px',
  },
  countMuted: {
    fontSize: 10,
    color:    '#9ca3af',
  },
  placeholder: {
    fontSize:   10,
    color:      '#9ca3af',
    fontStyle:  'italic' as const,
    marginTop:  2,
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    justifyContent: 'flex-end',
  },
  btn: {
    background:   HEADER_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 14px',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
  },
  inputHandle: {
    width:        10,
    height:       10,
    background:   HEADER_COLOR,
    border:       '2px solid #fff',
    boxShadow:    `0 0 0 1px ${HEADER_COLOR}`,
  },
}
