/**
 * LocalFileSourceNode — source node that reads a single local file.
 *
 * Supports four modes:
 *   csv   — CSV/TSV parsed into column-keyed records
 *   xml   — Raw XML/HTML text passed as a FileRecord (for XMLSectionNode / Ollama)
 *   image — Image read as base64 data URL for vision models
 *   pdf   — PDF text extracted via pdfjs-dist (for KingsInference / Ollama)
 *
 * No runner registered — file selection requires a direct user gesture.
 */

import { useRef, useCallback, useEffect } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { extractFileContent, extractPdfPages } from '../utils/fileReaders'
import { parseDelimited } from '../utils/csvParser'

// ── Node data ─────────────────────────────────────────────────────────────────

export interface LocalFileSourceNodeData {
  fileMode: 'csv' | 'xml' | 'image' | 'pdf'
  delimiter: 'auto' | ',' | '\t' | ';' | '|'
  hasHeader: boolean
  autoCast: boolean
  pdfRenderPages: boolean
  fileName: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  statusMessage: string
  count: number
  columnNames: string[]
  resultsVersion?: number
  [key: string]: unknown
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#0e7490'
const BTN_COLOR    = '#0891b2'

const MODE_OPTIONS = [
  { value: 'csv',   label: 'CSV / TSV' },
  { value: 'xml',   label: 'XML / HTML' },
  { value: 'image', label: 'Image' },
  { value: 'pdf',   label: 'PDF' },
]

const DELIMITER_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: ',',    label: 'Comma (CSV)' },
  { value: '\t',   label: 'Tab (TSV)' },
  { value: ';',    label: 'Semicolon' },
  { value: '|',    label: 'Pipe' },
]

const ACCEPT: Record<string, string> = {
  csv:   '.csv,.tsv,.txt',
  xml:   '.xml,.html,.tei,.tei.xml',
  image: '.jpg,.jpeg,.png,.tiff,.tif,.webp',
  pdf:   '.pdf',
}

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  ready:   '#22c55e',
  error:   '#ef4444',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LocalFileSourceNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as LocalFileSourceNodeData
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const lastFileRef   = useRef<File | null>(null)

  const fileMode       = (d.fileMode       as string  | undefined) ?? 'csv'
  const delimiter      = (d.delimiter      as string  | undefined) ?? 'auto'
  const hasHeader      = (d.hasHeader      as boolean | undefined) ?? true
  const autoCast       = (d.autoCast       as boolean | undefined) ?? true
  const pdfRenderPages = (d.pdfRenderPages as boolean | undefined) ?? false
  const status      = (d.status      as string   | undefined) ?? 'idle'
  const fileName    = (d.fileName    as string   | undefined) ?? ''
  const count       = (d.count       as number   | undefined) ?? 0
  const columnNames = (d.columnNames as string[] | undefined) ?? []
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  const processFile = useCallback(async (file: File) => {
    clearNodeResults(id)
    updateNodeData(id, { status: 'loading', statusMessage: 'Reading…', fileName: file.name, count: 0, columnNames: [] })

    try {
      if (fileMode === 'csv') {
        const text = await file.text()
        const { records, columns } = parseDelimited(text, delimiter, hasHeader, autoCast, file.name)
        const version = setNodeResults(id, records)
        updateNodeData(id, { status: 'ready', statusMessage: `✓ ${records.length} rows`, fileName: file.name, count: records.length, columnNames: columns, resultsVersion: version })
      } else if (fileMode === 'pdf' && pdfRenderPages) {
        const pages: Record<string, unknown>[] = []
        let totalPages = 0
        await extractPdfPages(file, 1.5, 20, (record, pageNum, total) => {
          totalPages = total
          pages.push(record as unknown as Record<string, unknown>)
          const version = setNodeResults(id, [...pages])
          updateNodeData(id, { statusMessage: `⟳ Rendering page ${pageNum}/${Math.min(total, 20)}…`, count: pages.length, resultsVersion: version })
        })
        updateNodeData(id, {
          status:        'ready',
          statusMessage: `✓ ${pages.length} page${pages.length !== 1 ? 's' : ''} rendered${totalPages > 20 ? ` (capped at 20 of ${totalPages})` : ''}`,
          fileName:      file.name,
          count:         pages.length,
          columnNames:   [],
        })
      } else {
        const record = await extractFileContent(file, file.name, '')
        if (!record) throw new Error('Unsupported file type')
        const version = setNodeResults(id, [record as unknown as Record<string, unknown>])
        updateNodeData(id, { status: 'ready', statusMessage: `✓ ${record.contentType} loaded`, fileName: file.name, count: 1, columnNames: [], resultsVersion: version })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}`, count: 0, columnNames: [] })
    }
  }, [id, updateNodeData, fileMode, delimiter, hasHeader, autoCast, pdfRenderPages])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    lastFileRef.current = file
    await processFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [processFile])

  // Re-process the stored file when the pdfRenderPages toggle changes after a file is loaded
  useEffect(() => {
    if (fileMode === 'pdf' && lastFileRef.current && status === 'ready') {
      processFile(lastFileRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfRenderPages])

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Local File</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* File mode */}
        <div style={styles.row}>
          <span style={styles.label}>Mode</span>
          <select
            style={styles.select}
            value={fileMode}
            onChange={e => updateNodeData(id, { fileMode: e.target.value, count: 0, columnNames: [], fileName: '', status: 'idle', statusMessage: '' })}
            className="nodrag"
          >
            {MODE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* CSV-only options */}
        {fileMode === 'csv' && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>Delimiter</span>
              <select
                style={styles.select}
                value={delimiter}
                onChange={e => updateNodeData(id, { delimiter: e.target.value })}
                className="nodrag"
              >
                {DELIMITER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <label style={styles.checkLabel} className="nodrag">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={e => updateNodeData(id, { hasHeader: e.target.checked })}
                style={{ marginRight: 4 }}
              />
              First row is header
            </label>
            <label style={styles.checkLabel} className="nodrag">
              <input
                type="checkbox"
                checked={autoCast}
                onChange={e => updateNodeData(id, { autoCast: e.target.checked })}
                style={{ marginRight: 4 }}
              />
              Cast numeric strings to numbers
            </label>
          </>
        )}

        {/* PDF-only options */}
        {fileMode === 'pdf' && (
          <label style={styles.checkLabel} className="nodrag">
            <input
              type="checkbox"
              checked={pdfRenderPages}
              onChange={e => updateNodeData(id, { pdfRenderPages: e.target.checked, count: 0, columnNames: [], fileName: '', status: 'idle', statusMessage: '' })}
              style={{ marginRight: 4 }}
            />
            Render as page images
          </label>
        )}

        {/* File info */}
        {fileName ? (
          <div style={styles.fileInfo}>
            <span style={styles.fileIcon}>
              {fileMode === 'image' ? '🖼️' : fileMode === 'xml' ? '📋' : fileMode === 'pdf' ? '📕' : '📄'}
            </span>
            <span style={styles.fileName} title={fileName}>{fileName}</span>
            {count > 0 && (
              <span style={styles.countBadge}>
                {fileMode === 'csv' ? `${count} rows` : fileMode.toUpperCase()}
              </span>
            )}
          </div>
        ) : null}

        {/* Column preview (CSV only) */}
        {fileMode === 'csv' && columnNames.length > 0 && (
          <div style={styles.colPreview}>
            <span style={styles.colPreviewLabel}>Columns: </span>
            <span style={styles.colPreviewNames}>
              {columnNames.slice(0, 8).join(', ')}
              {columnNames.length > 8 ? ` +${columnNames.length - 8} more` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button
          style={{
            ...styles.btn,
            background: BTN_COLOR,
            opacity: status === 'loading' ? 0.6 : 1,
          }}
          onClick={handlePickFile}
          disabled={status === 'loading'}
          className="nodrag"
        >
          {status === 'loading' ? 'Reading…' : '📂 Pick File'}
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT[fileMode] ?? '*'}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        className="nodrag"
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="data"
        style={styles.outputHandle}
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 240,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
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
  headerStatus: {
    fontSize: 10,
    fontWeight: 600,
    color: '#a5f3fc',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  body: {
    padding: '10px 12px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 7,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 11,
    color: '#6b7280',
    width: 60,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    flex: 1,
    height: 22,
    background: '#fff',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#374151',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 6px',
    background: '#ecfeff',
    borderRadius: 4,
    border: '1px solid #a5f3fc',
  },
  fileIcon: {
    fontSize: 12,
    flexShrink: 0,
  },
  fileName: {
    fontSize: 11,
    fontWeight: 600,
    color: '#0e7490',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  countBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: '#0891b2',
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    flexShrink: 0,
  },
  colPreview: {
    fontSize: 10,
    color: '#6b7280',
    lineHeight: 1.5,
    wordBreak: 'break-word' as const,
  },
  colPreviewLabel: {
    fontWeight: 700,
    color: '#374151',
  },
  colPreviewNames: {
    fontFamily: 'monospace',
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
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
  outputHandle: {
    width: 10,
    height: 10,
    background: '#0891b2',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #0891b2',
  },
}
