/**
 * LocalFolderSourceNode — source node that reads files from a user-selected
 * local folder via the File System Access API.
 *
 * Output handles (right side, fixed positions):
 *   results — all file records
 *   pdf     — PDF text records only
 *   xml     — XML/TEI records only
 *   text    — plain-text records only
 *   image   — image records only
 *
 * GIS layers are emitted on the bottom handle for MapOutputNode.
 *
 * No runner is registered — folder selection requires a direct user gesture.
 */

import { useState, useCallback, useRef } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { scanDirectory, TYPE_LABEL_MAP, type FileRecord } from '../utils/fileReaders'
import { scanGisFiles, type GisLayer } from '../utils/gisReaders'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

// ── Node data (persisted in React Flow node state) ────────────────────────────

export interface LocalFolderSourceNodeData {
  fileTypes: string[]
  maxFiles: number
  folderName: string
  status: 'idle' | 'scanning' | 'ready' | 'error'
  statusMessage: string
  results: FileRecord[] | undefined
  count: number
  pdfCount: number
  xmlCount: number
  textCount: number
  imageCount: number
  gisLayers: GisLayer[] | undefined
  gisCount: number
  [key: string]: unknown
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#315a3f'
const BTN_COLOR    = '#15803d'

const FILE_TYPE_OPTIONS = [
  { key: 'pdf',   label: 'PDF' },
  { key: 'xml',   label: 'XML / TEI' },
  { key: 'text',  label: 'Text' },
  { key: 'image', label: 'Images' },
]

// Fixed handle positions (px from top of card) — must match the output rows in the body
const OUTPUT_HANDLES = [
  { id: 'results', label: 'All',   color: '#8a8168', top: 70  },
  { id: 'pdf',     label: 'PDF',   color: '#dc2626', top: 94  },
  { id: 'xml',     label: 'XML',   color: '#d97706', top: 118 },
  { id: 'text',    label: 'Text',  color: '#16a34a', top: 142 },
  { id: 'image',   label: 'Image', color: '#2563eb', top: 166 },
]

const STATUS_BORDER: Record<string, string> = {
  idle:     '#d6ccb5',
  scanning: '#3b82f6',
  ready:    '#22c55e',
  error:    '#ef4444',
}

const HAS_API = typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ── Component ─────────────────────────────────────────────────────────────────

export function LocalFolderSourceNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as LocalFolderSourceNodeData

  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [scanSummary, setScanSummary] = useState<string>('')

  const doScan = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const fileTypes = (d.fileTypes as string[] | undefined) ?? Object.keys(TYPE_LABEL_MAP)
    const maxFiles  = Number(d.maxFiles) || 50

    clearNodeResults(id)
    clearNodeResults(`${id}:pdf`)
    clearNodeResults(`${id}:xml`)
    clearNodeResults(`${id}:text`)
    clearNodeResults(`${id}:image`)

    updateNodeData(id, {
      status:        'scanning',
      statusMessage: 'Scanning…',
      folderName:    handle.name,
      count:         0,
      pdfCount:      0,
      xmlCount:      0,
      textCount:     0,
      imageCount:    0,
      gisLayers:     undefined,
      gisCount:      0,
    })
    setScanSummary('')

    try {
      const [{ files, totalFound, skipped }, gisLayers] = await Promise.all([
        scanDirectory(handle, fileTypes, maxFiles),
        scanGisFiles(handle),
      ])

      const pdfs   = files.filter(f => f.contentType === 'pdf_text')
      const xmls   = files.filter(f => f.contentType === 'xml')
      const texts  = files.filter(f => f.contentType === 'text')
      const images = files.filter(f => f.contentType === 'image')

      const typeCounts: Record<string, number> = {}
      for (const f of files) {
        typeCounts[f.contentType] = (typeCounts[f.contentType] ?? 0) + 1
      }
      const typeStr = Object.entries(typeCounts)
        .map(([t, n]) => `${n} ${t.replace('pdf_text', 'PDF').replace('xml', 'XML')}`)
        .join(', ')

      const gisSummary = gisLayers.length > 0
        ? ` · ${gisLayers.length} GIS layer${gisLayers.length !== 1 ? 's' : ''}`
        : ''
      const summary = `${files.length} file${files.length !== 1 ? 's' : ''}${typeStr ? `: ${typeStr}` : ''}${skipped ? ` (${skipped} skipped)` : ''}${gisSummary}`

      setScanSummary(summary)
      console.log(`[LocalFolder] scanned ${handle.name}: found ${totalFound}, loaded ${files.length}, skipped ${skipped}, gisLayers ${gisLayers.length}`)

      const version = setNodeResults(id, files as unknown as Record<string, unknown>[])
      setNodeResults(`${id}:pdf`,   pdfs   as unknown as Record<string, unknown>[])
      setNodeResults(`${id}:xml`,   xmls   as unknown as Record<string, unknown>[])
      setNodeResults(`${id}:text`,  texts  as unknown as Record<string, unknown>[])
      setNodeResults(`${id}:image`, images as unknown as Record<string, unknown>[])

      updateNodeData(id, {
        status:         'ready',
        statusMessage:  `✓ ${files.length} files${gisLayers.length > 0 ? ` · ${gisLayers.length} GIS` : ''}`,
        folderName:     handle.name,
        count:          files.length,
        pdfCount:       pdfs.length,
        xmlCount:       xmls.length,
        textCount:      texts.length,
        imageCount:     images.length,
        resultsVersion: version,
        gisLayers:      gisLayers.length > 0 ? gisLayers : undefined,
        gisCount:       gisLayers.length,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[LocalFolder] scan error', msg)
      updateNodeData(id, {
        status:        'error',
        statusMessage: `✗ ${msg}`,
        results:       undefined,
        count:         0,
        pdfCount:      0,
        xmlCount:      0,
        textCount:     0,
        imageCount:    0,
        gisLayers:     undefined,
        gisCount:      0,
      })
    }
  }, [id, updateNodeData, d.fileTypes, d.maxFiles])

  const handlePickFolder = useCallback(async () => {
    if (!HAS_API) return
    try {
      const handle = await (window as unknown as {
        showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>
      }).showDirectoryPicker()
      dirHandleRef.current = handle
      await doScan(handle)
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        updateNodeData(id, { status: 'idle', statusMessage: '' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [id, updateNodeData, doScan])

  const handleRescan = useCallback(async () => {
    if (!dirHandleRef.current) return
    await doScan(dirHandleRef.current)
  }, [doScan])

  const toggleType = useCallback((key: string) => {
    const current = (d.fileTypes as string[] | undefined) ?? Object.keys(TYPE_LABEL_MAP)
    const next = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key]
    updateNodeData(id, { fileTypes: next })
  }, [id, updateNodeData, d.fileTypes])

  const status     = (d.status     as string   | undefined) ?? 'idle'
  const folderName = (d.folderName as string   | undefined) ?? ''
  const fileTypes  = (d.fileTypes  as string[] | undefined) ?? Object.keys(TYPE_LABEL_MAP)
  const maxFiles   = Number(d.maxFiles) || 50
  const borderColor = STATUS_BORDER[status] ?? '#d6ccb5'
  const count      = (d.count      as number | undefined) ?? 0
  const pdfCount   = (d.pdfCount   as number | undefined) ?? 0
  const xmlCount   = (d.xmlCount   as number | undefined) ?? 0
  const textCount  = (d.textCount  as number | undefined) ?? 0
  const imageCount = (d.imageCount as number | undefined) ?? 0
  const gisLayers  = (d.gisLayers  as GisLayer[] | undefined) ?? []
  const gisCount   = (d.gisCount   as number | undefined) ?? 0

  const typedCounts: Record<string, number> = {
    results: count,
    pdf:     pdfCount,
    xml:     xmlCount,
    text:    textCount,
    image:   imageCount,
  }

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Local Folder</span>
        {d.statusMessage ? (
          <span style={{
            fontSize: 10, fontWeight: 600, color: '#86efac',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* ── Outputs section (FIRST — keeps handle positions deterministic) ── */}
        <div style={styles.outputsSection}>
          <div style={styles.outputsSectionLabel}>Outputs</div>
          {OUTPUT_HANDLES.map(h => (
            <div key={h.id} style={styles.outputRow}>
              <span style={{ ...styles.outputLabel, color: h.color }}>{h.label}</span>
              {typedCounts[h.id] > 0 && (
                <span style={{ ...styles.outputBadge, background: h.color }}>
                  {typedCounts[h.id]}
                </span>
              )}
            </div>
          ))}
        </div>

        {!HAS_API ? (
          <div style={styles.noApiWarning}>Requires Chrome or Edge 86+</div>
        ) : (
          <>
            {/* File type checkboxes */}
            <div style={styles.sectionLabel}>File types</div>
            <div style={styles.checkboxRow}>
              {FILE_TYPE_OPTIONS.map(opt => (
                <label key={opt.key} style={styles.checkLabel} className="nodrag">
                  <input
                    type="checkbox"
                    checked={fileTypes.includes(opt.key)}
                    onChange={() => toggleType(opt.key)}
                    style={{ marginRight: 3 }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>

            {/* Max files */}
            <div style={styles.row}>
              <span style={styles.paramLabel}>Max files</span>
              <input
                type="number"
                style={{ ...styles.inlineInput, width: 60 }}
                value={maxFiles}
                min={1}
                max={500}
                onChange={e => updateNodeData(id, { maxFiles: parseInt(e.target.value, 10) || 50 })}
                className="nodrag"
              />
            </div>

            {/* Folder info (after selection) */}
            {folderName ? (
              <div style={styles.folderInfo}>
                <span style={styles.folderIcon}>📁</span>
                <span style={styles.folderName} title={folderName}>{folderName}</span>
                {count > 0 && (
                  <span style={styles.countBadge}>{count}</span>
                )}
              </div>
            ) : null}

            {/* Scan summary */}
            {scanSummary ? (
              <div style={styles.scanSummary}>{scanSummary}</div>
            ) : null}

            {/* GIS layers list */}
            {gisCount > 0 && gisLayers.length > 0 && (
              <div style={styles.gisSection}>
                <div style={styles.gisSectionLabel}>GIS layers ({gisCount})</div>
                {gisLayers.map((layer, i) => (
                  <div key={i} style={styles.gisLayerRow}>
                    <span style={styles.gisIcon}>
                      {layer.format === 'shapefile' ? '⬡' : '{}'}
                    </span>
                    <span style={styles.gisLayerName} title={layer.name}>
                      {layer.name}
                    </span>
                    <span style={styles.gisFeatureCount}>{layer.featureCount} feat.</span>
                    {layer.noPrj && (
                      <span title="No .prj file found — coordinates assumed WGS84" style={styles.noPrjBadge}>
                        no CRS
                      </span>
                    )}
                  </div>
                ))}
                <div style={styles.gisHint}>
                  Connect the GIS handle (bottom) to a Map Output node
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        {HAS_API && dirHandleRef.current && status !== 'scanning' && (
          <button
            style={{ ...styles.btn, background: '#33302a', marginRight: 6 }}
            onClick={handleRescan}
            className="nodrag"
          >
            ↺ Re-scan
          </button>
        )}
        {HAS_API && (
          <button
            style={{
              ...styles.btn,
              background: BTN_COLOR,
              opacity: status === 'scanning' ? 0.6 : 1,
            }}
            onClick={handlePickFolder}
            disabled={status === 'scanning'}
            className="nodrag"
          >
            {status === 'scanning' ? 'Scanning…' : '📂 Pick Folder'}
          </button>
        )}
      </div>

      {/* Right output handles — one per type at fixed vertical positions */}
      {OUTPUT_HANDLES.map(h => (
        <Handle
          key={h.id}
          type="source"
          position={Position.Right}
          id={h.id}
          style={{
            top: h.top,
            width: 10,
            height: 10,
            background: h.color,
            border: '2px solid #fff',
            boxShadow: `0 0 0 1px ${h.color}`,
          }}
          title={h.label}
        />
      ))}

      {/* Bottom output handle — GIS layers → MapOutputNode */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="gis"
        style={styles.gisHandle}
        title="GIS layers output"
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fffdf7',
    border: '2px solid #d6ccb5',
    borderRadius: 8,
    minWidth: 240,
    boxShadow: '0 1px 4px rgba(50,42,26,0.10)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
  },
  header: {
    height: 32,
    background: HEADER_COLOR,
    borderRadius: '6px 6px 0 0',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  body: {
    padding: '8px 12px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  // Outputs section — MUST be first in body; height locks handle positions
  outputsSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
    marginBottom: 4,
    paddingRight: 16,
  },
  outputsSectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#b0a891',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    height: 18,
    display: 'flex',
    alignItems: 'center',
  },
  outputRow: {
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  outputLabel: {
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  outputBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#8a8168',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  checkboxRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#33302a',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  paramLabel: {
    fontSize: 11,
    color: '#8a8168',
    width: 56,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  inlineInput: {
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d6ccb5',
    borderRadius: 4,
    outline: 'none',
    height: 22,
  },
  folderInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    padding: '4px 6px',
    background: '#f0fdf4',
    borderRadius: 4,
    border: '1px solid #bbf7d0',
  },
  folderIcon: {
    fontSize: 12,
    flexShrink: 0,
  },
  folderName: {
    fontSize: 11,
    fontWeight: 600,
    color: '#166534',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  countBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: '#16a34a',
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    flexShrink: 0,
  },
  scanSummary: {
    fontSize: 10,
    color: '#8a8168',
    fontStyle: 'italic' as const,
    lineHeight: 1.4,
  },
  gisSection: {
    marginTop: 4,
    padding: '6px 8px',
    background: '#eff6ff',
    borderRadius: 4,
    border: '1px solid #bfdbfe',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  gisSectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#1d4ed8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 2,
  },
  gisLayerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: '#1e40af',
  },
  gisIcon: {
    fontSize: 11,
    flexShrink: 0,
    width: 14,
    textAlign: 'center' as const,
  },
  gisLayerName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontWeight: 600,
  },
  gisFeatureCount: {
    fontSize: 10,
    color: '#3b82f6',
    flexShrink: 0,
  },
  noPrjBadge: {
    fontSize: 9,
    fontWeight: 700,
    background: '#fef3c7',
    color: '#b45309',
    border: '1px solid #fcd34d',
    borderRadius: 3,
    padding: '0 4px',
    flexShrink: 0,
  },
  gisHint: {
    fontSize: 9,
    color: '#8a8168',
    fontStyle: 'italic' as const,
    marginTop: 2,
  },
  noApiWarning: {
    fontSize: 11,
    color: '#ef4444',
    padding: '6px 0',
    textAlign: 'center' as const,
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  btn: {
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  gisHandle: {
    width: 10,
    height: 10,
    background: '#3b82f6',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #3b82f6',
  },
}
